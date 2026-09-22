import "server-only";

import type { Tx } from "@/lib/prisma";

import { cursorWhere, pageOf, walk, type FeedQuery, type Page, type Positioned } from "./cursor";
import {
  assignmentRecord,
  attendanceClassRecord,
  attendanceRecord,
  classRecord,
  enrollmentRecord,
  gcfAttemptRecord,
  programRecord,
  registrationRecord,
  sessionRecord,
  submissionRecord,
  type SubmissionRecord,
} from "./records";

/**
 * The nine collections the Salesforce feed serves, and the queries behind them.
 *
 * This is the only module in the feed that runs a query. Each collection is a function from a
 * client and a parsed query to a page; `feed.ts` looks the name up here and calls it. Six read
 * one table each, adding `cursorWhere` to their own conditions and letting Postgres order and cut.
 * `classes` reads two small tables and walks them in memory, for the reason its own comment gives.
 * Two — `registrations` and `submissions` — have no table, so they load the small tables they are
 * made from and hand the computed records to `walk`.
 *
 * **Test students are filtered here, in every query that reaches a profile.** Their rows are
 * fabrications and must never reach a system of record; the screens that draw a whole roster
 * filter on the same column themselves, and this is that rule applied at the edge.
 *
 * **Ordered in the table below as Make must run them.** A child upsert fails in Salesforce when
 * its parent is not there yet, and the order here is the dependency order. The route does not
 * enforce it — a caller may read any collection at any time — but a reader of this file should
 * see it.
 */

export type Collection = (tx: Tx, query: FeedQuery) => Promise<Page<Positioned>>;

export const COLLECTION_NAMES = [
  "programs",
  "enrollments",
  "classes",
  "registrations",
  "assignments",
  "sessions",
  "attendance",
  "submissions",
  "gcf-attempts",
] as const;

export type CollectionName = (typeof COLLECTION_NAMES)[number];

export function isCollectionName(value: string): value is CollectionName {
  return (COLLECTION_NAMES as readonly string[]).includes(value);
}

/** Every query that reaches a profile spreads this into its `where`. */
const NOT_A_TEST_STUDENT = { student: { testStudentNumber: null } } as const;

const programs: Collection = async (tx, query) => {
  const rows = await tx.program.findMany({
    where: cursorWhere(query.cursor),
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: { id: true, name: true, term: true, discipline: true, updatedAt: true },
  });
  return pageOf(rows.map(programRecord), query.limit);
};

const enrollments: Collection = async (tx, query) => {
  const rows = await tx.enrollment.findMany({
    where: { ...cursorWhere(query.cursor), ...NOT_A_TEST_STUDENT },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      programId: true,
      status: true,
      updatedAt: true,
      student: { select: { id: true, email: true, displayName: true } },
    },
  });
  return pageOf(rows.map(enrollmentRecord), query.limit);
};

/**
 * Published courses, plus one Attendance class per program.
 *
 * Two queries, merged and cut by `walk`. Neither is cursored exactly: the Attendance class's
 * identifier `attendance:<programId>` is not a column, so `after` has nothing in SQL to compare
 * against, and on a page boundary that lands on one, a comparison against `courses.id` — a uuid —
 * is refused by Postgres rather than merely wrong. Both tables run to at most a few hundred rows,
 * so both halves ask only by instant — everything at or after `since`, no `take` — and `walk`
 * applies the real identifier and cuts. That costs less than a query that branches on the shape of
 * `after` to stay exact where it can.
 */
const classes: Collection = async (tx, query) => {
  const since = query.cursor === null ? {} : { updatedAt: { gte: query.cursor.since } };

  const [courses, programRows] = await Promise.all([
    tx.course.findMany({
      where: { ...since, publishedAt: { not: null } },
      select: { id: true, programId: true, name: true, archivedAt: true, updatedAt: true },
    }),
    tx.program.findMany({
      where: since,
      select: { id: true, updatedAt: true },
    }),
  ]);

  return walk([...courses.map(classRecord), ...programRows.map(attendanceClassRecord)], query);
};

/** Distributed, in a published course. A draft no fellow has seen has no place here, and an assignment whose course is unpublished has no Class in Salesforce to hang from. */
const assignments: Collection = async (tx, query) => {
  const rows = await tx.assignment.findMany({
    where: {
      ...cursorWhere(query.cursor),
      distributedAt: { not: null },
      course: { publishedAt: { not: null } },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      courseId: true,
      title: true,
      kind: true,
      pointValue: true,
      dueAt: true,
      updatedAt: true,
      courseUnit: { select: { category: true } },
    },
  });
  return pageOf(rows.map(assignmentRecord), query.limit);
};

const sessions: Collection = async (tx, query) => {
  const rows = await tx.attendanceSession.findMany({
    where: cursorWhere(query.cursor),
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      programId: true,
      date: true,
      startedAt: true,
      endedAt: true,
      updatedAt: true,
    },
  });
  return pageOf(rows.map(sessionRecord), query.limit);
};

const attendance: Collection = async (tx, query) => {
  const rows = await tx.attendanceRecord.findMany({
    where: { ...cursorWhere(query.cursor), enrollment: NOT_A_TEST_STUDENT },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      sessionId: true,
      enrollmentId: true,
      status: true,
      source: true,
      checkedInAt: true,
      note: true,
      updatedAt: true,
    },
  });
  return pageOf(rows.map(attendanceRecord), query.limit);
};

/**
 * Both kinds, with the fellow's most recent enrollment read through the student in the same
 * query. `take: 1` ordered by creation, so the mapper sees at most one and reads it or null.
 */
const gcfAttempts: Collection = async (tx, query) => {
  const rows = await tx.gcfAttempt.findMany({
    where: { ...cursorWhere(query.cursor), ...NOT_A_TEST_STUDENT },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      kind: true,
      score: true,
      scorePossible: true,
      takenOn: true,
      integrityFlagged: true,
      resultUrl: true,
      updatedAt: true,
      student: {
        select: {
          id: true,
          enrollments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
        },
      },
    },
  });
  return pageOf(rows.map(gcfAttemptRecord), query.limit);
};

/**
 * A fellow in a course, for every published course and every enrollment in its program.
 *
 * No table holds this pair. The rule in this application is that being on a program's roster
 * makes somebody a student of every course of it (`lib/assignments/scope.ts`), so the pair is
 * formed here from the two tables that decide it. Both are small — a few hundred rows between
 * them — so loading them whole and walking the pairs in memory costs less than a query that could
 * express the join, and the cursor applies through `walk` exactly as it does in SQL elsewhere.
 *
 * Removed fellows keep their registrations: leaving a roster does not unmake the classes they sat
 * in, and their Assignment Submissions still name these. `enrollmentStatus` travels so a report on
 * the current roster can exclude them.
 */
const registrations: Collection = async (tx, query) => {
  const [courses, enrollmentRows] = await Promise.all([
    tx.course.findMany({
      where: { publishedAt: { not: null } },
      select: { id: true, programId: true, updatedAt: true },
    }),
    tx.enrollment.findMany({
      where: NOT_A_TEST_STUDENT,
      select: { id: true, programId: true, status: true, updatedAt: true },
    }),
  ]);

  const byProgram = new Map<string, typeof enrollmentRows>();
  for (const enrollment of enrollmentRows) {
    const list = byProgram.get(enrollment.programId) ?? [];
    list.push(enrollment);
    byProgram.set(enrollment.programId, list);
  }

  const records = courses.flatMap((course) =>
    (byProgram.get(course.programId) ?? []).map((enrollment) =>
      registrationRecord(course, enrollment),
    ),
  );

  return walk(records, query);
};

/**
 * One record per active fellow per distributed assignment, with the `submissions` row overlaid
 * where there is one.
 *
 * Salesforce has always held an Assignment Submission for every fellow on every assignment, and
 * reports there read a missing row as an error rather than as "not started". This keeps the grid
 * complete. A fellow has a `submissions` row only once they accept or hand in, so the pairs are
 * formed here from the assignments and the enrollments, and the rows are laid on top by
 * `(assignmentId, studentId)` — which is what `submissions` is unique on.
 *
 * **Every row is loaded, not only the changed ones.** A pair's synthesised record must be
 * replaced by its real row even when that row is old, or a page produced by an assignment's
 * `updatedAt` moving would say `notStarted` about somebody who was graded in February. Without the
 * report text the rows are narrow, and at a few thousand of them that is milliseconds;
 * `attachFeedback` below is why the text is not among them. The day the row count itself is the
 * problem, the answer is a materialised table rather than a cleverer query.
 *
 * **Only active enrollments are synthesised.** A removed fellow's real rows are sent — the work
 * happened — but no `notStarted` is invented for assignments distributed after they left.
 */
const submissions: Collection = async (tx, query) => {
  const [assignmentRows, enrollmentRows, submissionRows] = await Promise.all([
    tx.assignment.findMany({
      where: { distributedAt: { not: null }, course: { publishedAt: { not: null } } },
      select: {
        id: true,
        courseId: true,
        dueAt: true,
        updatedAt: true,
        course: { select: { programId: true } },
      },
    }),
    tx.enrollment.findMany({
      where: NOT_A_TEST_STUDENT,
      select: { id: true, programId: true, studentId: true, status: true, updatedAt: true },
    }),
    tx.submission.findMany({
      where: {
        ...NOT_A_TEST_STUDENT,
        assignment: { distributedAt: { not: null }, course: { publishedAt: { not: null } } },
      },
      select: {
        assignmentId: true,
        studentId: true,
        status: true,
        submittedAt: true,
        finalScore: true,
        finalScorePossible: true,
        isComplete: true,
        gradedAt: true,
        extendedDueAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const activeByProgram = new Map<string, typeof enrollmentRows>();
  const enrollmentOf = new Map<string, (typeof enrollmentRows)[number]>();
  for (const enrollment of enrollmentRows) {
    enrollmentOf.set(`${enrollment.programId}:${enrollment.studentId}`, enrollment);
    if (enrollment.status !== "ACTIVE") continue;
    const list = activeByProgram.get(enrollment.programId) ?? [];
    list.push(enrollment);
    activeByProgram.set(enrollment.programId, list);
  }

  const records = new Map<string, SubmissionRecord>();

  for (const assignment of assignmentRows) {
    for (const enrollment of activeByProgram.get(assignment.course.programId) ?? []) {
      const record = submissionRecord({ assignment, enrollment }, null);
      records.set(record.externalId, record);
    }
  }

  const assignmentById = new Map(assignmentRows.map((assignment) => [assignment.id, assignment]));
  /** Which records carry a released grade, and the row to fetch its text from. */
  const released = new Map<string, { assignmentId: string; studentId: string }>();
  for (const row of submissionRows) {
    const assignment = assignmentById.get(row.assignmentId);
    if (!assignment) continue;
    const enrollment = enrollmentOf.get(`${assignment.course.programId}:${row.studentId}`);
    // A row for somebody not enrolled in the program cannot name a registration. Not reachable
    // through the application, which reaches every submission through an enrollment.
    if (!enrollment) continue;
    const record = submissionRecord({ assignment, enrollment }, { ...row, feedbackMarkdown: null });
    records.set(record.externalId, record);
    if (row.status === "GRADED" && row.gradedAt !== null) {
      released.set(record.externalId, { assignmentId: row.assignmentId, studentId: row.studentId });
    }
  }

  const page = walk([...records.values()], query);
  await attachFeedback(tx, page.records, released);
  return page;
};

/**
 * The feedback text, fetched for the page and not for the grid.
 *
 * `feedbackMarkdown` is the one wide column the feed touches — a graded report runs to several
 * hundred words — and the grid query loads every row on every page, for the reason its comment
 * gives. Loading the text with them would fetch a term's worth of reports and discard all but one
 * page's, once per page. So the grid leaves it out and this fills it in for the records actually
 * being returned: at most `limit` of them, and only those whose grade is released.
 */
async function attachFeedback(
  tx: Tx,
  page: SubmissionRecord[],
  released: Map<string, { assignmentId: string; studentId: string }>,
): Promise<void> {
  const wanted = page.filter((record) => released.has(record.externalId));
  if (wanted.length === 0) return;

  const rows = await tx.submission.findMany({
    where: { OR: wanted.map((record) => released.get(record.externalId)!) },
    select: { assignmentId: true, studentId: true, feedbackMarkdown: true },
  });
  const text = new Map(
    rows.map((row) => [`${row.assignmentId}:${row.studentId}`, row.feedbackMarkdown]),
  );

  for (const record of wanted) {
    const key = released.get(record.externalId)!;
    record.feedbackMarkdown = text.get(`${key.assignmentId}:${key.studentId}`) ?? null;
  }
}

export const COLLECTIONS: Record<CollectionName, Collection> = {
  programs,
  enrollments,
  classes,
  registrations,
  assignments,
  sessions,
  attendance,
  submissions,
  "gcf-attempts": gcfAttempts,
};
