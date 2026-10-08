import "server-only";

import { isManualOnly } from "@/lib/assignments/spec";
import { teamAwareWork } from "@/lib/courses/membership";
import { undeliveredApprovalWhere } from "@/lib/grade/delivery";
import { isOutstanding, triageBucket } from "@/lib/grade/triage";
import { triageHref } from "@/lib/links";
import { db, type Tx } from "@/lib/prisma";
import type { CohortSelection } from "@/lib/programs/cohorts";
import { dashboardSections, type DashboardRow } from "@/lib/student/dashboard";
import { studentAssignmentHref } from "@/lib/links";

import {
  absoluteHref,
  outstandingSummary,
  summaryCohortLine,
  summaryCourseLink,
  summaryWorkLine,
  upcomingSummary,
} from "./messages";
import { schoolHourAndWeekday } from "./recipients";
import { resolveSlackUserId } from "./slack";
import type { DigestSend } from "./digest";

/**
 * The summaries: what is outstanding right now, rather than what happened since last time.
 *
 * **These carry no watermark and need none.** A digest of events must remember how far it has
 * read, because an event announced twice is a fault. A pile is the opposite — if seven
 * submissions are still waiting tomorrow, tomorrow's summary should say so. Every send recomputes
 * the answer from current state, so a failed send costs nothing and nothing has to be reconciled.
 *
 * Both halves reuse the rule the matching screen uses rather than restating it: `triageBucket`
 * decides what is outstanding for an instructor, exactly as the triage screen decides it, and
 * `dashboardSections` decides what is overdue or due soon for a fellow, exactly as their dashboard
 * decides it. Each query here supplies the *scope* those pure functions are applied over, which is
 * the part that genuinely differs: a screen asks about one course, a summary asks about all of
 * them.
 */

/** A cohort's share of one instructor's pile. */
type CohortTally = { name: string; count: number };

/**
 * The grading pile for one instructor, across every course they teach, grouped by cohort.
 *
 * **Scoped by the cohort picker they already use.** `ProgramInstructor.cohortId` records which
 * cohort of a program's roster an instructor is currently working, and its own documentation says
 * the fact it holds is "I grade these fifteen fellows". Reading it here means there is no second
 * place to say the same thing and nothing new to keep in step — at the cost that widening the
 * picker to look at the whole programme also widens tomorrow's summary. The heading names the
 * scope so that is visible rather than mysterious, and the breakdown by cohort means a wider
 * summary is still readable rather than wrong.
 */
export async function instructorSummaryLines(
  client: Tx,
  instructorId: string,
): Promise<string[]> {
  const memberships = await client.programInstructor.findMany({
    where: { userId: instructorId },
    select: {
      programId: true,
      cohortId: true,
      cohort: { select: { name: true } },
      program: {
        select: {
          // Archived programmes are not work anybody is waiting on.
          archivedAt: true,
          courses: {
            where: { archivedAt: null, instructors: { some: { userId: instructorId } } },
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  const tallies = new Map<string, CohortTally>();
  const courseLinks: { name: string; href: string | null; count: number }[] = [];
  let total = 0;
  const scopes = new Set<string>();

  for (const membership of memberships) {
    if (membership.program.archivedAt !== null) continue;
    scopes.add(membership.cohort?.name ?? "All Fellows");

    const selection: CohortSelection = membership.cohortId
      ? { kind: "cohort", cohortId: membership.cohortId }
      : { kind: "all" };

    for (const course of membership.program.courses) {
      const outstanding = await outstandingForCourse(client, {
        programId: membership.programId,
        courseId: course.id,
        selection,
      });

      if (outstanding.length === 0) continue;
      total += outstanding.length;
      courseLinks.push({
        name: course.name,
        href: absoluteHref(triageHref(course.id)),
        count: outstanding.length,
      });

      for (const row of outstanding) {
        const name = row.cohortName ?? "No cohort";
        const tally = tallies.get(name) ?? { name, count: 0 };
        tally.count += 1;
        tallies.set(name, tally);
      }
    }
  }

  if (total === 0) return [];

  const lines = [outstandingSummary({ scope: [...scopes].join(", "), total })];

  // One cohort means the heading already said it, so a single bullet repeating itself is noise.
  if (tallies.size > 1) {
    for (const tally of [...tallies.values()].sort((a, b) => b.count - a.count)) {
      lines.push(summaryCohortLine(tally));
    }
  }

  lines.push(summaryCourseLink(courseLinks));
  return lines;
}

/**
 * The submissions of one course that are waiting on somebody, by the triage screen's own rule.
 *
 * `teamAwareWork` supplies the scope — this course's work, by fellows currently on the roster,
 * narrowed to the cohort selection — and is the same fragment the triage procedure passes, so a
 * summary cannot come to mean something different by "waiting" than the screen it points at.
 */
async function outstandingForCourse(
  client: Tx,
  params: { programId: string; courseId: string; selection: CohortSelection },
): Promise<{ cohortName: string | null }[]> {
  const submissions = await client.submission.findMany({
    where: {
      ...teamAwareWork(params.programId, params.courseId, params.selection),
      OR: [
        { status: { in: ["SUBMITTED", "RESUBMITTED"] } },
        {
          gradingDrafts: {
            some: { status: { in: ["READY", "NEEDS_MANUAL_REVIEW", "FAILED", "GENERATING"] } },
          },
        },
        { gradingDrafts: { some: undeliveredApprovalWhere() } },
      ],
    },
    select: {
      id: true,
      status: true,
      headSha: true,
      teamSubmissionId: true,
      student: {
        select: {
          testStudentNumber: true,
          enrollments: {
            where: { programId: params.programId },
            select: { cohort: { select: { name: true } } },
          },
        },
      },
      assignment: { select: { sections: true } },
      gradingDrafts: {
        where: { status: { not: "SUPERSEDED" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, headSha: true },
      },
    },
  });

  if (submissions.length === 0) return [];

  // The one fact the rows cannot carry themselves, asked once for the whole set rather than per
  // row — the same second query the triage procedure makes, for the same reason.
  const undelivered = await client.gradingDraft.findMany({
    where: undeliveredApprovalWhere({ id: { in: submissions.map((s) => s.id) } }),
    select: { submissionId: true },
  });
  const undeliveredIds = new Set(undelivered.map((draft) => draft.submissionId));

  return submissions
    .filter((submission) => {
      // A rehearsal is not work anybody is waiting on, the same exclusion every send path makes.
      if (submission.student.testStudentNumber !== null) return false;

      const draft = submission.gradingDrafts[0] ?? null;
      const draftIsStale = Boolean(
        draft?.headSha && submission.headSha && draft.headSha !== submission.headSha,
      );

      return isOutstanding(
        triageBucket(submission.status, draft, {
          draftIsStale,
          hasUndeliveredApproval: undeliveredIds.has(submission.id),
          isManualOnly: isManualOnly(submission.assignment.sections),
          mirrorsAnotherSubmission: submission.teamSubmissionId !== null,
        }),
      );
    })
    .map((submission) => ({
      cohortName: submission.student.enrollments[0]?.cohort?.name ?? null,
    }));
}

/**
 * What one fellow has due in the next week and what they have let slip.
 *
 * `dashboardSections` is the rule, unchanged: it decides that work is overdue when the deadline
 * the fellow is working to has passed and nothing has been handed in, and that work is upcoming
 * when that deadline falls inside the window. Reusing it is what makes this message agree with the
 * screen the fellow will open when they read it, including about a deadline they were personally
 * given more time for — `effectiveDueAt` is what the rows carry.
 *
 * Deliberately the two deadline lists and nothing else. The dashboard's other sections — unread
 * feedback, unread comments, work needing another attempt — are announced by the event
 * notifications as they happen, and repeating them here would tell somebody twice.
 */
export async function studentSummaryLines(
  client: Tx,
  studentId: string,
  now: Date,
): Promise<string[]> {
  const assignments = await client.assignment.findMany({
    where: {
      distributedAt: { not: null },
      dueAt: { not: null },
      course: {
        publishedAt: { not: null },
        archivedAt: null,
        program: {
          archivedAt: null,
          enrollments: { some: { studentId, status: "ACTIVE" } },
        },
      },
    },
    select: {
      id: true,
      title: true,
      dueAt: true,
      course: { select: { id: true, name: true } },
      submissions: {
        where: { studentId },
        select: {
          status: true,
          extendedDueAt: true,
          finalScore: true,
          finalScorePossible: true,
          isComplete: true,
          gradedAt: true,
          feedbackReviewedAt: true,
        },
      },
    },
  });

  const rows: DashboardRow[] = assignments.map((assignment) => {
    const submission = assignment.submissions[0] ?? null;
    return {
      id: assignment.id,
      title: assignment.title,
      dueAt: assignment.dueAt,
      // The deadline this fellow is working to, which is their own where one was agreed.
      effectiveDueAt: submission?.extendedDueAt ?? assignment.dueAt,
      course: assignment.course,
      submission: submission
        ? {
            status: submission.status,
            finalScore: submission.finalScore,
            finalScorePossible: submission.finalScorePossible,
            isComplete: submission.isComplete,
            gradedAt: submission.gradedAt,
            feedbackReviewedAt: submission.feedbackReviewedAt,
            // Announced as it happens by the comment notification, so the summary leaves it out.
            unreadComments: null,
          }
        : null,
    };
  });

  const sections = dashboardSections(rows, now);
  const lines: string[] = [];

  if (sections.overdue.length > 0) {
    lines.push(upcomingSummary({ kind: "overdue", count: sections.overdue.length }));
    for (const row of sections.overdue) lines.push(workLine(row));
  }

  if (sections.upcoming.length > 0) {
    lines.push(upcomingSummary({ kind: "upcoming", count: sections.upcoming.length }));
    for (const row of sections.upcoming) lines.push(workLine(row));
  }

  return lines;
}

function workLine(row: DashboardRow): string {
  return summaryWorkLine({
    title: row.title,
    courseName: row.course.name,
    dueAt: row.effectiveDueAt,
    href: absoluteHref(studentAssignmentHref(row.course.id, row.id)),
  });
}

/**
 * Send every summary that is due.
 *
 * Separate from `runDigests` and sending its own message rather than appending a section to that
 * one: two short messages about two different things read better than one long message about
 * both, and keeping them apart means a fault in either cannot silence the other.
 */
export async function runSummaries(
  now: Date,
  deps: { send: DigestSend; client?: Tx },
): Promise<{ summarised: number; skipped: number; failed: number }> {
  const client = deps.client ?? db;
  const counts = { summarised: 0, skipped: 0, failed: 0 };
  const { hour, weekday } = schoolHourAndWeekday(now);

  const users = await client.profile.findMany({
    where: {
      testStudentNumber: null,
      slackSummaryHour: hour,
      OR: [
        { slackSummaryCadence: "DAILY" },
        { slackSummaryCadence: "WEEKLY", slackSummaryWeekday: weekday },
      ],
    },
    select: {
      id: true,
      role: true,
      email: true,
      slackEmail: true,
      slackUserId: true,
    },
  });

  for (const user of users) {
    const lines =
      user.role === "STUDENT"
        ? await studentSummaryLines(client, user.id, now)
        : await instructorSummaryLines(client, user.id);

    // Nothing outstanding sends nothing. A summary has no watermark to advance, so an empty one
    // simply does not happen — and somebody whose work is done is not waiting to be told so.
    if (lines.length === 0) {
      counts.skipped += 1;
      continue;
    }

    const slackUserId = await resolveSlackUserId(client, user);
    if (!slackUserId) {
      counts.failed += 1;
      continue;
    }

    const sent = await deps.send(slackUserId, lines.join("\n"));
    if (sent.ok) counts.summarised += 1;
    else {
      console.error(`slack: summary to profile ${user.id} failed: ${sent.error}`);
      counts.failed += 1;
    }
  }

  return counts;
}
