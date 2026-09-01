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
 * Browser-safe, because the controls that drive it are a client component: the generated enum
 * types, and `lib/school-time` for the one question that needs a timezone — where the boundary of
 * a custom date range falls, which is a wall clock in Brooklyn rather than an instant in UTC.
 */

import { instantAtSchoolClock, schoolDaySchema } from "../school-time";
import { AssignmentKind } from "../generated/prisma/enums";

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
 * **Four named answers and a range.** The named ones are the questions an instructor has mid-term
 * — "show me what is overdue", "show me the coming week" — and each of them is one click, where
 * expressing either as two dates would mean working out a boundary and getting it wrong the first
 * time. The range answers the question the four cannot put: one particular stretch of the
 * calendar, a fortnight or a sprint somebody is looking back over.
 */
export type DueWindow = "all" | "overdue" | "upcoming" | "undated" | DueRange;

/**
 * A stretch of the calendar, as two school days written `"YYYY-MM-DD"`.
 *
 * **Either side may be null, which means unbounded in that direction.** "Everything due before the
 * module ends" and "everything due since the term started" are each one field filled in, and
 * requiring the other would make a reader name a date they do not care about.
 *
 * **Both ends are inclusive, and both are read in the school's timezone.** Work due at 11:59pm on
 * the day named in `to` is inside the range, which is what "up to the 14th" means to everybody who
 * is not a computer — and reading the boundary in UTC would put that same deadline outside it,
 * because 11:59pm in Brooklyn is four hours into the next UTC day.
 */
export type DueRange = { from: string | null; to: string | null };

/** The four named answers, which is what the menu offers above the range. */
export const DUE_WINDOWS = ["all", "overdue", "upcoming", "undated"] as const;

/**
 * One of the four, as distinct from a range.
 *
 * Needed because `DueWindow` is no longer a union of string literals: a `Record` keyed by it would
 * have to have an entry for every possible range, and the menu below only ever labels these four.
 */
export type DueWindowName = (typeof DUE_WINDOWS)[number];

/** What each window is called where it is chosen, and what it means. */
export const DUE_WINDOW_META: Record<DueWindowName, { label: string; hint: string }> = {
  all: { label: "Any due date", hint: "Every column, dated or not." },
  overdue: { label: "Past due", hint: "Due before now." },
  upcoming: { label: "Due in the next 7 days", hint: "Due from now to a week out." },
  undated: { label: "No due date", hint: "Work with no deadline set." },
};

/** How many days "upcoming" reaches. A week, which is how a cohort's calendar is laid out. */
const UPCOMING_DAYS = 7;

/**
 * Whether a due-date choice narrows anything.
 *
 * A range with both ends open does not, and it is reachable — choosing "Custom range" sets one
 * before either date is typed. Counting it would put a permanent restriction on the badge and
 * offer a "Clear the filter" item that clears nothing.
 */
export function dueIsActive(due: DueWindow): boolean {
  if (typeof due === "string") return due !== "all";
  return due.from !== null || due.to !== null;
}

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
  return filter.unitIds.length > 0 || filter.kinds.length > 0 || dueIsActive(filter.due);
}

/** How many separate restrictions are in force, for the badge on the menu button. */
export function activeFilterCount(filter: ColumnFilter): number {
  return (
    (filter.unitIds.length > 0 ? 1 : 0) +
    (filter.kinds.length > 0 ? 1 : 0) +
    (dueIsActive(filter.due) ? 1 : 0)
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

  if (!dueIsActive(filter.due)) return true;

  const due = assignment.dueAt == null ? null : new Date(assignment.dueAt).getTime();

  if (typeof filter.due !== "string") {
    // A range is a question about the calendar, and work with no deadline is not an answer to it —
    // the same rule "past due" follows below, and the reason "No due date" is its own window.
    if (due === null) return false;

    const { from, to } = filter.due;
    if (from !== null && due < instantAtSchoolClock(from, "00:00").getTime()) return false;
    if (to !== null && due > instantAtSchoolClock(to, "23:59").getTime()) return false;
    return true;
  }

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
 * The three query parameters a filter is written as.
 *
 * Named here rather than at the two call sites so that clearing them before writing a new filter
 * cannot fall out of step with what `encodeColumnFilter` produces — a parameter dropped from the
 * encoding and left in this list is harmless, one added and forgotten would stick to the address
 * forever.
 */
export const COLUMN_FILTER_PARAMS = ["units", "kinds", "due"] as const;

/**
 * The filter as query parameters, so a narrowed screen is an address.
 *
 * **Nothing narrowed writes nothing at all.** An unfiltered screen has a clean URL, which is what
 * makes the cleared state and the initial state the same address rather than two that differ by a
 * string of empty parameters.
 */
export function encodeColumnFilter(filter: ColumnFilter): URLSearchParams {
  const params = new URLSearchParams();

  if (filter.unitIds.length > 0) params.set("units", filter.unitIds.join(","));
  if (filter.kinds.length > 0) params.set("kinds", filter.kinds.join(","));

  /*
    A range is written whether or not it has dates in it yet, which is the one place this parameter
    records a *choice* rather than a restriction. Choosing "Custom range" is a state the menu has to
    hold before either date is typed — dropping `..` for narrowing nothing is what made the two date
    fields vanish the instant they were asked for, because the choice had nowhere to live.

    A named window still writes nothing when it is "Any due date". That is the unfiltered state, and
    it keeps a screen nobody has narrowed on a clean address.
  */
  if (typeof filter.due !== "string") {
    params.set("due", `${filter.due.from ?? ""}..${filter.due.to ?? ""}`);
  } else if (filter.due !== "all") {
    params.set("due", filter.due);
  }

  return params;
}

/**
 * The filter an address names.
 *
 * **Anything unrecognised is dropped rather than refused**: a unit id that is not one of this
 * screen's units, a kind that is not one of the three, a date that is not a date. A stale link or
 * a hand-edited address then lands on a wider screen than whoever wrote it intended, which is the
 * safe direction — the other one is an empty screen with a uuid showing in the menu, which reads
 * as "there is no work here" rather than as "that link is out of date".
 *
 * `known.unitIds` is the caller's own list, which both callers hold already: the gradebook has the
 * units of the open tab, and triage the units of the course.
 */
export function parseColumnFilter(
  params: URLSearchParams,
  known: { unitIds: Set<string> },
): ColumnFilter {
  const values = (key: string) => [
    ...new Set(
      (params.get(key) ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== ""),
    ),
  ];

  const kinds = new Set<string>(Object.values(AssignmentKind));

  return {
    unitIds: values("units").filter((id) => known.unitIds.has(id)),
    kinds: values("kinds").filter((kind): kind is AssignmentKind => kinds.has(kind)),
    due: parseDueWindow(params.get("due")),
  };
}

/** `"overdue"`, or `"2026-01-06..2026-02-14"` with either side allowed to be empty. */
function parseDueWindow(raw: string | null): DueWindow {
  if (raw === null) return "all";
  if ((DUE_WINDOWS as readonly string[]).includes(raw)) return raw as DueWindowName;
  if (!raw.includes("..")) return "all";

  // Both ends open is a real answer — "Custom range, no dates yet" — so it comes back as a range
  // rather than as "all". It narrows nothing either way: `dueIsActive` is what the badge and the
  // matching read, and neither counts an empty range.
  const [from, to] = raw.split("..");
  return { from: asSchoolDay(from), to: asSchoolDay(to) };
}

/** One end of a range, or null where what was written is not a real date. */
function asSchoolDay(value: string): string | null {
  return schoolDaySchema.safeParse(value).success ? value : null;
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
