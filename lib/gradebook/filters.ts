/**
 * Narrowing and ordering the gradebook: which students are rows, which assignments are columns,
 * and what the rows are sorted by.
 *
 * **Pure, and computed from the payload already on screen.** The gradebook fetches one course's
 * assignments, units, students, and cells in a single query; every question here is answered from
 * that array rather than from a second read. A filter that went back to the server could return a
 * set the totals above it were not computed from, and the grid would quietly describe two
 * different cohorts at once.
 *
 * **Rows and columns are narrowed by different questions, and deliberately so.** A gradebook is
 * read two ways — "how is this student doing", which wants one row, and "how did the cohort do on
 * this piece of work", which wants a few columns. Searching narrows rows by student; the filter
 * menu narrows columns by unit, by how the work is handed in, and by when it was due. Neither
 * touches the other, so a search for a student never hides the work being asked about.
 *
 * Browser-safe: it imports the generated enum types and nothing else, because the controls that
 * drive it are a client component.
 */

import type { AssignmentKind } from "../generated/prisma/enums";

/** The parts of a student these read. Structural, so a test can build a roster in a line. */
export type SearchableStudent = {
  displayName: string | null;
  email: string | null;
  githubUsername: string | null;
};

/** The parts of an assignment the column filter reads. */
export type FilterableAssignment = {
  id: string;
  title: string;
  courseUnitId: string;
  kind: AssignmentKind;
  dueAt: Date | string | null;
};

/**
 * When work was due, as a question a reader actually asks.
 *
 * Four named answers rather than a pair of date pickers. "Show me what is overdue" and "show me
 * this week" are the two questions an instructor has mid-term; a range control asks them to name
 * two dates to express either, and gets the boundary wrong the first time.
 */
export type DueWindow = "all" | "overdue" | "upcoming" | "undated";

export const DUE_WINDOWS = [
  "all",
  "overdue",
  "upcoming",
  "undated",
] as const satisfies readonly DueWindow[];

/** What each window is called where it is chosen, and what it means. */
export const DUE_WINDOW_META: Record<DueWindow, { label: string; hint: string }> = {
  all: { label: "Any due date", hint: "Every column, dated or not." },
  overdue: { label: "Past due", hint: "Due before now." },
  upcoming: { label: "Due in the next 7 days", hint: "Due from now to a week out." },
  undated: { label: "No due date", hint: "Work with no deadline set." },
};

/** How many days "upcoming" reaches. A week, which is how a cohort's calendar is laid out. */
const UPCOMING_DAYS = 7;

/**
 * Which columns to draw.
 *
 * Empty arrays mean "no restriction" rather than "nothing", which is what makes the unfiltered
 * state the same value as the cleared state: a menu with nothing ticked shows everything, and
 * there is no way to reach a grid with no columns by ticking things off one at a time.
 */
export type ColumnFilter = {
  /** Unit ids to keep. Empty keeps every unit. */
  unitIds: string[];
  /** Submission kinds to keep. Empty keeps every kind. */
  kinds: AssignmentKind[];
  due: DueWindow;
};

export const NO_COLUMN_FILTER: ColumnFilter = { unitIds: [], kinds: [], due: "all" };

/** Whether anything is narrowed, which is what decides if the menu shows a count. */
export function filterIsActive(filter: ColumnFilter): boolean {
  return filter.unitIds.length > 0 || filter.kinds.length > 0 || filter.due !== "all";
}

/** How many separate restrictions are in force, for the badge on the menu button. */
export function activeFilterCount(filter: ColumnFilter): number {
  return (
    (filter.unitIds.length > 0 ? 1 : 0) +
    (filter.kinds.length > 0 ? 1 : 0) +
    (filter.due === "all" ? 0 : 1)
  );
}

/**
 * Whether a student matches what was typed.
 *
 * Every name a student can be known by, not only the display name. A cohort is half people whose
 * display name is set and half who are still only a GitHub handle, and a search that read one
 * field would silently find nobody for the other half — which reads as "this student is not in
 * the course" rather than as "I searched the wrong column".
 *
 * Case-insensitive substring, on a trimmed query. Anything cleverer — initials, fuzzy matching —
 * would sometimes be right and sometimes surprising, and a search box in a gradebook is used to
 * find a person whose name is already known.
 */
export function matchesStudent(student: SearchableStudent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;

  return [student.displayName, student.email, student.githubUsername].some(
    (value) => value != null && value.toLowerCase().includes(needle),
  );
}

/** The roster narrowed to what was typed. Copies rather than filtering in place. */
export function searchStudents<S extends SearchableStudent>(
  students: readonly S[],
  query: string,
): S[] {
  return students.filter((student) => matchesStudent(student, query));
}

/**
 * Whether one assignment survives the column filter.
 *
 * `now` is passed in rather than read, so the due-date windows are testable and so a server
 * render and the browser that hydrates it cannot disagree about where the boundary falls.
 */
export function matchesColumnFilter(
  assignment: FilterableAssignment,
  filter: ColumnFilter,
  now: Date,
): boolean {
  if (filter.unitIds.length > 0 && !filter.unitIds.includes(assignment.courseUnitId)) return false;
  if (filter.kinds.length > 0 && !filter.kinds.includes(assignment.kind)) return false;

  if (filter.due === "all") return true;

  const due = assignment.dueAt == null ? null : new Date(assignment.dueAt).getTime();
  if (filter.due === "undated") return due === null;
  if (due === null) return false;

  const current = now.getTime();
  if (filter.due === "overdue") return due < current;

  return due >= current && due <= current + UPCOMING_DAYS * 24 * 60 * 60 * 1000;
}

/** The columns the filter leaves. */
export function filterAssignments<A extends FilterableAssignment>(
  assignments: readonly A[],
  filter: ColumnFilter,
  now: Date,
): A[] {
  return assignments.filter((assignment) => matchesColumnFilter(assignment, filter, now));
}

/**
 * What the rows are ordered by.
 *
 * `name` is the roster's own order, which is what the grid opens on. `completed` and `waiting`
 * are the two summary columns. `assignment` names one column by id, which is how a reader asks
 * "who did badly on this one" without reading down forty rows.
 */
export type RowSort =
  | { by: "name"; direction: SortDirection }
  | { by: "completed"; direction: SortDirection }
  | { by: "waiting"; direction: SortDirection }
  | { by: "assignment"; assignmentId: string; direction: SortDirection };

export type SortDirection = "asc" | "desc";

/**
 * A column without a direction, which is what a header knows about itself.
 *
 * Spelled out rather than `Omit<RowSort, "direction">`, because omitting a key from a union does
 * not distribute over its members and the result loses `assignmentId` entirely.
 */
export type SortColumn =
  | { by: "name" }
  | { by: "completed" }
  | { by: "waiting" }
  | { by: "assignment"; assignmentId: string };

export const DEFAULT_ROW_SORT: RowSort = { by: "name", direction: "asc" };

/**
 * Clicking a header: the same column reverses, a different column starts fresh.
 *
 * A name starts ascending, because A-to-Z is what a list of people means by "sorted". A number
 * starts *descending*, because the question behind sorting by "waiting on you" is who has the
 * most — and offering zero first would put every student with nothing outstanding at the top,
 * which is the answer nobody clicked for.
 */
export function toggleSort(current: RowSort, next: SortColumn): RowSort {
  const opening: SortDirection = next.by === "name" ? "asc" : "desc";

  if (namesSameColumn(current, next)) {
    return { ...current, direction: current.direction === "asc" ? "desc" : "asc" };
  }

  return { ...next, direction: opening };
}

/** Whether a sort is on this column, which is what decides where the arrow is drawn. */
export function namesSameColumn(sort: RowSort, column: SortColumn): boolean {
  if (sort.by !== column.by) return false;
  if (sort.by === "assignment" && column.by === "assignment") {
    return sort.assignmentId === column.assignmentId;
  }
  return true;
}

/** What a student is called, for ordering and for display. One rule, so the two agree. */
export function studentLabel(student: SearchableStudent): string {
  return student.displayName ?? student.email ?? student.githubUsername ?? "";
}

/**
 * The rows in the order the chosen sort puts them.
 *
 * **A student the sort has nothing to say about goes last, whichever way it points.** Sorting by
 * an assignment nobody has a score on yet should not reorder the roster into something arbitrary,
 * and a missing score is not a low one — the same distinction the cells draw between an empty
 * ring and a zero. Ties break on name, so the order is total and two renders of one grid put the
 * rows in the same places.
 */
export function sortStudents<S extends SearchableStudent & { id: string }>(
  students: readonly S[],
  sort: RowSort,
  values: {
    /** How many pieces of work this student has completed. */
    completed: (studentId: string) => number;
    /** How many of their submissions are waiting on an instructor. */
    waiting: (studentId: string) => number;
    /** Their score on one assignment as a fraction, or null where there is none. */
    score: (studentId: string, assignmentId: string) => number | null;
  },
): S[] {
  const sign = sort.direction === "asc" ? 1 : -1;

  const rank = (student: S): number | null => {
    if (sort.by === "name") return null;
    if (sort.by === "completed") return values.completed(student.id);
    if (sort.by === "waiting") return values.waiting(student.id);
    return values.score(student.id, sort.assignmentId);
  };

  return [...students].sort((a, b) => {
    if (sort.by === "name") {
      return sign * studentLabel(a).localeCompare(studentLabel(b));
    }

    const left = rank(a);
    const right = rank(b);

    if (left === null && right === null) return studentLabel(a).localeCompare(studentLabel(b));
    if (left === null) return 1;
    if (right === null) return -1;

    return sign * (left - right) || studentLabel(a).localeCompare(studentLabel(b));
  });
}
