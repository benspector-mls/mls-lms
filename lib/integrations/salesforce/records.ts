import type {
  AssignmentKind,
  CourseUnitCategory,
  SubmissionStatus,
} from "@/lib/generated/prisma/enums";

/**
 * What a Salesforce record says, given a row from here.
 *
 * Every function in this file decides something from its arguments and nothing else. The queries
 * that produce the rows are in `collections.ts`; this is where a row becomes the flat object Make
 * upserts, where the identifiers Salesforce keys on are spelled, and where the two vocabularies
 * that differ between the systems — submission status and assignment type — are translated.
 *
 * **The identifiers are spelled here and nowhere else.** A Class Registration and an unstarted
 * Assignment Submission have no row of their own, so their identifiers are pairs, and the pair
 * has to be built the same way by the collection that emits the record and by every record that
 * names it as a parent. One function each is what makes that a property rather than a hope.
 */

/** The one class per program that holds its attendance sessions. Nothing here corresponds to it. */
export function attendanceClassId(programId: string): string {
  return `attendance:${programId}`;
}

/** A fellow in a course: the pair, because there is no table. */
export function registrationKey(courseId: string, enrollmentId: string): string {
  return `${courseId}:${enrollmentId}`;
}

/**
 * A fellow on an assignment: the pair rather than the `submissions` row's id.
 *
 * A row is created when a fellow first accepts or hands in, so a fellow who has not started has
 * no row and no UUID — but Salesforce holds an Assignment Submission for every fellow on every
 * assignment from the day it is distributed. Keying on the pair means the record Salesforce holds
 * for somebody who has not started is the same record that later carries their grade.
 */
export function submissionKey(assignmentId: string, enrollmentId: string): string {
  return `${assignmentId}:${enrollmentId}`;
}

/** The later of two instants, for a computed record whose position is the later of its parents'. */
export function later(a: Date, b: Date): Date {
  return a > b ? a : b;
}

export type FeedStatus = "notStarted" | "inProgress" | "submitted" | "graded";

/**
 * Eight statuses onto four.
 *
 * `DRAFT_READY`, `GRADING_FAILED`, and `NEEDS_MANUAL_REVIEW` describe the grading pipeline, not
 * the work, and to anyone outside it all three mean "handed in, not yet graded". `RESUBMITTED` is
 * the same fact about work that was graded once already. Make maps these four onto the picklist's
 * exact spelling, which is a fact about Salesforce and is kept there.
 */
export function collapseStatus(status: SubmissionStatus): FeedStatus {
  switch (status) {
    case "NOT_STARTED":
      return "notStarted";
    case "ACCEPTED":
      return "inProgress";
    case "SUBMITTED":
    case "RESUBMITTED":
    case "DRAFT_READY":
    case "GRADING_FAILED":
    case "NEEDS_MANUAL_REVIEW":
      return "submitted";
    case "GRADED":
      return "graded";
  }
}

export type AssignmentType = "assignment" | "project" | "assessment";

/**
 * Salesforce's three types, from the category of the unit the assignment sits in.
 *
 * The distinction Salesforce draws is where the work sits in the curriculum, not how it is handed
 * in — which is why `CourseUnitCategory` answers this and `AssignmentKind` does not.
 */
export function assignmentType(category: CourseUnitCategory): AssignmentType {
  switch (category) {
    case "MODULE":
      return "assignment";
    case "PROJECT":
      return "project";
    case "ASSESSMENT":
      return "assessment";
  }
}

/**
 * One point for a task, the column for everything else.
 *
 * `assignmentPointValue` in `lib/assignments/spec.ts` computes the same answer from the
 * assignment's sections. The feed holds no sections and needs none: a task is worth one point by
 * rule, and every other kind keeps its total in the column. This is that function's one-sentence
 * content, written here rather than reached for.
 */
export function pointValueOf(assignment: { kind: AssignmentKind; pointValue: number }): number {
  return assignment.kind === "TASK" ? 1 : assignment.pointValue;
}
