/**
 * Where a course stands, as five counts.
 *
 * **Browser-safe and pure**, in the manner of `lib/gradebook/csv.ts`: the input is the assignment
 * list `assignments.listForCourse` already returns, so the bar is a summary of the rows on screen
 * rather than a second read that could disagree with them. Every colour comes from the tone
 * system in `lib/status.ts` — a bar with a palette of its own would contradict the badges sitting
 * directly beneath it in the same list.
 *
 * **Eight submission statuses become five segments**, and the collapsing is the whole of the
 * decision this file makes:
 *
 * - The five queue-shaped statuses are one segment, for the same reason `STUDENT_STATUS_META`
 *   gives them one label. `DRAFT_READY`, `NEEDS_MANUAL_REVIEW`, and `GRADING_FAILED` describe
 *   this application's state rather than the student's work, and a student shown a red segment
 *   for a pipeline error reasonably concludes they broke something.
 * - Not accepted and accepted stay apart, which is one distinction more than the status badges
 *   draw — both are grey there, because to a student they are the same fact. On a bar they are
 *   not: "you have taken up four of these and handed none of them in" is a different sentence
 *   from "you have not looked at four of these", and the bar exists to say which. They are two
 *   weights of the same grey rather than two colours, so the difference reads as a shade of one
 *   state rather than as two unrelated ones.
 * - Graded splits on `isComplete`, the column approval writes. Never on a comparison of
 *   `finalScore` against `completionThreshold` — that judgment is made in one place,
 *   `approveDraft` in `lib/grade/approve.ts`, and a second implementation of it in the browser
 *   is how a bar comes to disagree with the gradebook about who passed.
 */

import type { SubmissionStatus } from "@/lib/generated/prisma/enums";

export type ProgressState =
  "notAccepted" | "accepted" | "withInstructor" | "incomplete" | "complete";

/**
 * The parts of an assignment row this reads, named structurally rather than taken from
 * `RouterOutputs`, so a test can build a nine-assignment course in a few lines.
 *
 * `submissions` is an array because that is the shape the procedure returns — the relation is
 * scoped to the caller, so it holds the student's own submission or nothing at all.
 */
export type ProgressAssignment = {
  submissions: readonly {
    status: SubmissionStatus;
    isComplete: boolean | null;
  }[];
};

/**
 * Which segment one assignment falls in.
 *
 * A missing submission and `NOT_STARTED` are the same answer. The row exists only once something
 * has happened to it, and the two ways of having nothing are not worth telling apart.
 *
 * **`isComplete === true` is checked before the status, and the order is the decision.** Meeting
 * the threshold is a durable fact: the gradebook records it, and asking for another look does not
 * withdraw it. Reading the status first meant a student who passed an assignment and then
 * resubmitted to improve on it moved out of the green segment and their completed count went down
 * by one — the bar punishing them for resubmitting, which is the opposite of what it should
 * encourage. It also disagreed with the score column beside it, which has always read `isComplete`
 * whatever the status.
 *
 * A resubmission of work that did *not* meet the threshold is a different case and lands under
 * "with your instructor" rather than "not yet complete", because something is genuinely in flight.
 *
 * `GRADED` with a null `isComplete` is not a state approval can produce — the two are written in
 * one transaction — so reaching it means something is wrong. Saying the work is out of the
 * student's hands is honest; guessing at a verdict is not.
 */
export function progressStateOf(
  submission: { status: SubmissionStatus; isComplete: boolean | null } | null | undefined,
): ProgressState {
  if (submission == null || submission.status === "NOT_STARTED") return "notAccepted";
  if (submission.status === "ACCEPTED") return "accepted";

  if (submission.isComplete === true) return "complete";
  if (submission.status === "GRADED" && submission.isComplete === false) return "incomplete";

  // The queue-shaped statuses, a resubmission of work below the threshold, and the graded row
  // carrying no verdict.
  return "withInstructor";
}

export interface ProgressSegment {
  state: ProgressState;
  /** What the tooltip and the legend call it, already plural-agnostic. */
  label: string;
  count: number;
  /** The filled bar. */
  className: string;
  /** The legend's dot, which is the same colour at 10 pixels. */
  dotClassName: string;
}

/**
 * The five segments in the order a student moves through them, left to right.
 *
 * Colours are the tone system's, named here rather than imported as tones because a bar is a
 * filled area where `TONE_CLASSES` is a bordered pill — the same hue at a different weight. The
 * two greys are the one place this departs from `TONE_DOT`, and the comment at the top of this
 * file says why.
 */
const SEGMENTS: readonly Omit<ProgressSegment, "count">[] = [
  {
    state: "notAccepted",
    label: "not accepted",
    className: "border border-border bg-muted/40",
    dotClassName: "border border-border bg-muted/40",
  },
  {
    state: "accepted",
    label: "accepted, in progress",
    className: "bg-muted-foreground/40",
    dotClassName: "bg-muted-foreground/40",
  },
  {
    state: "withInstructor",
    label: "submitted for feedback",
    className: "bg-amber-500",
    dotClassName: "bg-amber-500",
  },
  {
    state: "incomplete",
    label: "graded, incomplete",
    className: "bg-destructive",
    dotClassName: "bg-destructive",
  },
  {
    state: "complete",
    label: "graded, complete",
    className: "bg-emerald-500",
    dotClassName: "bg-emerald-500",
  },
];

/**
 * Every segment that has something in it, in course order. Empty ones are dropped rather than
 * rendered at zero width, so the bar has no invisible members and the legend lists only states
 * the student is actually in.
 *
 * The counts sum to the number of assignments passed in, always. That is what makes the bar
 * readable as proportions of one course.
 */
export function progressSegments(assignments: readonly ProgressAssignment[]): ProgressSegment[] {
  const counts = new Map<ProgressState, number>();

  for (const assignment of assignments) {
    const state = progressStateOf(assignment.submissions[0]);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  return SEGMENTS.map((segment) => ({ ...segment, count: counts.get(segment.state) ?? 0 })).filter(
    (segment) => segment.count > 0,
  );
}

/**
 * How many of a course's assignments are complete.
 *
 * Here rather than at the call site because it has to agree with the green segment by
 * construction. The header text and the bar telling a student two different numbers is the one
 * failure this pairing can have, and they now read the same function.
 */
export function completeCount(assignments: readonly ProgressAssignment[]): number {
  return assignments.filter((a) => progressStateOf(a.submissions[0]) === "complete").length;
}

/**
 * "3 deliverables with your instructor", or the singular when there is one.
 *
 * The noun is passed in rather than fixed, because a course's work is shown as three bars — one
 * for assignments, one for an assessment's parts, one for a project's deliverables — and a bar
 * over deliverables that called them assignments would be describing something else. The default
 * is the ordinary case, so the single-bar callers say nothing.
 */
export function segmentTooltip(
  segment: ProgressSegment,
  nouns: { one: string; many: string } = { one: "assignment", many: "assignments" },
): string {
  const noun = segment.count === 1 ? nouns.one : nouns.many;
  return `${segment.count} ${noun} · ${segment.label.toLowerCase()}`;
}
