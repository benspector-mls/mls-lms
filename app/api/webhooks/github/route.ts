import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/prisma";
import type { SubmissionStatus } from "@/lib/generated/prisma/enums";
import { isGithubAppConfigured } from "@/lib/github/app-client";
import { verifyGithubSignature } from "@/lib/github/webhook-verify";
import { handInState, handInStatus } from "@/lib/submissions/hand-in";

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

  const submission = await db.submission.findUnique({
    where: { repoFullName },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      isLate: true,
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

  // Recorded on first submission only, so a resubmission does not reset the original
  // submission time and turn an on-time submission into a late one. The rule is shared with
  // the two kinds that hand in without a pull request, which is where it had been missing.
  const { submittedAt, isLate } = handInState({
    current: submission,
    dueAt: submission.assignment.dueAt,
    now,
  });

  await db.submission.update({
    where: { id: submission.id },
    data: {
      // Undefined leaves the column alone, which is what `synchronize` needs: the new
      // commit is recorded through headSha and lastActivityAt, and the status is the
      // student's to change.
      status: resolveStatus(action, submission.status),
      submittedAt,
      isLate,
      prNumber: payload.pull_request.number,
      prUrl: payload.pull_request.html_url,
      headBranch: payload.pull_request.head.ref,
      headSha: payload.pull_request.head.sha,
      lastActivityAt: now,
    },
  });

  // Phase 2 adds the grading job here. On `synchronize` it must also mark any
  // existing grading draft for this submission as SUPERSEDED, so an instructor's
  // in-progress review of an older commit is not silently replaced.

  return { submissionId: submission.id, action };
}
