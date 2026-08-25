import {
  formatClockMinutes,
  formatWeekday,
  minutesAfterMidnight,
  SCHOOL_WEEK,
  weekdayOf,
  type SchoolDay,
} from "@/lib/school-time";

/**
 * When a fellow actually arrives, overall and by weekday.
 *
 * **What replaced the detail that taking attendance once a day gave up.** Before the program, a
 * fellow in three courses checked into three sessions and every one of them recorded a separate
 * arrival; now there is one morning, so the answer to "are they turning up on time" has to come from
 * *when* rather than from *how many*. "On average they check in at 10:20 AM, but on Mondays at
 * 10:47 AM" is a sentence an instructor can raise with somebody, where a lateness count is a number
 * they have to interpret first.
 *
 * Pure, and no `server-only`: the three screens that draw it are handed rows and this decides what
 * they mean, which is the same division `lib/attendance/summary.ts` keeps.
 *
 * Four rules are built in here rather than left to each caller, because each of them is a way to
 * print a wrong number:
 *
 * - **Only records that carry a `checkedInAt` count.** A self check-in has one by CHECK constraint,
 *   an instructor override preserves the arrival time it was correcting, and a `FINALIZED` absence
 *   has none by CHECK constraint. So the figure is "when this fellow arrives, when they arrive", and
 *   an absence neither raises it nor lowers it — which is the honest reading, because somebody who
 *   was not there did not arrive late.
 * - **The weekday comes from the session's day, never from the arrival time.** A check-in a few
 *   minutes after midnight would otherwise be filed under the previous weekday. See `weekdayOf`.
 * - **A weekday with fewer than `MIN_ARRIVALS` check-ins reports no average.** A mean over one
 *   morning is a number somebody would quote, and quoting it would be wrong.
 * - **Test students are excluded by the caller, not here.** This function is handed one fellow's
 *   records; the screens that draw a whole roster filter on `testStudentNumber` themselves, which is
 *   the rule `summarize` already states and the reason it is stated in both places.
 */

/**
 * How many arrivals a weekday needs before it has an average.
 *
 * Three, which is the smallest number where a mean says something about a habit rather than about one
 * morning. Deliberately not configurable: it is a starting point to be argued with after a term of
 * use, and a setting would freeze the first guess as though it had been reasoned.
 */
export const MIN_ARRIVALS = 3;

/** One arrival: the day it was, and the instant the fellow submitted a valid code. */
export type Arrival = {
  day: SchoolDay;
  checkedInAt: Date;
};

export type ArrivalAverage = {
  /** Minutes after midnight in the school's timezone, or null when there is not enough to divide. */
  minutes: number | null;
  /** How many arrivals this average is over, whether or not it was enough. */
  count: number;
};

export type ArrivalAverages = {
  /** Every arrival, however few. */
  overall: ArrivalAverage;
  /**
   * One entry per weekday, Monday first, and **every weekday is present** whether or not it has
   * enough arrivals to average.
   *
   * Present rather than omitted so a screen draws a stable set of rows: a table whose weekdays
   * appeared and disappeared as the term went on would move under the reader, and "no Fridays yet" is
   * itself worth seeing.
   */
  byWeekday: { weekday: number; label: string; average: ArrivalAverage }[];
};

function averageOf(minutes: number[]): ArrivalAverage {
  if (minutes.length < MIN_ARRIVALS) return { minutes: null, count: minutes.length };
  const total = minutes.reduce((sum, value) => sum + value, 0);
  return { minutes: total / minutes.length, count: minutes.length };
}

/**
 * One fellow's arrival averages.
 *
 * The caller supplies the arrivals — records with a non-null `checkedInAt`, joined to the day of the
 * session they belong to. Filtering to those is the caller's job because it is a `where` on a query
 * the caller is already making, and doing it here would mean accepting the absences only to drop
 * them.
 */
export function arrivalAverages(arrivals: readonly Arrival[]): ArrivalAverages {
  const all: number[] = [];
  const perWeekday = new Map<number, number[]>();

  for (const arrival of arrivals) {
    const minutes = minutesAfterMidnight(arrival.checkedInAt);
    all.push(minutes);

    const weekday = weekdayOf(arrival.day);
    const bucket = perWeekday.get(weekday);
    if (bucket) bucket.push(minutes);
    else perWeekday.set(weekday, [minutes]);
  }

  return {
    overall: averageOf(all),
    byWeekday: SCHOOL_WEEK.map((weekday) => ({
      weekday,
      label: formatWeekday(weekday),
      average: averageOf(perWeekday.get(weekday) ?? []),
    })),
  };
}

/**
 * The sentence a screen prints, or null when there is nothing yet to say.
 *
 * **One function so the three screens cannot word it differently**, and so the rule about which
 * weekdays are worth mentioning lives in one place. What it names is the weekday furthest from the
 * overall average — the one an instructor would want to know about — rather than every weekday,
 * because a sentence listing five of them is a table written out in prose.
 *
 * Null when the overall average is null, which is the "not enough yet" case: a screen renders nothing
 * rather than "no data", because the absence of a figure is not itself a finding.
 */
export function arrivalSentence(averages: ArrivalAverages): string | null {
  if (averages.overall.minutes === null) return null;

  const overall = formatClockMinutes(averages.overall.minutes);

  const notable = averages.byWeekday
    .filter((entry) => entry.average.minutes !== null)
    .map((entry) => ({
      ...entry,
      drift: Math.abs(entry.average.minutes! - averages.overall.minutes!),
    }))
    .sort((a, b) => b.drift - a.drift)[0];

  /*
    Five minutes, because below that the difference is rounding and reading it aloud would invent a
    pattern. A fellow whose weekdays agree gets the one clause, which is the right answer: there is
    nothing about their week to say.
  */
  if (!notable || notable.drift < 5) {
    return `On average they check in at ${overall}.`;
  }

  const onThatDay = formatClockMinutes(notable.average.minutes!);
  return `On average they check in at ${overall}, but on ${notable.label}s at ${onThatDay}.`;
}
