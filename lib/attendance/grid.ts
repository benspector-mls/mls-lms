import type { AttendanceSource, AttendanceStatus } from "@/lib/generated/prisma/enums";

import { sessionStateOf, type SessionState, type WindowSession } from "./window";

/**
 * One session's roster, with what each fellow did attached.
 *
 * **The roster comes from the enrollments and never from the records.** That is the whole reason
 * this file exists rather than the screen mapping over what the database returned: a fellow who
 * did not check in has no row, and a grid built from rows would silently omit exactly the people
 * an instructor opened the screen to deal with.
 *
 * **What a missing row means depends on the session, not on the row.** While check-in is open it
 * means "not yet", which is a live count nobody should read as an absence. Once the session has
 * ended or lapsed it means absent — and it goes on meaning that until the absences are written
 * down, at which point every fellow has a row and this branch stops being reachable. Deriving it
 * here is what lets the writing happen whenever somebody next passes through, instead of at a
 * moment no scheduler exists to notice.
 */

export type GridEnrollment = {
  enrollmentId: string;
  student: {
    id: string;
    displayName: string | null;
    email: string | null;
    githubUsername: string | null;
    testStudentNumber: number | null;
  };
};

export type GridRecord = {
  enrollmentId: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  checkedInAt: Date | null;
  note: string | null;
  recordedByName: string | null;
};

/** What a cell says when nobody has written a row for it. */
export type PendingReason = "not-yet" | "no-check-in";

export type GridRow = GridEnrollment & {
  /** Null when nothing has been recorded for this fellow yet. */
  record: GridRecord | null;
  /** Only set when `record` is null. What the empty cell should say. */
  pending: PendingReason | null;
};

export type GridCounts = {
  present: number;
  late: number;
  excused: number;
  absent: number;
  /** Enrollments with no record at all. Counted apart, because it is not yet a fact about anyone. */
  unrecorded: number;
};

/**
 * Compose the roster and the records into the rows a screen draws.
 *
 * Records whose enrollment is not in `enrollments` are dropped rather than appended. They arise
 * legitimately — a removed fellow who was there that day, when the caller asked only for active
 * ones — and a headless row would render as a nameless line in the middle of the grid.
 */
export function gridRows(
  enrollments: GridEnrollment[],
  records: GridRecord[],
  session: WindowSession | null,
  now: Date,
): GridRow[] {
  const byEnrollment = new Map(records.map((record) => [record.enrollmentId, record]));
  const state: SessionState | null = session ? sessionStateOf(session, now) : null;
  const pending: PendingReason = state === "open" ? "not-yet" : "no-check-in";

  return enrollments.map((enrollment) => {
    const record = byEnrollment.get(enrollment.enrollmentId) ?? null;
    return { ...enrollment, record, pending: record ? null : pending };
  });
}

export function gridCounts(rows: GridRow[]): GridCounts {
  const counts: GridCounts = { present: 0, late: 0, excused: 0, absent: 0, unrecorded: 0 };

  for (const row of rows) {
    if (!row.record) counts.unrecorded += 1;
    else if (row.record.status === "PRESENT") counts.present += 1;
    else if (row.record.status === "LATE") counts.late += 1;
    else if (row.record.status === "EXCUSED") counts.excused += 1;
    else counts.absent += 1;
  }

  return counts;
}

/**
 * The two lists the correction screen draws, in that order.
 *
 * Whoever needs an instructor's attention floats to the top, rather than sitting in one
 * alphabetical list the reader has to scan. The gradebook and the roster both split their tables
 * for the same reason: a distinction worth acting on should not be something you find by reading
 * carefully.
 */
export function splitForCorrection(rows: GridRow[]): {
  unresolved: GridRow[];
  recorded: GridRow[];
} {
  return {
    unresolved: rows.filter((row) => row.record === null),
    recorded: rows.filter((row) => row.record !== null),
  };
}
