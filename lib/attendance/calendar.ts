import { dateColumnFor, schoolDayFromColumn, type SchoolDay } from "@/lib/school-time";

/**
 * A month of school days, as a grid.
 *
 * **Every date here is arithmetic on UTC, never on a local `Date`.** A school day is a civil date
 * — see `lib/school-time.ts` — and the moment this file builds a `new Date(year, month, 1)` it is
 * asking the reader's machine what day that is, which is the previous day for anybody west of
 * Greenwich. Everything below goes through `Date.UTC` and `schoolDayFromColumn`, so the grid a
 * fellow in Brooklyn sees and the grid the server would build are the same grid.
 *
 * Pure, and no `server-only`: the calendar is a client component with month buttons, and this is
 * the half of it worth testing.
 */

/** A month, written `"YYYY-MM"`. The unit the calendar pages by. */
export type SchoolMonth = string;

export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** Which month a school day falls in. */
export function monthOf(day: SchoolDay): SchoolMonth {
  return day.slice(0, 7);
}

/** The month `delta` months away, which may cross a year in either direction. */
export function addMonths(month: SchoolMonth, delta: number): SchoolMonth {
  const [year, index] = month.split("-").map(Number);
  // `Date.UTC` normalises an out-of-range month, so December + 1 becomes January of the next
  // year without this having to know how many months there are.
  const shifted = new Date(Date.UTC(year, index - 1 + delta, 1));
  return schoolDayFromColumn(shifted).slice(0, 7);
}

/** "September 2026", for the heading between the two arrows. */
export function formatMonth(month: SchoolMonth): string {
  return dateColumnFor(`${month}-01`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

export type CalendarCell = {
  day: SchoolDay;
  /** False for the days either side that fill the first and last rows. */
  inMonth: boolean;
};

/**
 * The weeks a month is drawn as, Sunday first.
 *
 * Always whole weeks, padded from the months either side, because a grid whose first row starts
 * mid-way needs empty cells anyway and a real date in them is more use than a blank: it is what
 * lets a session on the 1st of a month appear when you are looking at the 31st of the one before.
 */
export function monthGrid(month: SchoolMonth): CalendarCell[][] {
  const [year, index] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1));

  // Back up to the Sunday on or before the 1st. `getUTCDay` is 0 for Sunday.
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - first.getUTCDay());

  const weeks: CalendarCell[][] = [];
  const cursor = new Date(start);

  // Six weeks covers every arrangement a month can take; trailing all-outside weeks are dropped
  // below so a short month does not draw an empty final row.
  for (let week = 0; week < 6; week += 1) {
    const cells: CalendarCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = schoolDayFromColumn(cursor);
      cells.push({ day, inMonth: monthOf(day) === month });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(cells);
  }

  while (weeks.length > 0 && weeks[weeks.length - 1].every((cell) => !cell.inMonth)) {
    weeks.pop();
  }

  return weeks;
}

/**
 * The week a school day falls in, Monday through Sunday.
 *
 * **Monday first, unlike `monthGrid` above.** A month is a calendar and calendars here start on
 * Sunday; a school week is the block of mornings a cohort meets, and it starts when they do.
 *
 * The whole seven days rather than the five, so that a session held on a Saturday is inside the
 * range and can be found. What gets *drawn* is `weekColumns`, which is a narrower question.
 */
export function weekRange(day: SchoolDay): { from: SchoolDay; to: SchoolDay } {
  const cursor = dateColumnFor(day);
  // `getUTCDay` is 0 for Sunday, so Sunday backs up six days rather than none — it is the end of
  // its week here, not the start of the next one.
  const weekday = cursor.getUTCDay();
  cursor.setUTCDate(cursor.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));

  const from = schoolDayFromColumn(cursor);
  cursor.setUTCDate(cursor.getUTCDate() + 6);

  return { from, to: schoolDayFromColumn(cursor) };
}

/**
 * The days a week is drawn as: Monday to Friday, plus any weekend day that has a session.
 *
 * **Five columns is the ordinary week and the reason for the rule.** Two permanently empty
 * squares every day, to cover the Saturday a cohort meets twice a year, is a worse trade than
 * widening the row on the rare week that needs it — and dropping the weekend outright would hide
 * a morning a fellow actually attended, which the rate would then disagree with.
 *
 * `sessionDays` is every day with a session in the week, across every course, so that a fellow
 * reading three rows reads them against one set of columns. Days outside the week are ignored
 * rather than rejected: the caller has a range already and this is not the place to check it
 * twice.
 */
export function weekColumns(week: { from: SchoolDay; to: SchoolDay }, sessionDays: SchoolDay[]) {
  const columns: SchoolDay[] = [];
  const cursor = dateColumnFor(week.from);
  const weekend = new Set(sessionDays);

  for (let offset = 0; offset < 7; offset += 1) {
    const day = schoolDayFromColumn(cursor);
    // Monday is offset 0, so Saturday and Sunday are the last two.
    if (offset < 5 || weekend.has(day)) columns.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return columns;
}

/** The initial to head a week column with. "M" for a Monday. */
export function weekdayInitial(day: SchoolDay): string {
  return WEEKDAY_INITIALS[dateColumnFor(day).getUTCDay()];
}

/** The months a calendar may page between, oldest first. Empty when there is nothing to show. */
export function monthRange(days: SchoolDay[], today: SchoolDay): SchoolMonth[] {
  if (days.length === 0) return [];

  const sorted = [...days].sort();
  const first = monthOf(sorted[0]);
  // Through today even when the last session was months ago, so a cohort on a break does not
  // open on a month with nothing in it and no way forward.
  const last = [monthOf(sorted[sorted.length - 1]), monthOf(today)].sort().at(-1)!;

  const months: SchoolMonth[] = [];
  let cursor = first;
  // Bounded rather than `while (cursor <= last)`: a bad `today` would otherwise spin forever, and
  // twelve years of months is far past anything a cohort can span.
  for (let step = 0; step < 144 && cursor <= last; step += 1) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  return months;
}
