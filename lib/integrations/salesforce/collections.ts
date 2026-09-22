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
  sessionRecord,
} from "./records";

/**
 * The nine collections the Salesforce feed serves, and the queries behind them.
 *
 * This is the only module in the feed that runs a query. Each collection is a function from a
 * client and a parsed query to a page; `feed.ts` looks the name up here and calls it. Seven read
 * one table each, adding `cursorWhere` to their own conditions and letting Postgres order and cut.
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

/** Distributed only. An undistributed assignment is a draft no fellow has seen. */
const assignments: Collection = async (tx, query) => {
  const rows = await tx.assignment.findMany({
    where: { ...cursorWhere(query.cursor), distributedAt: { not: null } },
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

const notBuiltYet =
  (name: CollectionName): Collection =>
  async () => {
    throw new Error(`${name} is not built yet`);
  };

export const COLLECTIONS: Record<CollectionName, Collection> = {
  programs,
  enrollments,
  classes,
  registrations: notBuiltYet("registrations"),
  assignments,
  sessions,
  attendance,
  submissions: notBuiltYet("submissions"),
  "gcf-attempts": gcfAttempts,
};
