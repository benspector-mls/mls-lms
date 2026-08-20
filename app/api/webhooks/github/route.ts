import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/prisma";
import type { SubmissionStatus } from "@/lib/generated/prisma/enums";
import { isGithubAppConfigured } from "@/lib/github/app-client";
import { verifyGithubSignature } from "@/lib/github/webhook-verify";
import { handInState, handInStatus } from "@/lib/submissions/hand-in";
import { recordActivity, recordHandIn } from "@/lib/submissions/team";

/**
 * GitHub webhook receiver.
 *
 * Difference from the marcy-lms version worth knowing about: that one responded
 * 200 first and then did the database work without awaiting it, with a comment
 * saying it would need `waitUntil` if ever deployed to a runtime that stops
 * executing after the response is sent. This app runs on Vercel, which is exactly
 * that kind of runtime, so unawaited work would be cancelled unpredictably.
 *
 * Here the work is awaited before responding. That is safe because in this phase
 * the work is a single database update taking milliseconds, far inside GitHub's
 * roughly 10 second timeout. When grading is added in Phase 2 the long-running
 * part must be started rather than awaited — see the asynchronous grading job
 * section of plan-updates.md.
 */

/**
 * Only the fields this handler reads. GitHub sends a much larger payload.
 */
type PullRequestWebhookPayload = {
  action: string;
  repository: { full_name: string };
  installation?: { id: number };
  pull_request: {
    number: number;
    html_url: string;
    head: { sha: string; ref: string };
    base: { ref: string };
    /**
     * The account that opened the pull request, which is how a hand-in gets a name.
     *
     * Optional because this type is a description of what is read rather than of what GitHub
     * sends, and a payload without it must not throw — it means nobody is named, which is
     * already a state every screen handles.
     */
    user?: { login: string } | null;
  };
};

export async function POST(request: NextRequest) {
  // Must be the raw body. Parsing and re-serializing changes the bytes and the
  // signature will not match.
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");

  if (!isGithubAppConfigured()) {
    return NextResponse.json({ error: "GitHub App is not configured" }, { status: 503 });
  }

  if (!verifyGithubSignature(rawBody, signature, process.env.GITHUB_WEBHOOK_SECRET!)) {
    // Deliberately terse. A detailed message would help someone probing the
    // endpoint work out why their forged signature was rejected.
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // `ping` is what GitHub sends when a webhook is first configured. Answering it
  // successfully is how the app's settings page shows a green check.
  if (event === "ping") {
    return NextResponse.json({ ok: true, pong: true });
  }

  if (event !== "pull_request") {
    // Acknowledge events we do not handle. Returning an error would make GitHub
    // retry them and eventually mark the webhook as failing.
    return NextResponse.json({ ok: true, ignored: event });
  }

  let payload: PullRequestWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as PullRequestWebhookPayload;
  } catch {
    return NextResponse.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  try {
    const result = await handlePullRequestEvent(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(`webhook ${deliveryId}: pull_request handling failed`, err);
    // A 500 causes GitHub to record the delivery as failed, which is what we
    // want: the delivery can then be redelivered from the app's settings page
    // after the cause is fixed.
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}

/**
 * The new status, or undefined to leave it as it is.
 *
 * Keyed on the current status as well as the action, because the action alone is not
 * enough. A student who closes their pull request and opens a new one fires `opened`
 * a second time, and treating that as a first submission would reset an already
 * graded row and lose the very distinction the queue depends on.
 *
 * Which status a hand-in produces is `handInStatus`, shared with the two kinds that have no
 * pull request to observe. Only the `synchronize` case is this webhook's own: a commit pushed
 * to an open pull request is not a hand-in at all — see below — so there is nothing for the
 * rule to decide.
 */
function resolveStatus(action: string, current: SubmissionStatus): SubmissionStatus | undefined {
  if (action === "synchronize") return undefined;

  // Reopening after a grade is a revision, and is recorded as one without the student
  // needing to press anything. The button in the application exists for the other
  // route to the same state: pushing more commits to a pull request that stayed open.
  return handInStatus(current);
}

/**
 * Which member of this work's team opened the pull request, if any of them did.
 *
 * Scoped to the people who hold a row on this piece of work — the row itself and every mirror of
 * it — so it cannot name somebody unrelated who happens to share a handle. Null when the account
 * matches nobody, which is the ordinary case for an instructor pushing a fix and for a test
 * student, whose handle names no GitHub account at all. The screens read null as "your team's
 * pull request" rather than naming anybody.
 *
 * Case-insensitively, because GitHub logins are, and the one on record was typed by a person.
 */
async function memberBehind(login: string | null, submissionId: string): Promise<string | null> {
  if (!login) return null;

  const member = await db.profile.findFirst({
    where: {
      githubUsername: { equals: login, mode: "insensitive" },
      submissions: { some: { OR: [{ id: submissionId }, { teamSubmissionId: submissionId }] } },
    },
    select: { id: true },
  });

  return member?.id ?? null;
}

async function handlePullRequestEvent(payload: PullRequestWebhookPayload) {
  const { action } = payload;

  // Opening the pull request is the act of submitting. `synchronize` — a new commit
  // pushed to an open pull request — deliberately does NOT submit anything.
  //
  // A commit is not a claim of completion. Students push while they work, and if
  // every push re-submitted, a graded submission would drop back into the queue
  // because someone fixed a typo. Declaring a revision ready is a separate,
  // deliberate act through the application.
  //
  // The cost of this rule is that a student who opens a pull request before starting
  // appears in the queue with almost nothing in it. That is the failure worth having:
  // an instructor sees it immediately, whereas work that is never declared ready is
  // silently never reviewed.
  if (!["opened", "reopened", "synchronize"].includes(action)) {
    return { ignored: `action:${action}` };
  }

  // Only pull requests into `main` are submissions. A student may open other
  // pull requests in their own repository.
  if (payload.pull_request.base.ref !== "main") {
    return { ignored: `base:${payload.pull_request.base.ref}` };
  }

  const repoFullName = payload.repository.full_name;

  /*
    Resolved by repository, which needs no change for a team: `repoFullName` is globally unique and
    only the row holding a team's work ever carries one, so this finds that row and never a mirror.
  */
  const submission = await db.submission.findUnique({
    where: { repoFullName },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      isLate: true,
      teamId: true,
      assignment: { select: { id: true, dueAt: true } },
    },
  });

  if (!submission) {
    // Expected in normal operation: the GitHub App is installed organization
    // wide, so it receives events for repositories that are not submissions.
    console.warn(`webhook: no submission matches repository ${repoFullName}`);
    return { ignored: "unknown-repository" };
  }

  const now = new Date();

  /*
    Where the work is now. Written only to the row that holds it: on a team's other rows each of
    these would be a copy that goes stale, and a mirror carrying a `headSha` with no
    `gradedHeadSha` beside it would read as "pushed since graded" for good.
  */
  const location = {
    prNumber: payload.pull_request.number,
    prUrl: payload.pull_request.html_url,
    headBranch: payload.pull_request.head.ref,
    headSha: payload.pull_request.head.sha,
  };

  const status = resolveStatus(action, submission.status);

  if (status === undefined) {
    /*
      A commit pushed to a pull request that is already open, which is not a hand-in. Recorded as
      activity: the commit and the time it arrived, and nothing about status, when the work was
      handed in, or by whom.
    */
    await recordActivity(db, { submissionId: submission.id, at: now, location });
  } else {
    /*
      Opening or reopening the pull request, which is the act of handing in.

      `handedInById` is resolved from the account that opened it, matched against the members of
      the team — null when nothing matches, which the screens read as "your team's pull request"
      rather than naming somebody. For work a student does alone it is themselves, looked up the
      same way, so there is one rule rather than a branch.

      `handInState` records the submission time on the first hand-in only, so a resubmission does
      not reset it and turn an on-time submission into a late one. That rule is shared with the two
      kinds that hand in without a pull request.
    */
    await recordHandIn(db, {
      submissionId: submission.id,
      handIn: {
        state: handInState({ current: submission, dueAt: submission.assignment.dueAt, now }),
        lastActivityAt: now,
        handedInById: await memberBehind(payload.pull_request.user?.login ?? null, submission.id),
        location,
      },
    });
  }

  // Phase 2 adds the grading job here. On `synchronize` it must also mark any
  // existing grading draft for this submission as SUPERSEDED, so an instructor's
  // in-progress review of an older commit is not silently replaced.

  return { submissionId: submission.id, action };
}
