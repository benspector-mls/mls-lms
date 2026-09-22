import type {
  AssignmentKind,
  AttendanceSource,
  AttendanceStatus,
  CourseUnitCategory,
  Discipline,
  EnrollmentStatus,
  GcfKind,
  SubmissionStatus,
} from "@/lib/generated/prisma/enums";

import { schoolDayFromColumn } from "@/lib/school-time";
import { lateness, type Lateness } from "@/lib/submissions/hand-in";

import type { Positioned } from "./cursor";

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

// ---------------------------------------------------------------------------------------------
// One record type and one mapper per collection. Each row type below is exactly what the matching
// query in `collections.ts` selects; a mapper takes no more than it emits.
// ---------------------------------------------------------------------------------------------

export type ProgramRecord = Positioned & { name: string; term: string; discipline: Discipline };

export function programRecord(row: {
  id: string;
  name: string;
  term: string;
  discipline: Discipline;
  updatedAt: Date;
}): ProgramRecord {
  return {
    externalId: row.id,
    name: row.name,
    term: row.term,
    discipline: row.discipline,
    updatedAt: row.updatedAt,
  };
}

/**
 * The one record that carries an email address.
 *
 * It is what the setup scenario matches a Program Enrollment on, once. `studentId` is what the
 * Contact is then stamped with — the fellow's own identifier rather than the enrollment's,
 * because a fellow who repeats a term has two enrollments and one Contact.
 */
export type EnrollmentRecord = Positioned & {
  programId: string;
  studentId: string;
  studentEmail: string | null;
  studentName: string | null;
  status: EnrollmentStatus;
};

export function enrollmentRecord(row: {
  id: string;
  programId: string;
  status: EnrollmentStatus;
  updatedAt: Date;
  student: { id: string; email: string | null; displayName: string | null };
}): EnrollmentRecord {
  return {
    externalId: row.id,
    programId: row.programId,
    studentId: row.student.id,
    studentEmail: row.student.email,
    studentName: row.student.displayName,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

export type ClassRecord = Positioned & { programId: string; name: string; archived: boolean };

export function classRecord(row: {
  id: string;
  programId: string;
  name: string;
  archivedAt: Date | null;
  updatedAt: Date;
}): ClassRecord {
  return {
    externalId: row.id,
    programId: row.programId,
    name: row.name,
    archived: row.archivedAt !== null,
    updatedAt: row.updatedAt,
  };
}

/**
 * The Attendance class, made up rather than looked up.
 *
 * Marcy's practice is one Salesforce class per program that exists only to hold the sessions.
 * Nothing here corresponds to it, so the `classes` collection emits it and the `sessions`
 * collection names it as parent. Positioned with the program, so it appears when the program does.
 */
export function attendanceClassRecord(program: { id: string; updatedAt: Date }): ClassRecord {
  return {
    externalId: attendanceClassId(program.id),
    programId: program.id,
    name: "Attendance",
    archived: false,
    updatedAt: program.updatedAt,
  };
}

export type RegistrationRecord = Positioned & {
  classId: string;
  enrollmentId: string;
  enrollmentStatus: EnrollmentStatus;
};

/** A course and an enrollment in its program. Positioned at the later of the two, so a change to either moves it. */
export function registrationRecord(
  course: { id: string; updatedAt: Date },
  enrollment: { id: string; status: EnrollmentStatus; updatedAt: Date },
): RegistrationRecord {
  return {
    externalId: registrationKey(course.id, enrollment.id),
    classId: course.id,
    enrollmentId: enrollment.id,
    enrollmentStatus: enrollment.status,
    updatedAt: later(course.updatedAt, enrollment.updatedAt),
  };
}

export type AssignmentRecord = Positioned & {
  classId: string;
  title: string;
  type: AssignmentType;
  pointValue: number;
  dueAt: Date | null;
};

export function assignmentRecord(row: {
  id: string;
  courseId: string;
  title: string;
  kind: AssignmentKind;
  pointValue: number;
  dueAt: Date | null;
  updatedAt: Date;
  courseUnit: { category: CourseUnitCategory };
}): AssignmentRecord {
  return {
    externalId: row.id,
    classId: row.courseId,
    title: row.title,
    type: assignmentType(row.courseUnit.category),
    pointValue: pointValueOf(row),
    dueAt: row.dueAt,
    updatedAt: row.updatedAt,
  };
}

export type SessionRecord = Positioned & {
  classId: string;
  /** A civil date, `YYYY-MM-DD`. Never a `Date` — see `lib/school-time.ts`. */
  date: string;
  startedAt: Date | null;
  endedAt: Date | null;
};

export function sessionRecord(row: {
  id: string;
  programId: string;
  date: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
}): SessionRecord {
  return {
    externalId: row.id,
    classId: attendanceClassId(row.programId),
    date: schoolDayFromColumn(row.date),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    updatedAt: row.updatedAt,
  };
}

/** Named `AttendanceFeedRecord` because `AttendanceRecord` is the Prisma model. */
export type AttendanceFeedRecord = Positioned & {
  sessionId: string;
  enrollmentId: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  checkedInAt: Date | null;
  note: string | null;
};

export function attendanceRecord(row: {
  id: string;
  sessionId: string;
  enrollmentId: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  checkedInAt: Date | null;
  note: string | null;
  updatedAt: Date;
}): AttendanceFeedRecord {
  return {
    externalId: row.id,
    sessionId: row.sessionId,
    enrollmentId: row.enrollmentId,
    status: row.status,
    source: row.source,
    checkedInAt: row.checkedInAt,
    note: row.note,
    updatedAt: row.updatedAt,
  };
}

export type SubmissionRecord = Positioned & {
  assignmentId: string;
  registrationId: string;
  status: FeedStatus;
  submittedAt: Date | null;
  score: number | null;
  scorePossible: number | null;
  isComplete: boolean | null;
  lateness: Lateness | null;
  gradedAt: Date | null;
  feedbackMarkdown: string | null;
};

/** The assignment and the enrollment a record is about. Present for every fellow on every distributed assignment. */
export type SubmissionPair = {
  assignment: { id: string; courseId: string; dueAt: Date | null; updatedAt: Date };
  enrollment: { id: string; updatedAt: Date };
};

/** The `submissions` row, when the fellow has started. Exactly what `collections.ts` selects. */
export type SubmissionRow = {
  status: SubmissionStatus;
  submittedAt: Date | null;
  finalScore: number | null;
  finalScorePossible: number | null;
  isComplete: boolean | null;
  gradedAt: Date | null;
  feedbackMarkdown: string | null;
  extendedDueAt: Date | null;
  updatedAt: Date;
};

/**
 * One fellow on one assignment, whether or not they have started.
 *
 * **Without a row** the record is `notStarted` with every grade field null, positioned at the
 * later of its two parents — so a newly distributed assignment produces a page of new records,
 * and a fellow joining late produces one per assignment already out.
 *
 * **With a row**, the grade travels only once released: `status = GRADED` with `gradedAt` set,
 * which is exactly what `sharedAfterGrade` writes. A `RESUBMITTED` row still holds the previous
 * grade in its columns, and that grade is withheld, because the work standing is not the work
 * that grade described. Work graded but not released lives in `grading_drafts` and never reaches
 * this row at all.
 *
 * `lateness` is null until something was handed in. The function it calls answers "onTime" for a
 * null hand-in, which is the right answer for a dashboard and the wrong one for a record — nothing
 * about work that has not arrived is on time.
 */
export function submissionRecord(
  pair: SubmissionPair,
  row: SubmissionRow | null,
): SubmissionRecord {
  const identity = {
    externalId: submissionKey(pair.assignment.id, pair.enrollment.id),
    assignmentId: pair.assignment.id,
    registrationId: registrationKey(pair.assignment.courseId, pair.enrollment.id),
  };

  if (row === null) {
    return {
      ...identity,
      status: "notStarted",
      submittedAt: null,
      score: null,
      scorePossible: null,
      isComplete: null,
      lateness: null,
      gradedAt: null,
      feedbackMarkdown: null,
      updatedAt: later(pair.assignment.updatedAt, pair.enrollment.updatedAt),
    };
  }

  const released = row.status === "GRADED" && row.gradedAt !== null;

  return {
    ...identity,
    status: collapseStatus(row.status),
    submittedAt: row.submittedAt,
    score: released ? row.finalScore : null,
    scorePossible: released ? row.finalScorePossible : null,
    isComplete: released ? row.isComplete : null,
    lateness:
      row.submittedAt === null
        ? null
        : lateness({
            dueAt: pair.assignment.dueAt,
            submittedAt: row.submittedAt,
            extendedDueAt: row.extendedDueAt,
          }),
    gradedAt: released ? row.gradedAt : null,
    feedbackMarkdown: released ? row.feedbackMarkdown : null,
    updatedAt: row.updatedAt,
  };
}

export type GcfAttemptRecord = Positioned & {
  /** The fellow's most recent enrollment. Null for a fellow with none, which Make's error branch should catch. */
  enrollmentId: string | null;
  contactId: string;
  kind: GcfKind;
  score: number;
  scorePossible: number | null;
  /** A civil date, `YYYY-MM-DD`. */
  takenOn: string;
  integrityFlagged: boolean;
  resultUrl: string | null;
};

/**
 * An attempt belongs to a person and carries no program; an Artifact belongs to a Program
 * Enrollment and also names the Contact. The query hands over the student's single most recent
 * enrollment, and this reads it — for nearly everyone their only one.
 */
export function gcfAttemptRecord(row: {
  id: string;
  kind: GcfKind;
  score: number;
  scorePossible: number | null;
  takenOn: Date;
  integrityFlagged: boolean;
  resultUrl: string | null;
  updatedAt: Date;
  student: { id: string; enrollments: { id: string }[] };
}): GcfAttemptRecord {
  return {
    externalId: row.id,
    enrollmentId: row.student.enrollments[0]?.id ?? null,
    contactId: row.student.id,
    kind: row.kind,
    score: row.score,
    scorePossible: row.scorePossible,
    takenOn: schoolDayFromColumn(row.takenOn),
    integrityFlagged: row.integrityFlagged,
    resultUrl: row.resultUrl,
    updatedAt: row.updatedAt,
  };
}
