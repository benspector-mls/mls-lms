import "server-only";

import type { Tx } from "@/lib/prisma";

import { cursorWhere, pageOf, walk, type FeedQuery, type Page, type Positioned } from "./cursor";
import { attendanceClassRecord, classRecord, enrollmentRecord, programRecord } from "./records";

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
 * Two queries, merged and cut by `walk`. The course half is cursored exactly in SQL, because a
 * course's identifier is its id. The program half cannot be: the synthetic identifier
 * `attendance:<id>` is not a column, so `after` has nothing to compare against, and a `take` on an
 * inexactly filtered list could push a needed program off the page and skip it for good. Programs
 * number in the tens, ever. So the program half asks only by instant — every program at or after
 * `since`, no `take` — and `walk` applies the real identifier and cuts. The merge is correct
 * because the first `limit + 1` records of the merged order are within the first `limit + 1` of
 * the courses or within the complete list of programs.
 */
const classes: Collection = async (tx, query) => {
  /*
    `cursorWhere` compares `after` against the `id` column, and `course.id` is a uuid column. A
    cursor whose last-kept record was an Attendance class carries a synthetic `after` of the form
    `attendance:<program id>`, which Postgres refuses to cast to uuid — it fails the whole query
    at bind time, before any row is looked at, whichever side of the OR would have matched. So a
    boundary of that shape is asked by `since` alone, which asks for one instant's worth of
    courses at most: the same tolerance already accepted for the program half below.
  */
  const courseWhere =
    query.cursor !== null && query.cursor.after.startsWith("attendance:")
      ? { updatedAt: { gte: query.cursor.since }, publishedAt: { not: null } }
      : { ...cursorWhere(query.cursor), publishedAt: { not: null } };

  const [courses, programRows] = await Promise.all([
    tx.course.findMany({
      where: courseWhere,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      select: { id: true, programId: true, name: true, archivedAt: true, updatedAt: true },
    }),
    tx.program.findMany({
      where: query.cursor === null ? {} : { updatedAt: { gte: query.cursor.since } },
      select: { id: true, updatedAt: true },
    }),
  ]);

  return walk([...courses.map(classRecord), ...programRows.map(attendanceClassRecord)], query);
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
  assignments: notBuiltYet("assignments"),
  sessions: notBuiltYet("sessions"),
  attendance: notBuiltYet("attendance"),
  submissions: notBuiltYet("submissions"),
  "gcf-attempts": notBuiltYet("gcf-attempts"),
};
