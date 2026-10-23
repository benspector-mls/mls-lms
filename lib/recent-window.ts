import {
  addSchoolDays,
  formatSchoolDayShort,
  schoolDaySchema,
  type SchoolDay,
} from "@/lib/school-time";

/**
 * The span of days every "recent" figure is read over.
 *
 * **One window for every recent column**, on the Performance tab and on the fellow's record: the
 * mornings missed and late, the deadlines hit, and the graded work that fell short are all counted
 * over the same days, so "how was this fortnight" has one answer rather than four windows of
 * different sizes that happen to overlap. Windows that counted backwards by item — so many mornings,
 * so many deadlines, so many verdicts — would cover different stretches of the term, and a reader
 * comparing two of them would be comparing different weeks.
 *
 * **Two weeks ending today unless an instructor chooses otherwise.** The Performance tab carries
 * the choice in its address, so a chosen range can be linked and survives a reload; everywhere else
 * reads the default. The end can never be later than today, because a deadline that has not passed
 * cannot have been missed and a morning that has not come cannot have been attended.
 *
 * Both ends are school days and both are included. Browser-safe and pure.
 */
export type RecentWindow = { from: SchoolDay; to: SchoolDay };

/** How many days the window holds when nobody has chosen: two weeks, today included. */
export const RECENT_WINDOW_DAYS = 14;

/** The address keys the Performance tab carries a chosen window under. Absent means the default. */
export const WINDOW_PARAMS = { from: "from", to: "to" } as const;

/** The two weeks ending on `today`. */
export function defaultRecentWindow(today: SchoolDay): RecentWindow {
  return { from: addSchoolDays(today, -(RECENT_WINDOW_DAYS - 1)), to: today };
}

/**
 * The window an address asks for, or as much of it as can be honoured.
 *
 * The end is the `to` given when it is a real day on or before today, and today otherwise. The
 * start is the `from` given when it is a real day on or before the end, and two weeks before the
 * end otherwise. Each end is judged on its own, so a link that names only a start still reads to
 * today, and a start after the end falls back rather than producing an empty window.
 */
export function parseRecentWindow(
  params: { from?: string | null; to?: string | null },
  today: SchoolDay,
): RecentWindow {
  const to = isSchoolDay(params.to) && params.to <= today ? params.to : today;
  const from =
    isSchoolDay(params.from) && params.from <= to
      ? params.from
      : addSchoolDays(to, -(RECENT_WINDOW_DAYS - 1));
  return { from, to };
}

function isSchoolDay(value: string | null | undefined): value is SchoolDay {
  return typeof value === "string" && schoolDaySchema.safeParse(value).success;
}

export function isDefaultRecentWindow(window: RecentWindow, today: SchoolDay): boolean {
  const fallback = defaultRecentWindow(today);
  return window.from === fallback.from && window.to === fallback.to;
}

/** Whether a day falls inside the window, both ends included. */
export function inRecentWindow(day: SchoolDay, window: RecentWindow): boolean {
  return day >= window.from && day <= window.to;
}

/** "9/29 – 10/12", for a heading or a tooltip. */
export function formatRecentWindow(window: RecentWindow): string {
  return `${formatSchoolDayShort(window.from)} – ${formatSchoolDayShort(window.to)}`;
}
