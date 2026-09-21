import {
  addSchoolDays,
  schoolDayFromColumn,
  weekdayOf,
  type SchoolClock,
  type SchoolDay,
} from "@/lib/school-time";

/**
 * When a program meets, and what changing that costs.
 *
 * **A program meets nearly every weekday for nine months, so the schedule is stated as a range and
 * the exceptions are removed.** Declaring 190 days one at a time is the burden this avoids;
 * declaring them as a rule and deleting the holidays is two acts a term.
 *
 * Pure, and deliberately free of `server-only` and of any clock. Every function here takes the
 * days it reasons about, so the boundary cases can be tested against fixed dates rather than
 * against whatever day the suite runs on. Turning one of these days into an instant is
 * `instantAtSchoolClock`'s job and happens in the procedures.
 *
 * **Days compare as strings.** `"2026-09-07" < "2026-09-08"` is true for every pair of school days
 * because the format is fixed-width and big-endian, which is why `SchoolDay` is a string in the
 * first place. No `Date` is constructed here except inside `nextSchoolDay` and `scheduleOf`.
 */

/**
 * The four facts, held together because they are set together.
 *
 * Nullable in the database and whole here: a `Schedule` value exists only when a program has one,
 * so no function below has to ask whether the start time is missing.
 */
export type Schedule = {
  /** The first day the program meets. Inclusive. */
  startsOn: SchoolDay;
  /** The last day the program meets. Inclusive. */
  endsOn: SchoolDay;
  /** Sunday 0 through Saturday 6, as `weekdayOf` numbers them. */
  weekdays: number[];
  /** What time class starts, in Brooklyn. What lateness is measured from. */
  startsAt: SchoolClock;
};

/**
 * How long a schedule may run, in days end to end.
 *
 * A guard rather than a policy. Two years is far beyond any program, and the number exists so that
 * a typo in a year — 2400 rather than 2026 — is refused in a sentence instead of building a list
 * of 137,000 days.
 */
export const SCHEDULE_MAX_DAYS = 800;

/** The day after this one. See `addSchoolDays` for why it is arithmetic on UTC parts. */
export function nextSchoolDay(day: SchoolDay): SchoolDay {
  return addSchoolDays(day, 1);
}

/** The four columns as Prisma returns them, which is the shape every read of a program has. */
export type ScheduleColumns = {
  attendanceStartsOn: Date | null;
  attendanceEndsOn: Date | null;
  attendanceWeekdays: number[];
  attendanceStartsAt: string | null;
};

/**
 * A program's schedule, or null if it has none.
 *
 * **Here rather than in a router**, because turning the four columns into the one value every rule
 * below reads is the same act wherever it happens, and two routers doing it separately is how they
 * would come to disagree about what a half-filled schedule means.
 *
 * The `_schedule_is_whole` CHECK is what makes one test enough: the four columns are set together,
 * so one of them being non-null settles all four. The dates arrive as `Date` at UTC midnight and
 * leave as `"YYYY-MM-DD"`, which is the conversion `lib/school-time.ts` exists to keep in one place.
 */
export function scheduleOf(program: ScheduleColumns): Schedule | null {
  if (
    program.attendanceStartsOn === null ||
    program.attendanceEndsOn === null ||
    program.attendanceStartsAt === null
  ) {
    return null;
  }

  return {
    startsOn: schoolDayFromColumn(program.attendanceStartsOn),
    endsOn: schoolDayFromColumn(program.attendanceEndsOn),
    weekdays: program.attendanceWeekdays,
    startsAt: program.attendanceStartsAt,
  };
}

/** Whether the program meets on this day. Both ends of the range are inclusive. */
export function meetsOn(schedule: Schedule, day: SchoolDay): boolean {
  if (day < schedule.startsOn || day > schedule.endsOn) return false;
  return schedule.weekdays.includes(weekdayOf(day));
}

/**
 * Every day the program meets between two bounds, in order.
 *
 * The bounds narrow the schedule and never widen it, so a caller can ask for "from today" without
 * first checking whether today is before the program began.
 */
export function meetingDaysBetween(
  schedule: Schedule,
  from: SchoolDay,
  to: SchoolDay,
): SchoolDay[] {
  const first = from > schedule.startsOn ? from : schedule.startsOn;
  const last = to < schedule.endsOn ? to : schedule.endsOn;

  const days: SchoolDay[] = [];
  let day = first;
  let steps = 0;

  while (day <= last) {
    if (steps > SCHEDULE_MAX_DAYS) {
      throw new Error(`A schedule cannot run longer than ${SCHEDULE_MAX_DAYS} days.`);
    }
    if (meetsOn(schedule, day)) days.push(day);
    day = nextSchoolDay(day);
    steps += 1;
  }

  return days;
}

/**
 * Which days a change to the schedule makes, and which it removes.
 *
 * **It takes the previous schedule as well as the new one, and that is the whole design.** Working
 * from the new schedule alone, a save would have to create every meeting day it did not find —
 * which would bring back every holiday an instructor had removed. Asking instead which days
 * *changed their meeting status* leaves a removed holiday in neither list, because it is a meeting
 * day under both schedules and the save has no opinion about it.
 *
 * **Today is made but never removed.** Today's session may already hold check-ins, and a removal
 * would destroy them; making one is harmless because a day that already has a session is skipped
 * by the caller. Removing today is a deliberate act on the day screen.
 *
 * The lists are candidates. Whether a day in `make` already has a session, and whether a day in
 * `remove` has one that anybody checked into, are questions for the database — see
 * `resolveScheduleChange` in `trpc/routers/programs.ts`.
 */
export function scheduleDiff(
  previous: Schedule | null,
  next: Schedule | null,
  today: SchoolDay,
): { make: SchoolDay[]; remove: SchoolDay[] } {
  const make = next
    ? meetingDaysBetween(next, today, next.endsOn).filter(
        (day) => previous === null || !meetsOn(previous, day),
      )
    : [];

  const remove = previous
    ? meetingDaysBetween(previous, nextSchoolDay(today), previous.endsOn).filter(
        (day) => next === null || !meetsOn(next, day),
      )
    : [];

  return { make, remove };
}
