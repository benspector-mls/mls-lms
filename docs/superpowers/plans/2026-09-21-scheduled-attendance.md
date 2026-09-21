# Attendance on a schedule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A program declares a first day, a last day, the weekdays it meets, and a start time; every meeting day from today onward is created as an attendance session carrying its own clock, so check-in opens two hours before class without anybody pressing a button.

**Architecture:** Four nullable columns on `Program` hold the schedule. A pure module turns two schedules into the days to make and the days to remove. Sessions are ordinary `AttendanceSession` rows written ahead of time with `startedAt` set from the schedule, so every existing read path works unchanged. A new `"scheduled"` session state covers the stretch before check-in opens, and the flag that decides whether a session counts toward a fellow's rate broadens from "open" to "not yet settled" so that days ahead count for nobody.

**Tech Stack:** Next.js App Router, tRPC, Prisma with Postgres, Jest for unit and integration tests, Tailwind with shadcn/ui components.

**Spec:** `docs/superpowers/specs/2026-09-21-scheduled-attendance-design.md`

## Global Constraints

- **A school day crosses the wire as a `"YYYY-MM-DD"` string, never as a `Date`.** The `Date` object exists only between Prisma and the conversions in `lib/school-time.ts`. Use `dateColumnFor` to write and `schoolDayFromColumn` to read.
- **A clock time is a `SchoolClock`, written `"09:30"` on the 24-hour clock.** Turn it into an instant with `instantAtSchoolClock(day, clock)`, never by building a `Date` from parts.
- **Weekdays are numbered Sunday 0 through Saturday 6**, matching `weekdayOf` in `lib/school-time.ts`. Do not add a second weekday helper; import that one.
- **Never select `codeSecret` into a payload.** Only `lib/attendance/code.ts` reads it, and only `checkIn`, `sessionCode`, and the new `upcoming` procedure select it.
- **Migrations are authored by hand.** Run `npm run db:diff` to see the SQL Prisma would generate, then write the migration file yourself with comments. Never run `prisma migrate dev`. Apply locally with `npm run db:deploy`.
- **Never apply a migration to the deployment database.** That is Ben's to run with `npm run db:deploy:deployment`.
- **Commit straight to main. Do not push.**
- Unit tests run with `npm test`. Integration tests run with `npm run test:integration` and need the local test database, reset with `npm run db:test:reset`.
- Lint with `npm run lint` before each commit.
- End every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

**Created:**
- `lib/attendance/schedule.ts` — pure: what a schedule is, which days it meets, and the difference between two schedules.
- `tests/lib/attendance/schedule.test.ts` — its tests.
- `prisma/migrations/20260921XXXXXX_attendance_schedule/migration.sql` — four columns and their constraints, two audit values.
- `app/present/attendance/[programId]/codes/page.tsx` — the printable sheet of coming codes.
- `components/instructor/attendance-codes-sheet.tsx` — what that page renders.
- `components/instructor/program-schedule.tsx` — the "Class meets" settings block.
- `components/instructor/attendance-upcoming.tsx` — the coming-days list and the remove-a-stretch dialog.

**Modified:**
- `prisma/schema.prisma` — the four columns, two `AuditAction` values, and the comment on `AttendanceSession.startedAt`.
- `lib/attendance/window.ts` — the `"scheduled"` state, `OPENS_BEFORE_START_MINUTES`, `opensAt`.
- `lib/attendance/summary.ts` — `SummarySession.open` becomes `unsettled`.
- `lib/attendance/cells.ts` — the `"upcoming"` cell kind.
- `lib/attendance/grid.ts` — a scheduled session reads as "not yet".
- `trpc/routers/programs.ts` — the schedule preview and save.
- `trpc/routers/attendance.ts` — prepare, start, checkIn, history, endSession, and the two new procedures.
- `components/instructor/program-settings.tsx` — mount the schedule block.
- `components/instructor/attendance-term.tsx` — mount the coming-days list.
- `components/instructor/attendance-day.tsx` — the scheduled card and the single-day make.
- `components/instructor/attendance-display.tsx` — the projector's scheduled branch.
- `components/student/attendance-calendar.tsx`, `attendance-strip.tsx` — the upcoming square.
- `FEATURES.md`, `ROADMAP.md` — the calendar is no longer absent.

---

### Task 1: The schedule module

A pure module with no database and no clock. Everything about which days a program meets is decided here, so the procedures that follow do arithmetic in one place and are testable without a schedule.

**Files:**
- Create: `lib/attendance/schedule.ts`
- Test: `tests/lib/attendance/schedule.test.ts`

**Interfaces:**
- Consumes: `weekdayOf`, `schoolDayFromColumn`, `SchoolDay`, `SchoolClock` from `lib/school-time.ts`.
- Produces: `type Schedule = { startsOn: SchoolDay; endsOn: SchoolDay; weekdays: number[]; startsAt: SchoolClock }`; `meetsOn(schedule: Schedule, day: SchoolDay): boolean`; `meetingDaysBetween(schedule: Schedule, from: SchoolDay, to: SchoolDay): SchoolDay[]`; `scheduleDiff(previous: Schedule | null, next: Schedule | null, today: SchoolDay): { make: SchoolDay[]; remove: SchoolDay[] }`; `scheduleOf(program: ScheduleColumns): Schedule | null`; `nextSchoolDay(day: SchoolDay): SchoolDay`; `SCHEDULE_MAX_DAYS: 800`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/attendance/schedule.test.ts`:

```ts
import {
  SCHEDULE_MAX_DAYS,
  meetingDaysBetween,
  meetsOn,
  nextSchoolDay,
  scheduleDiff,
  scheduleOf,
  type Schedule,
} from "@/lib/attendance/schedule";

/**
 * Which days a program meets, and what changing its mind costs.
 *
 * Pure arithmetic over `"YYYY-MM-DD"` strings. The dates below are real: 2026-09-07 is a Monday,
 * so the week that follows runs Monday 7th to Sunday 13th and every weekday number in these tests
 * can be checked against a calendar rather than taken on trust.
 */

const WEEKDAYS = [1, 2, 3, 4, 5];

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    startsOn: "2026-09-07",
    endsOn: "2026-09-18",
    weekdays: WEEKDAYS,
    startsAt: "09:30",
    ...overrides,
  };
}

describe("nextSchoolDay", () => {
  it("crosses a month boundary", () => {
    expect(nextSchoolDay("2026-09-30")).toBe("2026-10-01");
  });

  it("crosses a year boundary", () => {
    expect(nextSchoolDay("2026-12-31")).toBe("2027-01-01");
  });

  /*
    The 8th of March 2026 is when the clocks go forward in Brooklyn. A day-stepper built on local
    time would either repeat or skip a day here; this one reads UTC parts off a bare date and does
    not care.
  */
  it("is unmoved by daylight saving", () => {
    expect(nextSchoolDay("2026-03-07")).toBe("2026-03-08");
    expect(nextSchoolDay("2026-03-08")).toBe("2026-03-09");
  });
});

describe("scheduleOf", () => {
  it("reads the four columns into one value", () => {
    expect(
      scheduleOf({
        attendanceStartsOn: new Date("2026-09-07T00:00:00Z"),
        attendanceEndsOn: new Date("2026-09-18T00:00:00Z"),
        attendanceWeekdays: WEEKDAYS,
        attendanceStartsAt: "09:30",
      }),
    ).toEqual(schedule());
  });

  /*
    Prisma hands a `@db.Date` back as UTC midnight, and reading its local parts on any machine west
    of UTC gives the day before. A schedule that began on the 6th rather than the 7th would make a
    session for a Sunday the program does not meet.
  */
  it("reads the civil date rather than the local one", () => {
    const read = scheduleOf({
      attendanceStartsOn: new Date("2026-09-07T00:00:00Z"),
      attendanceEndsOn: new Date("2026-09-18T00:00:00Z"),
      attendanceWeekdays: WEEKDAYS,
      attendanceStartsAt: "09:30",
    });
    expect(read?.startsOn).toBe("2026-09-07");
  });

  it("is null when the program has no schedule", () => {
    expect(
      scheduleOf({
        attendanceStartsOn: null,
        attendanceEndsOn: null,
        attendanceWeekdays: [],
        attendanceStartsAt: null,
      }),
    ).toBeNull();
  });
});

describe("meetsOn", () => {
  it("is true on a weekday inside the range", () => {
    expect(meetsOn(schedule(), "2026-09-07")).toBe(true);
    expect(meetsOn(schedule(), "2026-09-11")).toBe(true);
  });

  it("is false at the weekend", () => {
    expect(meetsOn(schedule(), "2026-09-12")).toBe(false);
    expect(meetsOn(schedule(), "2026-09-13")).toBe(false);
  });

  // Both ends are inclusive. A program that runs "to the 18th" meets on the 18th.
  it("includes both ends of the range", () => {
    expect(meetsOn(schedule(), "2026-09-07")).toBe(true);
    expect(meetsOn(schedule(), "2026-09-18")).toBe(true);
    expect(meetsOn(schedule(), "2026-09-04")).toBe(false);
    expect(meetsOn(schedule(), "2026-09-21")).toBe(false);
  });

  it("honours a program that does not meet every weekday", () => {
    const fourDays = schedule({ weekdays: [1, 2, 3, 4] });
    expect(meetsOn(fourDays, "2026-09-10")).toBe(true);
    expect(meetsOn(fourDays, "2026-09-11")).toBe(false);
  });
});

describe("meetingDaysBetween", () => {
  it("lists the meeting days in order", () => {
    expect(meetingDaysBetween(schedule(), "2026-09-07", "2026-09-18")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
  });

  // The bounds narrow the schedule; they never widen it.
  it("is clipped by the schedule at both ends", () => {
    expect(meetingDaysBetween(schedule(), "2026-08-01", "2026-12-31")).toHaveLength(10);
    expect(meetingDaysBetween(schedule(), "2026-09-16", "2026-12-31")).toEqual([
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
  });

  it("is empty when the bounds cross", () => {
    expect(meetingDaysBetween(schedule(), "2026-09-18", "2026-09-07")).toEqual([]);
  });

  it("refuses a span longer than the cap rather than running forever", () => {
    const forever = schedule({ startsOn: "2026-01-01", endsOn: "2400-01-01" });
    expect(() => meetingDaysBetween(forever, "2026-01-01", "2400-01-01")).toThrow(
      /longer than ${SCHEDULE_MAX_DAYS} days/,
    );
  });
});

describe("scheduleDiff", () => {
  const today = "2026-09-09";

  it("makes every meeting day from today when there was no schedule", () => {
    expect(scheduleDiff(null, schedule(), today)).toEqual({
      make: [
        "2026-09-09",
        "2026-09-10",
        "2026-09-11",
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
      ],
      remove: [],
    });
  });

  // Saving the same schedule twice is the common case and must be a no-op.
  it("changes nothing when the schedule is unchanged", () => {
    expect(scheduleDiff(schedule(), schedule(), today)).toEqual({ make: [], remove: [] });
  });

  it("makes only the new stretch when the end moves out", () => {
    const longer = schedule({ endsOn: "2026-09-23" });
    expect(scheduleDiff(schedule(), longer, today)).toEqual({
      make: ["2026-09-21", "2026-09-22", "2026-09-23"],
      remove: [],
    });
  });

  it("removes only the days now outside the range when the end moves in", () => {
    const shorter = schedule({ endsOn: "2026-09-15" });
    expect(scheduleDiff(schedule(), shorter, today)).toEqual({
      make: [],
      remove: ["2026-09-16", "2026-09-17", "2026-09-18"],
    });
  });

  it("makes only the added weekday", () => {
    const withSaturday = schedule({ weekdays: [1, 2, 3, 4, 5, 6] });
    expect(scheduleDiff(schedule(), withSaturday, today)).toEqual({
      make: ["2026-09-12"],
      remove: [],
    });
  });

  it("removes only the dropped weekday", () => {
    const withoutFriday = schedule({ weekdays: [1, 2, 3, 4] });
    expect(scheduleDiff(schedule(), withoutFriday, today)).toEqual({
      make: [],
      remove: ["2026-09-11", "2026-09-18"],
    });
  });

  /*
    The whole reason the diff takes the previous schedule rather than working from the new one
    alone. A day an instructor removed as a holiday is a meeting day under both schedules, so it is
    in neither list and a later save never brings it back.
  */
  it("leaves a day that both schedules meet on alone", () => {
    const laterStart = schedule({ startsAt: "10:00" });
    expect(scheduleDiff(schedule(), laterStart, today)).toEqual({ make: [], remove: [] });
  });

  // Today is made but never removed: today's session may already hold check-ins.
  it("never removes today", () => {
    const withoutWednesday = schedule({ weekdays: [1, 2, 4, 5] });
    const diff = scheduleDiff(schedule(), withoutWednesday, today);
    expect(diff.remove).not.toContain(today);
    expect(diff.remove).toEqual(["2026-09-16"]);
  });

  it("removes everything ahead when the schedule is cleared", () => {
    expect(scheduleDiff(schedule(), null, today)).toEqual({
      make: [],
      remove: [
        "2026-09-10",
        "2026-09-11",
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
      ],
    });
  });

  it("does nothing at all when there is no schedule either side", () => {
    expect(scheduleDiff(null, null, today)).toEqual({ make: [], remove: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/lib/attendance/schedule.test.ts`
Expected: FAIL, "Cannot find module '@/lib/attendance/schedule'".

- [ ] **Step 3: Write the module**

Create `lib/attendance/schedule.ts`:

```ts
import { schoolDayFromColumn, weekdayOf, type SchoolClock, type SchoolDay } from "@/lib/school-time";

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
 * first place. No `Date` is constructed here except inside `nextSchoolDay`.
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

/**
 * The day after this one.
 *
 * Built on UTC parts of a bare date, for the reason `schoolDayFromColumn` reads UTC parts: this is
 * a civil date with no zone, and stepping it through local time would repeat or skip a day at
 * each daylight-saving change.
 */
export function nextSchoolDay(day: SchoolDay): SchoolDay {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/lib/attendance/schedule.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add lib/attendance/schedule.ts tests/lib/attendance/schedule.test.ts
git commit -m "$(cat <<'EOF'
Which days a program meets, and what changing its mind costs

A pure module over "YYYY-MM-DD" strings: the range, the weekdays, and the
difference between two schedules. The diff takes the previous schedule so
that a holiday somebody removed is in neither list and a later save never
brings it back.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The scheduled state and the two-hour window

A session made ahead has a start in the future. It is not open, it is not pending, and it needs a name so that every screen can word it.

**Files:**
- Modify: `lib/attendance/window.ts`
- Modify: `lib/attendance/grid.ts:74-80`
- Test: `tests/lib/attendance/window.test.ts`

**Interfaces:**
- Produces: `OPENS_BEFORE_START_MINUTES: 120`; `opensAt(session: StartedSession): Date`; `SessionState` gains `"scheduled"`.

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/attendance/window.test.ts`:

```ts
describe("a session whose start is still ahead", () => {
  /*
    A session made from a schedule carries a start in the future, so `now` here runs *before* the
    fixture's `STARTED` rather than after it. `at()` takes negatives for exactly this.
  */
  it("is scheduled until two hours before the start", () => {
    expect(sessionStateOf(session(), at(-OPENS_BEFORE_START_MINUTES - 1))).toBe("scheduled");
    expect(sessionStateOf(session(), at(-121))).toBe("scheduled");
  });

  // On the boundary the window is open, matching `statusForCheckIn`, which decides the other
  // boundary in the fellow's favour.
  it("is open exactly at the two-hour mark", () => {
    expect(sessionStateOf(session(), at(-OPENS_BEFORE_START_MINUTES))).toBe("open");
    expect(sessionStateOf(session(), at(-119))).toBe("open");
  });

  it("accepts no check-in before the window opens", () => {
    expect(isAcceptingCheckIns(session(), at(-121))).toBe(false);
    expect(isAcceptingCheckIns(session(), at(-120))).toBe(true);
  });

  /*
    An instructor pressing Start makes a session whose start is this moment, so the window opened
    two hours ago and the press is never refused by its own rule.
  */
  it("is open at once when a person started it", () => {
    expect(sessionStateOf(session(), STARTED)).toBe("open");
  });

  // Somebody arriving during the window, before class, is on time. That is the feature.
  it("counts an arrival before the start as present", () => {
    expect(statusForCheckIn(session(), at(-90))).toBe("PRESENT");
  });

  // A person's decision and the backstop both outrank the window, or a removed day could be
  // reopened into a state that accepts nobody.
  it("reports ended rather than scheduled once somebody ended it", () => {
    expect(sessionStateOf(session({ endedAt: at(-150) }), at(-160))).toBe("ended");
  });

  it("says when the window opens", () => {
    expect(opensAt(session()).toISOString()).toBe(at(-120).toISOString());
  });
});
```

Add `OPENS_BEFORE_START_MINUTES` and `opensAt` to the import block at the top of that file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/lib/attendance/window.test.ts`
Expected: FAIL, "opensAt is not a function" and the scheduled assertions returning "open".

- [ ] **Step 3: Add the state and the window**

In `lib/attendance/window.ts`, after `DEFAULT_LATE_AFTER_MINUTES`, add:

```ts
/**
 * How long before class a session starts accepting check-ins.
 *
 * **Two hours, because the alternative to a bound is no bound at all.** A session made a fortnight
 * ahead holds a working code from the moment it is made, and without this a photographed sheet of
 * the term's codes would let somebody mark themselves present at three in the morning for a day
 * they then slept through. Two hours is longer than anybody arrives before class and short enough
 * that a code is worth one early check-in on one day rather than a term of them.
 *
 * It costs nothing for a session an instructor started by hand: its start is the moment of the
 * press, so the window opened two hours before that and the rule is never the thing that refuses.
 */
export const OPENS_BEFORE_START_MINUTES = 120;
```

Extend the `SessionState` union, placing the new member after `"pending"`:

```ts
export type SessionState =
  /**
   * Made, but check-in has not opened.
   *
   * The phase that exists so a code can go on a whiteboard before class. The session holds a
   * secret and therefore a code; it accepts nothing, measures no lateness, and has no closing time
   * to print, because none of those begin until somebody presses start.
   *
   * A program with a schedule never produces one: every day it makes has a clock.
   */
  | "pending"
  /**
   * Made from the schedule, with a start still more than two hours away.
   *
   * Unlike `pending` it has all three times to print — when check-in opens, when class starts,
   * when the code dies — which is why it is a state of its own rather than a reuse. A screen
   * drawing one can tell a room exactly when the code will begin to work.
   */
  | "scheduled"
  /** A person pressed end. */
  | "ended"
  /** Nobody pressed end and the backstop passed. Behaves as closed; says something different. */
  | "lapsed"
  | "open";
```

Add `opensAt` beside `lateFrom`:

```ts
/** The moment this session begins accepting check-ins. */
export function opensAt(session: StartedSession): Date {
  return new Date(session.startedAt.getTime() - OPENS_BEFORE_START_MINUTES * 60 * 1000);
}
```

Replace the body of `sessionStateOf`:

```ts
export function sessionStateOf(session: WindowSession, now: Date): SessionState {
  // First, because a session that never started cannot have ended, lapsed, or been scheduled —
  // there is no instant for any of them to be measured against.
  if (session.startedAt === null || session.endsAt === null) return "pending";
  if (session.endedAt !== null) return "ended";
  if (now.getTime() >= session.endsAt.getTime()) return "lapsed";

  /*
    Last of the three closed answers, and deliberately after the other two. A day removed from the
    schedule and then reopened, or one whose backstop somebody dragged backwards, must read as
    closed rather than as "not yet" — a screen saying check-in opens at 7:30 about a morning that
    already finished is worse than one saying it is closed.
  */
  if (now.getTime() < opensAt(session as StartedSession).getTime()) return "scheduled";

  return "open";
}
```

- [ ] **Step 4: Teach the grid that a scheduled day is "not yet"**

In `lib/attendance/grid.ts`, replace the `pending` derivation at lines 74-80:

```ts
  const state: SessionState | null = session ? sessionStateOf(session, now) : null;
  /*
    A prepared or scheduled session reads as "not yet" for the same reason an open one does: nobody
    has missed anything. Both are the stronger case, in fact — no fellow could have checked in even
    if they tried, because the session is not accepting codes yet.
  */
  const pending: PendingReason =
    state === "open" || state === "pending" || state === "scheduled" ? "not-yet" : "no-check-in";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/lib/attendance`
Expected: PASS. The existing window, grid, and cells tests must still be green.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add lib/attendance/window.ts lib/attendance/grid.ts tests/lib/attendance/window.test.ts
git commit -m "$(cat <<'EOF'
A session made ahead of class says when its code starts working

Check-in opens two hours before the start, which bounds what a printed
sheet of codes is worth. The stretch before that is a state of its own,
because unlike a prepared session it has all three times to print.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The schema and the migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260921XXXXXX_attendance_schedule/migration.sql`

**Interfaces:**
- Produces: `Program.attendanceStartsOn`, `attendanceEndsOn`, `attendanceWeekdays`, `attendanceStartsAt`; `AuditAction.PROGRAM_ATTENDANCE_SCHEDULE_SET`, `AuditAction.ATTENDANCE_SESSIONS_REMOVED`.

- [ ] **Step 1: Add the columns to the schema**

In `prisma/schema.prisma`, immediately after `attendanceLateAfterMinutes` on `Program`:

```prisma
  /// When this program meets: the first day, the last day, and which weekdays in between.
  ///
  /// **A range with exceptions removed, rather than a list of days.** A program meets nearly every
  /// weekday for nine months, so declaring the 190 days would be the burden this replaces. Saving
  /// these makes one `AttendanceSession` per meeting day from today onward, each carrying its own
  /// clock, and an instructor deletes the holidays.
  ///
  /// **All four are set together or none of them is**, which `_schedule_is_whole` asserts. Null
  /// throughout means the program has no schedule and attendance behaves as it did before: an
  /// instructor presses Start and the session measures from the press.
  ///
  /// Never send these to a browser as a `Date` — see `lib/school-time.ts`. The `Date` objects
  /// Prisma returns here are UTC midnight of a bare date.
  attendanceStartsOn DateTime? @map("attendance_starts_on") @db.Date
  attendanceEndsOn   DateTime? @map("attendance_ends_on") @db.Date

  /// Which weekdays it meets, Sunday 0 through Saturday 6, as `weekdayOf` numbers them.
  ///
  /// An array rather than seven booleans or a bitmask, because it is read into
  /// `Schedule.weekdays` and compared with `includes`. Empty exactly while the other three are
  /// null, which is how the CHECK expresses "no schedule" for a column that cannot be null.
  attendanceWeekdays Int[] @map("attendance_weekdays")

  /// What time class starts, in Brooklyn, written "09:30" on the 24-hour clock.
  ///
  /// **A `SchoolClock` string rather than minutes or a time column**, matching how a due date's
  /// time is held: it is what an `<input type="time">` reads and writes, and
  /// `instantAtSchoolClock` turns it into the instant a session's `startedAt` is set to.
  ///
  /// This is what lateness is measured from on every day the schedule makes. Changing it rewrites
  /// the clock of every session dated after today and leaves every earlier one alone, for the
  /// reason `AttendanceSession.lateAfterMinutes` gives.
  attendanceStartsAt String? @map("attendance_starts_at")
```

Add the two audit values to the `AuditAction` enum, after `ATTENDANCE_CHECK_IN_FAILED`:

```prisma
  /// A program declared when it meets. One event for the whole save, with the days made and
  /// removed in its detail, rather than one per session: a first save touches nearly two hundred
  /// days and two hundred rows would bury every other event of that afternoon.
  PROGRAM_ATTENDANCE_SCHEDULE_SET
  /// A stretch of days removed at once. `ATTENDANCE_SESSION_DELETED` stays the value for removing
  /// one day by hand, where the session id is the subject and worth having.
  ATTENDANCE_SESSIONS_REMOVED
```

Update the doc comment on `AttendanceSession.startedAt`. Replace its first two paragraphs with:

```prisma
  /// When the day starts. Also what lateness is measured from, which is why editing it after the
  /// fact recomputes every self check-in's status.
  ///
  /// **Written two ways.** An instructor pressing Start writes this moment. A program with a
  /// schedule writes it in advance, as that day at the program's start time — which is what lets a
  /// morning open itself, and what makes an arrival before it count as on time rather than early.
  /// `startedById` is null in the second case, because no person opened it.
  ///
  /// **Null means the session is prepared but not started**, which is the phase that exists so an
  /// instructor can write the code on a whiteboard before class. A program with a schedule never
  /// produces one. The row already holds a secret and therefore a code, but no fellow can check in
  /// against it: every rule that admits one reads this column, and a null start is not an open
  /// session. Both window columns are null together — see the `_pending_is_paired` constraint.
```

- [ ] **Step 2: Check the SQL Prisma would generate**

Run: `npm run db:diff`
Expected: four `ADD COLUMN` statements on `programs` and two `ALTER TYPE` statements. Read them; the hand-written migration below must match their column types.

- [ ] **Step 3: Write the migration**

Create `prisma/migrations/20260921XXXXXX_attendance_schedule/migration.sql`, replacing `XXXXXX` with the current time as `HHMMSS`:

```sql
-- A program can declare when it meets: a first day, a last day, the weekdays in between, and what
-- time class starts. Saving that makes one attendance session per meeting day from today onward,
-- each carrying its own clock, so a morning opens itself and a fellow who arrives early is on
-- time. Instructors remove the days the program will not meet.
--
-- Every column is nullable or defaulted, and no existing row changes. A program without a schedule
-- behaves exactly as it did.

-- ---------------------------------------------------------------------------
-- The audit values
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROGRAM_ATTENDANCE_SCHEDULE_SET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_SESSIONS_REMOVED';

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------

ALTER TABLE public."programs"
  ADD COLUMN "attendance_starts_on" date,
  ADD COLUMN "attendance_ends_on" date,
  ADD COLUMN "attendance_weekdays" integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  ADD COLUMN "attendance_starts_at" text;

-- ---------------------------------------------------------------------------
-- The invariants that keep a schedule one fact rather than four
-- ---------------------------------------------------------------------------

-- All four together or none of them. A program holding a start date and no start time is not a
-- state this design has a name for: there would be days to make and no clock to give them.
--
-- The weekday array carries the same fact through its length, because an array column cannot be
-- null here without making every read ask two questions instead of one.
ALTER TABLE public."programs"
  ADD CONSTRAINT "programs_schedule_is_whole" CHECK (
    ("attendance_starts_on" IS NULL) = ("attendance_ends_on" IS NULL)
    AND ("attendance_starts_on" IS NULL) = ("attendance_starts_at" IS NULL)
    AND ("attendance_starts_on" IS NULL) = (cardinality("attendance_weekdays") = 0)
  );

-- A program cannot finish before it begins. Equal is allowed: a one-day program is a real thing.
ALTER TABLE public."programs"
  ADD CONSTRAINT "programs_schedule_is_forward" CHECK (
    "attendance_ends_on" IS NULL OR "attendance_ends_on" >= "attendance_starts_on"
  );

-- "09:30" and nothing else, matching `SchoolClock` in lib/school-time.ts. Asserted here as well as
-- in the procedure's schema because `instantAtSchoolClock` parses this string directly: a value
-- this column accepted but that parser did not would produce an Invalid Date as a session's start,
-- and a session with an unreadable clock is one nobody can check into or correct.
ALTER TABLE public."programs"
  ADD CONSTRAINT "programs_schedule_clock" CHECK (
    "attendance_starts_at" IS NULL
    OR "attendance_starts_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  );

-- Sunday 0 through Saturday 6. A 7 in this array would be a weekday no day ever falls on, so the
-- program would quietly meet less often than its settings screen claims.
ALTER TABLE public."programs"
  ADD CONSTRAINT "programs_schedule_weekdays" CHECK (
    "attendance_weekdays" <@ ARRAY[0,1,2,3,4,5,6]
  );
```

- [ ] **Step 4: Apply it locally and regenerate the client**

```bash
npm run db:deploy
npm run db:generate
```
Expected: the migration applies cleanly and `Program` gains the four fields in the generated types.

- [ ] **Step 5: Verify the constraints refuse a half-schedule**

Run:

```bash
npx tsx -e "
import { PrismaClient } from './lib/generated/prisma/client';
const db = new PrismaClient();
const p = await db.program.findFirst({ select: { id: true } });
if (!p) { console.log('no program seeded — run npm run db:seed'); process.exit(1); }
try {
  await db.\$executeRawUnsafe(
    \`UPDATE programs SET attendance_starts_on = '2026-09-07' WHERE id = '\${p.id}'\`,
  );
  console.log('WRONG: a half-schedule was accepted');
} catch (err) { console.log('refused as expected:', (err as Error).message.slice(0, 90)); }
await db.\$disconnect();
"
```
Expected: "refused as expected", naming `programs_schedule_is_whole`.

- [ ] **Step 6: Commit**

```bash
npm run lint
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
A program can say when it meets

Four columns set together or not at all: the first day, the last day, the
weekdays, and what time class starts. Constraints keep a schedule one fact
rather than four, and the clock format is asserted here because
instantAtSchoolClock parses the string directly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Days not yet come count for nobody

The flag `summarize` reads to decide whether a session counts is called `open`, and means "check-in is live". Under a schedule a session exists for every day to June, and every one of them would read as a day the whole roster missed. The flag has to mean "not yet settled" and say so.

**Files:**
- Modify: `lib/attendance/summary.ts`
- Modify: `lib/attendance/cells.ts`
- Test: `tests/lib/attendance/summary.test.ts`, `tests/lib/attendance/cells.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SummarySession.unsettled` replaces `SummarySession.open`; `CellKind` gains `"upcoming"`; `kindOf` takes `{ status, open, upcoming }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/attendance/summary.test.ts`:

```ts
describe("a day that has not happened yet", () => {
  /*
    The failure this guards against is the one the date-range schedule introduced: a program that
    declares nine months of meeting days has a session row for every one of them from the day the
    schedule is saved. Counting an unsettled session as missed would drop every fellow's rate to
    a few percent the moment their instructor filled in the settings screen.
  */
  const fellows = [
    {
      enrollmentId: "e1",
      studentId: "s1",
      displayName: "Amina",
      email: null,
      githubUsername: null,
      testStudentNumber: null,
      enrolledFrom: "2026-09-01",
    },
  ];

  it("counts for nobody who has no record in it", () => {
    const [summary] = summarize(
      [
        { id: "past", day: "2026-09-07", unsettled: false },
        { id: "ahead", day: "2026-12-07", unsettled: true },
      ],
      fellows,
      [{ enrollmentId: "e1", sessionId: "past", status: "PRESENT" }],
    );

    expect(summary.eligible).toBe(1);
    expect(summary.rate).toBe(1);
    expect(summary.unrecorded).toBe(0);
  });

  // An instructor can excuse somebody ahead of time, and the moment they do the day is settled
  // for that fellow — the same rule an open session already follows.
  it("counts once a record exists", () => {
    const [summary] = summarize(
      [{ id: "ahead", day: "2026-12-07", unsettled: true }],
      fellows,
      [{ enrollmentId: "e1", sessionId: "ahead", status: "EXCUSED" }],
    );

    expect(summary.eligible).toBe(1);
    expect(summary.excused).toBe(1);
    expect(summary.rate).toBe(0);
  });

  // The drift list reads the last few settled days. A term of days ahead must not push every real
  // morning out of that window.
  it("is outside the drift window", () => {
    const sessions = [
      { id: "d1", day: "2026-09-07", unsettled: false },
      { id: "d2", day: "2026-09-08", unsettled: false },
      { id: "d3", day: "2026-09-09", unsettled: false },
      { id: "d4", day: "2026-09-10", unsettled: false },
      { id: "d5", day: "2026-09-11", unsettled: false },
      { id: "ahead1", day: "2026-12-07", unsettled: true },
      { id: "ahead2", day: "2026-12-08", unsettled: true },
      { id: "ahead3", day: "2026-12-09", unsettled: true },
      { id: "ahead4", day: "2026-12-10", unsettled: true },
      { id: "ahead5", day: "2026-12-11", unsettled: true },
    ];

    const summaries = summarize(sessions, fellows, [
      { enrollmentId: "e1", sessionId: "d1", status: "ABSENT" },
      { enrollmentId: "e1", sessionId: "d2", status: "ABSENT" },
      { enrollmentId: "e1", sessionId: "d3", status: "PRESENT" },
      { enrollmentId: "e1", sessionId: "d4", status: "PRESENT" },
      { enrollmentId: "e1", sessionId: "d5", status: "PRESENT" },
    ]);

    expect(driftList(summaries, sessions)).toHaveLength(1);
  });
});
```

Append to `tests/lib/attendance/cells.test.ts`:

```ts
describe("a day the program will meet", () => {
  it("is its own square, not an absence and not an open check-in", () => {
    expect(kindOf({ status: null, open: false, upcoming: true }, "2026-12-07", "2026-09-01")).toBe(
      "upcoming",
    );
  });

  // A status decided ahead of time outranks it: a fellow excused for a day in December should see
  // the excusal, not a blank square telling them nothing has happened.
  it("yields to a status already recorded", () => {
    expect(
      kindOf({ status: "EXCUSED", open: false, upcoming: true }, "2026-12-07", "2026-09-01"),
    ).toBe("EXCUSED");
  });

  // Before they joined outranks everything about the day, as it already does.
  it("yields to not being enrolled yet", () => {
    expect(kindOf({ status: null, open: false, upcoming: true }, "2026-12-07", "2027-01-01")).toBe(
      "not-enrolled",
    );
  });

  it("is still a square that stands for something", () => {
    expect(isMarked("upcoming")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/lib/attendance/summary.test.ts tests/lib/attendance/cells.test.ts`
Expected: FAIL, TypeScript rejecting `unsettled` and `upcoming` as unknown properties.

- [ ] **Step 3: Rename the flag in the summary module**

In `lib/attendance/summary.ts`, replace the `SummarySession` type:

```ts
/** A session, as the term view holds it. */
export type SummarySession = {
  id: string;
  day: SchoolDay;
  /**
   * Nothing about this session is settled yet.
   *
   * True while check-in is open, while a code is prepared and not yet opened, and for every day
   * the schedule has made that has not come. An unsettled session counts for a fellow who already
   * has a record in it and for nobody else — see `summarize`.
   *
   * **The name is the guard.** It was `open` while a session existed only because somebody pressed
   * a button, and the two meant the same thing. A program that declares nine months of meeting
   * days has a row for every one of them from the day its schedule is saved, and a flag that asked
   * "is check-in live" would have reported the whole roster absent until June.
   */
  unsettled: boolean;
};
```

In `summarize`, replace the skip:

```ts
      if (session.unsettled && !record) continue;
```

Update the comment above it, replacing its first sentence:

```ts
      /*
        **An unsettled session counts once there is a record, and not before.** A fellow who
        checked in this morning should watch the figure move rather than wait until the evening for
        a day they have already finished with — that is the whole reason this is not simply
        `session.unsettled`. A fellow who has not checked in is skipped, because the day is still
        running, or has not begun, and counting them would be reporting an absence that has not
        happened yet.
```

In `recentMisses` and `recentLates`, replace the filter in both:

```ts
    .filter(({ session }) => !session.unsettled)
```

Rename the local `closedIndexes` to `settledIndexes` in both functions, and update the two doc comments to read "How many of the last `window` settled sessions this fellow missed." and "...arrived late to."

In `DRIFT_RULE`, update the comment on `needsAtLeast` to read "Below this many settled sessions, a fellow is too new to be judged by either clause."

- [ ] **Step 4: Add the upcoming cell**

In `lib/attendance/cells.ts`, extend the union and the map:

```ts
export type CellKind =
  | AttendanceStatus
  | "unrecorded"
  | "open"
  | "upcoming"
  | "no-session"
  | "not-enrolled";
```

Add to `CELL`, after `open`:

```ts
  /*
    A day the program will meet, drawn hollow. It has to be visible — the point of a schedule is
    that a fellow can see next Tuesday is a class day — and it must not read as anything having
    happened, so it is an outline where every settled square is filled.
  */
  upcoming: {
    className: "border border-dashed border-muted-foreground/40 text-muted-foreground",
    label: "Class meets this day",
  },
```

Replace `kindOf`:

```ts
export function kindOf(
  entry: { status: AttendanceStatus | null; open: boolean; upcoming: boolean } | undefined,
  day: SchoolDay,
  enrolledFrom: SchoolDay,
): CellKind {
  if (!entry) return "no-session";
  if (day < enrolledFrom) return "not-enrolled";
  if (entry.status) return entry.status;
  // Ahead of `open`, because the two are never both true and a day that has not come is the more
  // specific thing to say. Behind `status`, because a fellow excused for a day in December has
  // been told a fact about themselves that outranks the calendar.
  if (entry.upcoming) return "upcoming";
  if (entry.open) return "open";
  return "unrecorded";
}
```

Extend the doc comment above `kindOf` by adding a paragraph before its last:

```
 * **`upcoming` is a day the schedule has made that has not come.** It sits between a status and
 * `open` because it is a fact about the calendar rather than about the fellow: there is nothing to
 * record yet and nothing missing.
```

- [ ] **Step 5: Fix the three callers so the project compiles**

The renames break `trpc/routers/attendance.ts` in three places and the two student components. Make the minimal change that compiles; Task 8 revisits the router properly.

In `history`, rename the field and add the third state:

```ts
    const summarySessions = sessions.map((session) => {
      const state = sessionStateOf(session, now);
      return {
        id: session.id,
        day: schoolDayFromColumn(session.date),
        unsettled: state === "open" || state === "pending" || state === "scheduled",
        /** Strictly open. The list of days an instructor can still be told to close. */
        live: state === "open",
      };
    });
```

Replace the comment above it:

```ts
    /*
      A prepared or scheduled session counts as unsettled here, and the reason is arithmetic rather
      than tidiness. `summarize` skips an unsettled session for anybody with no record in it, which
      is what stops a morning still in progress from reading as a morning everybody missed. Both
      are that case in its strongest form — nobody could have checked in at all — so preparing a
      code at 8:30, or declaring that the program meets every Tuesday until June, would otherwise
      drop every fellow's rate the moment it happened.
    */
```

In `myWeek` at the `summarize` input and in `myHistory`, replace `open: sessionStateOf(session, now) === "open"` with:

```ts
        unsettled: sessionStateOf(session, now) !== "ended" && sessionStateOf(session, now) !== "lapsed",
```

In both student components, add `upcoming: false` to the object literals passed to `kindOf`. Task 14 gives them the real value.

- [ ] **Step 6: Run the tests and the typecheck**

```bash
npm test -- tests/lib/attendance
npx tsc --noEmit
```
Expected: PASS, and no type errors.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add lib/attendance/summary.ts lib/attendance/cells.ts trpc/routers/attendance.ts components/student tests/lib/attendance
git commit -m "$(cat <<'EOF'
A session counts once it is settled, which is not the same as closed

The flag summarize reads meant "check-in is live" while a session existed
only because somebody pressed a button. A program that declares nine months
of meeting days has a row for each from the day it is saved, so the flag
becomes "not yet settled" and a day still to come gets a square of its own.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Saving a schedule makes and removes days

**Files:**
- Modify: `trpc/routers/programs.ts`
- Test: `tests/integration/attendance.test.ts`

**Interfaces:**
- Consumes: `scheduleDiff`, `scheduleOf`, `SCHEDULE_MAX_DAYS`, `Schedule` from `lib/attendance/schedule.ts`; `newSessionSecret` from `lib/attendance/code.ts`; `instantAtSchoolClock`, `dateColumnFor`, `schoolDayFromColumn`, `schoolDayOf`, `schoolDaySchema` from `lib/school-time.ts`; `defaultEndsAt` from `lib/attendance/window.ts`.
- Produces: `programs.attendanceSchedulePreview` query and `programs.setAttendanceSchedule` mutation, both returning `{ make: SchoolDay[]; remove: SchoolDay[]; blocked: SchoolDay[] }`; the module-local `resolveScheduleChange(db, programId, previous, next, today)`.

- [ ] **Step 1: Write the failing integration tests**

Append to `tests/integration/attendance.test.ts`:

```ts
describe("a program that declares when it meets", () => {
  /*
    These run against whatever today is, because the procedures take no clock and the whole point
    of the design is that a schedule is read against the real day. The dates are therefore derived
    from today rather than written down: a fixed September would pass in September and start
    creating nothing the following January.
  */
  const today = () => schoolDayOf(new Date());

  function daysFromToday(count: number): string {
    const at = new Date(`${today()}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + count);
    return at.toISOString().slice(0, 10);
  }

  /** Every weekday. The tests below care about counts, not about which days fall where. */
  const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

  it("makes one session per meeting day, each with the scheduled clock", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);

      const saved = await caller.programs.setAttendanceSchedule({
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(6),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      });

      expect(saved.make).toHaveLength(7);
      expect(saved.remove).toEqual([]);

      const sessions = await tx.attendanceSession.findMany({
        where: { programId: world.program.id },
        orderBy: { date: "asc" },
      });

      expect(sessions).toHaveLength(7);

      // Each carries its own day's 9:30, not one instant repeated, and its backstop eight hours on.
      for (const session of sessions) {
        const day = schoolDayFromColumn(session.date);
        expect(session.startedAt?.toISOString()).toBe(
          instantAtSchoolClock(day, "09:30").toISOString(),
        );
        expect(session.endsAt?.toISOString()).toBe(
          defaultEndsAt(instantAtSchoolClock(day, "09:30")).toISOString(),
        );
        // Nobody opened it, and the column means who did.
        expect(session.startedById).toBeNull();
        expect(session.endedAt).toBeNull();
      }
    });
  });

  it("makes nothing the second time it is saved", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);
      const input = {
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(6),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      };

      await caller.programs.setAttendanceSchedule(input);
      const again = await caller.programs.setAttendanceSchedule(input);

      expect(again.make).toEqual([]);
      expect(again.remove).toEqual([]);
      expect(
        await tx.attendanceSession.count({ where: { programId: world.program.id } }),
      ).toBe(7);
    });
  });

  it("makes only the new stretch when the end moves out", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);

      await caller.programs.setAttendanceSchedule({
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(3),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      });

      const longer = await caller.programs.setAttendanceSchedule({
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(6),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      });

      expect(longer.make).toEqual([
        daysFromToday(4),
        daysFromToday(5),
        daysFromToday(6),
      ]);
      expect(longer.remove).toEqual([]);
    });
  });

  it("removes the days now outside the range, and never today", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);

      await caller.programs.setAttendanceSchedule({
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(6),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      });

      const shorter = await caller.programs.setAttendanceSchedule({
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(2),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      });

      expect(shorter.remove).toEqual([
        daysFromToday(3),
        daysFromToday(4),
        daysFromToday(5),
        daysFromToday(6),
      ]);
      expect(
        await tx.attendanceSession.count({ where: { programId: world.program.id } }),
      ).toBe(3);
    });
  });

  /*
    The claim the whole diff exists to make good: a holiday an instructor deleted is a meeting day
    under both the old schedule and the new, so a later save has no opinion about it and it stays
    deleted.
  */
  it("does not bring back a day an instructor removed", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);
      const base = {
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(6),
        weekdays: EVERY_DAY,
      };

      await caller.programs.setAttendanceSchedule({ ...base, startsAt: "09:30" });

      const holiday = await tx.attendanceSession.findFirstOrThrow({
        where: { programId: world.program.id, date: dateColumnFor(daysFromToday(3)) },
      });
      await caller.attendance.deleteSession({ sessionId: holiday.id });

      const again = await caller.programs.setAttendanceSchedule({ ...base, startsAt: "10:00" });

      expect(again.make).toEqual([]);
      expect(
        await tx.attendanceSession.count({
          where: { programId: world.program.id, date: dateColumnFor(daysFromToday(3)) },
        }),
      ).toBe(0);
    });
  });

  it("moves the clock of every day ahead and leaves today alone", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);
      const base = {
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(3),
        weekdays: EVERY_DAY,
      };

      await caller.programs.setAttendanceSchedule({ ...base, startsAt: "09:30" });
      await caller.programs.setAttendanceSchedule({ ...base, startsAt: "10:00" });

      const sessions = await tx.attendanceSession.findMany({
        where: { programId: world.program.id },
        orderBy: { date: "asc" },
      });

      // Today keeps the clock it ran under, because it may already hold check-ins measured
      // against it. Every later day moves.
      expect(sessions[0].startedAt?.toISOString()).toBe(
        instantAtSchoolClock(today(), "09:30").toISOString(),
      );
      for (const session of sessions.slice(1)) {
        const day = schoolDayFromColumn(session.date);
        expect(session.startedAt?.toISOString()).toBe(
          instantAtSchoolClock(day, "10:00").toISOString(),
        );
      }
    });
  });

  it("keeps a day somebody checked into, and says which", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);

      await caller.programs.setAttendanceSchedule({
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(3),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      });

      // An instructor excuses somebody for a day that has not come, then drops that weekday.
      const ahead = await tx.attendanceSession.findFirstOrThrow({
        where: { programId: world.program.id, date: dateColumnFor(daysFromToday(2)) },
      });
      await caller.attendance.setStatus({
        sessionId: ahead.id,
        enrollmentId: world.enrollments[0].id,
        status: "EXCUSED",
      });
      await tx.attendanceRecord.updateMany({
        where: { sessionId: ahead.id },
        data: { source: "SELF_CHECK_IN" },
      });

      const shorter = await caller.programs.setAttendanceSchedule({
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(1),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      });

      expect(shorter.blocked).toEqual([daysFromToday(2)]);
      expect(shorter.remove).toEqual([daysFromToday(3)]);
    });
  });

  it("previews without writing anything", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);

      const preview = await caller.programs.attendanceSchedulePreview({
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(6),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      });

      expect(preview.make).toHaveLength(7);
      expect(
        await tx.attendanceSession.count({ where: { programId: world.program.id } }),
      ).toBe(0);
    });
  });

  it("refuses an instructor of another program", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.outsider.id);

      expect(
        await refusal(() =>
          caller.programs.setAttendanceSchedule({
            programId: world.program.id,
            startsOn: today(),
            endsOn: daysFromToday(6),
            weekdays: EVERY_DAY,
            startsAt: "09:30",
          }),
        ),
      ).not.toBe("accepted");
    });
  });

  it("refuses a range longer than two years", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);

      expect(
        await refusal(() =>
          caller.programs.setAttendanceSchedule({
            programId: world.program.id,
            startsOn: today(),
            endsOn: daysFromToday(900),
            weekdays: EVERY_DAY,
            startsAt: "09:30",
          }),
        ),
      ).not.toBe("accepted");
    });
  });

  it("clears the schedule and removes every day ahead", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);

      await caller.programs.setAttendanceSchedule({
        programId: world.program.id,
        startsOn: today(),
        endsOn: daysFromToday(6),
        weekdays: EVERY_DAY,
        startsAt: "09:30",
      });

      const cleared = await caller.programs.setAttendanceSchedule({
        programId: world.program.id,
        startsOn: null,
        endsOn: null,
        weekdays: [],
        startsAt: null,
      });

      expect(cleared.remove).toHaveLength(6);
      const program = await tx.program.findUniqueOrThrow({ where: { id: world.program.id } });
      expect(program.attendanceStartsOn).toBeNull();
      expect(program.attendanceWeekdays).toEqual([]);
    });
  });
});
```

Add `defaultEndsAt` and `instantAtSchoolClock` to that file's imports.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run db:test:reset
npm run test:integration -- -t "declares when it meets"
```
Expected: FAIL, `caller.programs.setAttendanceSchedule is not a function`.

- [ ] **Step 3: Add the helpers to the programs router**

In `trpc/routers/programs.ts`, add to the imports:

```ts
import { newSessionSecret } from "@/lib/attendance/code";
import {
  SCHEDULE_MAX_DAYS,
  scheduleDiff,
  scheduleOf,
  type Schedule,
} from "@/lib/attendance/schedule";
import { defaultEndsAt } from "@/lib/attendance/window";
import { dateColumnFor, instantAtSchoolClock, schoolDaySchema } from "@/lib/school-time";
import type { Tx } from "@/lib/prisma";
```

Add `schoolDayFromColumn` to the existing `@/lib/school-time` import if it is not already there.

After the `attendanceSessionSelect` constant, add:

```ts
/** The four columns a schedule lives in, as every read of one selects them. */
const scheduleSelect = {
  attendanceStartsOn: true,
  attendanceEndsOn: true,
  attendanceWeekdays: true,
  attendanceStartsAt: true,
} as const;

/**
 * What saving a schedule would do, resolved against the sessions that exist.
 *
 * `scheduleDiff` answers which days *changed their meeting status*; this answers which of those
 * days there is actually work to do about. Three lists come out, and the third is the one worth
 * having on a screen: a day the new schedule drops but somebody has already checked into is kept
 * rather than deleted, because deleting it would destroy a record a fellow created.
 *
 * **Read-only.** Both the preview and the save call it, which is what stops the sentence above the
 * button from being computed by different arithmetic from the button.
 */
async function resolveScheduleChange(
  db: Tx,
  programId: string,
  previous: Schedule | null,
  next: Schedule | null,
  today: string,
): Promise<{ make: string[]; remove: string[]; blocked: string[] }> {
  const candidates = scheduleDiff(previous, next, today);

  const existing = await db.attendanceSession.findMany({
    where: { programId, date: { gte: dateColumnFor(today) } },
    select: { id: true, date: true },
  });

  const haveADay = new Set(existing.map((session) => schoolDayFromColumn(session.date)));

  // A day that already has a session needs no second one. `@@unique([programId, date])` would
  // refuse it anyway; filtering here is what makes the count above the button honest.
  const make = candidates.make.filter((day) => !haveADay.has(day));

  const removable = candidates.remove.filter((day) => haveADay.has(day));

  const withCheckIns = await db.attendanceRecord.findMany({
    where: {
      source: "SELF_CHECK_IN",
      session: { programId, date: { in: removable.map(dateColumnFor) } },
    },
    select: { session: { select: { date: true } } },
  });

  const blockedDays = new Set(
    withCheckIns.map((record) => schoolDayFromColumn(record.session.date)),
  );

  return {
    make,
    remove: removable.filter((day) => !blockedDays.has(day)),
    blocked: removable.filter((day) => blockedDays.has(day)),
  };
}

/**
 * The four fields, validated together.
 *
 * All four or none of them, matching the `_schedule_is_whole` CHECK, so a half-filled form is
 * refused in a sentence rather than by a constraint violation. The two-year bound is what stops a
 * mistyped year building a list of a hundred thousand days.
 */
const scheduleInput = z
  .object({
    startsOn: schoolDaySchema.nullable(),
    endsOn: schoolDaySchema.nullable(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7),
    startsAt: z
      .string()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "A start time looks like 09:30.")
      .nullable(),
  })
  .refine(
    (value) =>
      (value.startsOn === null) === (value.endsOn === null) &&
      (value.startsOn === null) === (value.startsAt === null) &&
      (value.startsOn === null) === (value.weekdays.length === 0),
    "A schedule needs a first day, a last day, at least one weekday, and a start time.",
  )
  .refine(
    (value) => value.startsOn === null || value.endsOn! >= value.startsOn,
    "A program cannot finish before it begins.",
  )
  .refine((value) => {
    if (value.startsOn === null) return true;
    const span =
      (Date.parse(`${value.endsOn}T00:00:00Z`) - Date.parse(`${value.startsOn}T00:00:00Z`)) /
      86_400_000;
    return span <= SCHEDULE_MAX_DAYS;
  }, `A schedule cannot run longer than ${SCHEDULE_MAX_DAYS} days.`);

/** The schedule as the input gives it, or null when the input clears it. */
function scheduleFromInput(input: z.infer<typeof scheduleInput>): Schedule | null {
  if (input.startsOn === null || input.endsOn === null || input.startsAt === null) return null;
  return {
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    weekdays: input.weekdays,
    startsAt: input.startsAt,
  };
}
```

- [ ] **Step 4: Add the two procedures**

In `trpc/routers/programs.ts`, immediately after `setAttendanceLateAfter`:

```ts
  /**
   * What saving this schedule would make and remove, without saving it.
   *
   * A query rather than a flag on the mutation, so the settings screen can recompute the sentence
   * above the button as somebody types without anything being written by a keystroke.
   */
  attendanceSchedulePreview: programProcedure
    .input(scheduleInput)
    .query(async ({ ctx, input }) => {
      const program = await ctx.db.program.findUniqueOrThrow({
        where: { id: input.programId },
        select: scheduleSelect,
      });

      return resolveScheduleChange(
        ctx.db,
        input.programId,
        scheduleOf(program),
        scheduleFromInput(input),
        schoolDayOf(new Date()),
      );
    }),

  /**
   * Declare when this program meets, and make the days.
   *
   * **The save changes exactly the days whose meeting status changed**, which is what lets it be
   * run twice, and what keeps a holiday an instructor removed removed: that day meets under both
   * the old schedule and the new, so neither list mentions it. See `scheduleDiff`.
   *
   * Three things happen, in one transaction:
   *
   * 1. A session is made for every meeting day from today that did not meet before and has no
   *    session, each with its own day's start time and the backstop eight hours later.
   * 2. Every session after today whose day no longer meets is deleted — unless a fellow checked
   *    themselves into it, which `resolveScheduleChange` reports separately rather than
   *    destroying.
   * 3. Every remaining session after today has its clock rewritten to the new start time and its
   *    lateness threshold re-copied.
   *
   * **Today is made but never rewritten and never removed.** It may already hold check-ins
   * measured against the clock it has, and the rule that a recorded morning is never silently
   * restated is the same one `AttendanceSession.lateAfterMinutes` exists for. An instructor who
   * needs today moved edits it on the day screen, which recomputes statuses as it does now.
   *
   * It sweeps as well, because it is one of the few moments an instructor touches the program's
   * days and there is no scheduler to close yesterday's books.
   */
  setAttendanceSchedule: programProcedure
    .input(scheduleInput)
    .mutation(async ({ ctx, input }) => {
      const today = schoolDayOf(new Date());

      const program = await ctx.db.program.findUniqueOrThrow({
        where: { id: input.programId },
        select: { id: true, name: true, archivedAt: true, attendanceLateAfterMinutes: true, ...scheduleSelect },
      });

      if (program.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${program.name} has finished, so its attendance schedule cannot be changed.`,
        });
      }

      const next = scheduleFromInput(input);

      return inTransaction(ctx.db, async (tx) => {
        const change = await resolveScheduleChange(
          tx,
          input.programId,
          scheduleOf(program),
          next,
          today,
        );

        await tx.program.update({
          where: { id: input.programId },
          data: {
            attendanceStartsOn: next ? dateColumnFor(next.startsOn) : null,
            attendanceEndsOn: next ? dateColumnFor(next.endsOn) : null,
            attendanceWeekdays: next ? next.weekdays : [],
            attendanceStartsAt: next ? next.startsAt : null,
          },
          select: { id: true },
        });

        if (change.make.length > 0 && next) {
          await tx.attendanceSession.createMany({
            data: change.make.map((day) => {
              const startedAt = instantAtSchoolClock(day, next.startsAt);
              return {
                programId: input.programId,
                date: dateColumnFor(day),
                startedAt,
                endsAt: defaultEndsAt(startedAt),
                lateAfterMinutes: program.attendanceLateAfterMinutes,
                codeSecret: newSessionSecret(),
                // The schedule opened this day, not a person, and the column means who.
                startedById: null,
                note: null,
              };
            }),
            // Belt and braces against a save racing another: the unique index settles it and this
            // transaction survives, for the reason `attendance.start` explains at length.
            skipDuplicates: true,
          });
        }

        if (change.remove.length > 0) {
          await tx.attendanceSession.deleteMany({
            where: {
              programId: input.programId,
              date: { in: change.remove.map(dateColumnFor) },
            },
          });
        }

        /*
          Rewrite the clock of every day still standing after today. One statement per distinct day
          rather than one for all of them, because each day's 9:30 is a different instant — and
          across a daylight-saving change two days' 9:30 differ by an hour, which a single `SET`
          could not express.
        */
        if (next) {
          const standing = await tx.attendanceSession.findMany({
            where: { programId: input.programId, date: { gt: dateColumnFor(today) } },
            select: { id: true, date: true },
          });

          for (const session of standing) {
            const startedAt = instantAtSchoolClock(
              schoolDayFromColumn(session.date),
              next.startsAt,
            );
            await tx.attendanceSession.update({
              where: { id: session.id },
              data: {
                startedAt,
                endsAt: defaultEndsAt(startedAt),
                lateAfterMinutes: program.attendanceLateAfterMinutes,
              },
              select: { id: true },
            });
          }
        }

        await recordEvent(tx, {
          action: "PROGRAM_ATTENDANCE_SCHEDULE_SET",
          actor: auditActor(ctx),
          subject: { id: program.id, label: program.name },
          program: { id: program.id, label: program.name },
          detail: {
            startsOn: next?.startsOn ?? null,
            endsOn: next?.endsOn ?? null,
            weekdays: next?.weekdays ?? [],
            startsAt: next?.startsAt ?? null,
            made: change.make.length,
            removed: change.remove,
            keptBecauseAttended: change.blocked,
          },
        });

        return change;
      });
    }),
```

- [ ] **Step 5: Make the lateness setting reach the days already made**

Replace `setAttendanceLateAfter` in the same file:

```ts
  /**
   * How long after the day starts a fellow still counts as on time.
   *
   * **It reaches the days that have not begun.** Under a schedule the sessions for the rest of the
   * term already exist, each holding a copy of this number, so a change that only affected days
   * made after it would never reach any of them. Days already begun keep what they ran under,
   * which is the whole reason the column is copied rather than read through.
   */
  setAttendanceLateAfter: programProcedure
    .input(z.object({ minutes: z.number().int().min(0).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const today = schoolDayOf(new Date());

      return inTransaction(ctx.db, async (tx) => {
        const program = await tx.program.update({
          where: { id: input.programId },
          data: { attendanceLateAfterMinutes: input.minutes },
          select: { id: true, attendanceLateAfterMinutes: true },
        });

        await tx.attendanceSession.updateMany({
          where: { programId: input.programId, date: { gt: dateColumnFor(today) } },
          data: { lateAfterMinutes: input.minutes },
        });

        return program;
      });
    }),
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run test:integration -- -t "declares when it meets"
```
Expected: PASS, all twelve.

- [ ] **Step 7: Run the whole suite, lint, and commit**

```bash
npm test && npm run test:integration && npm run lint
git add trpc/routers/programs.ts tests/integration/attendance.test.ts
git commit -m "$(cat <<'EOF'
Saving a schedule makes the days and removes the ones it dropped

The save changes exactly the days whose meeting status changed, so running
it twice does nothing and a holiday an instructor deleted stays deleted. A
day somebody already checked into is kept and reported rather than
destroyed, and the preview is a query so the count above the button and the
button itself cannot disagree.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Prepare and start read the schedule

**Files:**
- Modify: `trpc/routers/attendance.ts`
- Test: `tests/integration/attendance.test.ts`

**Interfaces:**
- Consumes: `scheduleOf` from `lib/attendance/schedule.ts`; `instantAtSchoolClock` from `lib/school-time.ts`.
- Produces: `attendance.prepare` gains an optional `day`; both procedures write the scheduled clock; the module-local `windowForDay`.

- [ ] **Step 1: Write the failing tests**

Append to the same describe block in `tests/integration/attendance.test.ts`:

```ts
describe("making one day of a scheduled program", () => {
  const today = () => schoolDayOf(new Date());

  function daysFromToday(count: number): string {
    const at = new Date(`${today()}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + count);
    return at.toISOString().slice(0, 10);
  }

  async function scheduled(tx: Tx) {
    const world = await makeWorld(tx);
    const caller = createCaller(tx, world.instructor.id);
    await caller.programs.setAttendanceSchedule({
      programId: world.program.id,
      startsOn: today(),
      endsOn: daysFromToday(6),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsAt: "09:30",
    });
    return { world, caller };
  }

  // Making a removed day again is the only way back, so it has to work for a day that is not today.
  it("makes a removed day again with that day's clock", async () => {
    await withRollback(async (tx) => {
      const { world, caller } = await scheduled(tx);

      const session = await tx.attendanceSession.findFirstOrThrow({
        where: { programId: world.program.id, date: dateColumnFor(daysFromToday(2)) },
      });
      await caller.attendance.deleteSession({ sessionId: session.id });

      const remade = await caller.attendance.prepare({
        programId: world.program.id,
        day: daysFromToday(2),
      });

      expect(remade.prepared).toBe(true);
      expect(remade.state).toBe("scheduled");

      const row = await tx.attendanceSession.findFirstOrThrow({
        where: { programId: world.program.id, date: dateColumnFor(daysFromToday(2)) },
      });
      expect(row.startedAt?.toISOString()).toBe(
        instantAtSchoolClock(daysFromToday(2), "09:30").toISOString(),
      );
    });
  });

  it("refuses a day already behind", async () => {
    await withRollback(async (tx) => {
      const { world, caller } = await scheduled(tx);

      expect(
        await refusal(() =>
          caller.attendance.prepare({ programId: world.program.id, day: daysFromToday(-1) }),
        ),
      ).not.toBe("accepted");
    });
  });

  // Without a schedule there is no clock to give a future day, so prepare stays what it was.
  it("refuses a future day when the program has no schedule", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);

      expect(
        await refusal(() =>
          caller.attendance.prepare({ programId: world.program.id, day: daysFromToday(2) }),
        ),
      ).not.toBe("accepted");

      const pending = await caller.attendance.prepare({ programId: world.program.id });
      expect(pending.state).toBe("pending");
    });
  });

  /*
    An instructor pressing Start on a scheduled program at 9:40 must not restart the lateness clock
    from 9:40 — everybody who arrived at 9:35 would become on time and everybody at 9:31 would stop
    being late.
  */
  it("start writes the scheduled clock rather than this moment", async () => {
    await withRollback(async (tx) => {
      const { world, caller } = await scheduled(tx);

      const session = await tx.attendanceSession.findFirstOrThrow({
        where: { programId: world.program.id, date: dateColumnFor(today()) },
      });
      await caller.attendance.deleteSession({ sessionId: session.id });

      await caller.attendance.start({ programId: world.program.id });

      const row = await tx.attendanceSession.findFirstOrThrow({
        where: { programId: world.program.id, date: dateColumnFor(today()) },
      });
      expect(row.startedAt?.toISOString()).toBe(
        instantAtSchoolClock(today(), "09:30").toISOString(),
      );
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:integration -- -t "making one day of a scheduled program"
```
Expected: FAIL, prepare rejecting the `day` input.

- [ ] **Step 3: Rewrite prepare**

In `trpc/routers/attendance.ts`, add to the imports:

```ts
import { scheduleOf } from "@/lib/attendance/schedule";
```

Add a helper after `refuseClosed`:

```ts
/**
 * The window a new session gets for a given day.
 *
 * A schedule gives that day's start time; without one there is no clock to give a day that has not
 * come, which is why `prepare` refuses a future day for a program that has none. `start` passes
 * `now` as the fallback, because pressing the button is what opens an unscheduled day.
 */
function windowForDay(
  schedule: { startsAt: string } | null,
  day: SchoolDay,
  fallback: Date | null,
): { startedAt: Date; endsAt: Date } | { startedAt: null; endsAt: null } {
  const startedAt = schedule ? instantAtSchoolClock(day, schedule.startsAt) : fallback;
  if (startedAt === null) return { startedAt: null, endsAt: null };
  return { startedAt, endsAt: defaultEndsAt(startedAt) };
}
```

Add `instantAtSchoolClock` to the `@/lib/school-time` import.

Replace `prepare`'s doc comment and body:

```ts
  /**
   * Make a day's session without anybody pressing start.
   *
   * **Two jobs, and which one it does depends on whether the program has a schedule.** Without one
   * it makes today's code and no clock, so an instructor can write four digits on a whiteboard
   * while the room fills and open check-in separately — the session is prepared, it accepts
   * nothing, and no fellow can check in against it. With one it makes a day whose clock is already
   * set from the schedule, which is how a removed holiday is put back and how a Saturday make-up
   * day is added.
   *
   * The session it creates without a schedule is the same row `start` would have created, minus
   * its window: same secret, same derivation, therefore **the same code before and after start**.
   * That matters more than it looks — a code written on a board at 8:40 has to still be the code at
   * 9:05, or the feature is worse than having no feature.
   *
   * **A day already behind is refused, and a future day is refused without a schedule.** A code
   * made for a morning that has been and gone is useless, and `start` is the way to write up a past
   * session; and a future day with no schedule has no clock to be given, so the row could not be
   * made at all.
   *
   * Idempotent the same way `start` is, and for the same race: `prepared: false` comes back when
   * somebody had already made that day.
   */
  prepare: programProcedure
    .input(z.object({ day: schoolDaySchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const today = schoolDayOf(now);
      const day = input.day ?? today;

      const program = await ctx.db.program.findUniqueOrThrow({
        where: { id: input.programId },
        select: {
          id: true,
          name: true,
          archivedAt: true,
          attendanceLateAfterMinutes: true,
          attendanceStartsOn: true,
          attendanceEndsOn: true,
          attendanceWeekdays: true,
          attendanceStartsAt: true,
        },
      });

      if (program.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${program.name} has finished, so attendance cannot be taken in it.`,
        });
      }

      if (day < today) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "A code cannot be made for a day that has already happened. Start that day instead, " +
            "which lets you record it by hand.",
        });
      }

      const schedule = scheduleOf(program);

      if (day > today && schedule === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${program.name} has no schedule, so there is no start time to give a day ahead. ` +
            `Set when the program meets on its settings screen, or make this day on the day itself.`,
        });
      }

      const window = windowForDay(schedule, day, null);

      return inTransaction(ctx.db, async (tx) => {
        const { swept, finalized, deletedPending } = await sweepStale(tx, program.id, today);

        // `createMany` with `skipDuplicates` for the reason `start` explains at length: it compiles
        // to `ON CONFLICT DO NOTHING`, so the unique index settles the race without a failed
        // statement aborting the transaction. The count is who won.
        const inserted = await tx.attendanceSession.createMany({
          data: [
            {
              programId: program.id,
              date: dateColumnFor(day),
              startedAt: window.startedAt,
              endsAt: window.endsAt,
              lateAfterMinutes: program.attendanceLateAfterMinutes,
              codeSecret: newSessionSecret(),
              // Nobody has started it. The column means who opened check-in, and answering it with
              // whoever made the code — or with the schedule, which is nobody — would put a name
              // against an act that was not performed.
              startedById: null,
              note: null,
            },
          ],
          skipDuplicates: true,
        });

        const prepared = inserted.count === 1;

        const session: SessionRow = await tx.attendanceSession.findUniqueOrThrow({
          where: { programId_date: { programId: program.id, date: dateColumnFor(day) } },
          select: sessionSelect,
        });

        if (prepared) {
          await recordEvent(tx, {
            action: "ATTENDANCE_SESSION_PREPARED",
            actor: auditActor(ctx),
            subject: { id: session.id, label: day },
            program: { id: program.id, label: program.name },
            // Never the code and never the secret, as `rotateCode` says: the log outlives the
            // session and is readable by anyone who can read the table.
            detail: {
              day,
              lateAfterMinutes: session.lateAfterMinutes,
              fromSchedule: schedule !== null,
              sweptOpenSessions: finalized,
              deletedPreparedSessions: deletedPending,
            },
          });
        }

        return { ...publicSession(session, now), prepared, swept };
      });
    }),
```

Note the sweep now takes `today` rather than `day`, so making a day ahead does not finalize every day between.

- [ ] **Step 4: Teach start the schedule**

In `start`, after the archived check, add:

```ts
      const schedule = scheduleOf(program);
      const window = windowForDay(schedule, day, now);
```

Extend the `select` on the program read to include the four schedule columns, as `prepare` does.

Replace `startedAt: now` and `endsAt: defaultEndsAt(now)` in the `createMany` with `startedAt: window.startedAt, endsAt: window.endsAt`, and the same two in the `updateMany` that claims a prepared session. Add to the doc comment, after the "Two ways in, one outcome" paragraph:

```
   * **A scheduled program measures from its schedule, not from the press.** Pressing this at 9:40
   * on a program whose class starts at 9:30 writes 9:30, so everybody who arrived at 9:35 stays on
   * time and everybody at 9:31 stays late. Writing up a day that has already passed gives that
   * day's clock, already lapsed, which is the state statuses are set against.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test:integration -- -t "making one day of a scheduled program"
npm run test:integration -- -t "declares when it meets"
```
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add trpc/routers/attendance.ts tests/integration/attendance.test.ts
git commit -m "$(cat <<'EOF'
A day made by hand gets the clock the schedule would have given it

Prepare takes a day, so a removed holiday can be put back, and refuses a
day ahead for a program with no schedule because there would be no start
time to give it. Start writes the scheduled time rather than the moment of
the press, so pressing it late does not make the room on time.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Check-in respects the window and closes yesterday's books

**Files:**
- Modify: `trpc/routers/attendance.ts`
- Test: `tests/integration/attendance.test.ts`

**Interfaces:**
- Consumes: `opensAt`, `OPENS_BEFORE_START_MINUTES` from `lib/attendance/window.ts`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/attendance.test.ts`:

```ts
describe("checking into a scheduled day", () => {
  const today = () => schoolDayOf(new Date());

  /*
    These reach into the session's clock rather than waiting for a real morning. Moving `startedAt`
    is exactly what an instructor correcting a day does, so the row stays one the application could
    have produced.
  */
  async function withStartAt(tx: Tx, sessionId: string, startedAt: Date) {
    await tx.attendanceSession.update({
      where: { id: sessionId },
      data: { startedAt, endsAt: defaultEndsAt(startedAt) },
    });
  }

  it("takes a code two hours before class and calls it present", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);
      const student = createCaller(tx, world.students[0].id);

      const session = await caller.attendance.start({ programId: world.program.id });
      // Class starts in ninety minutes, so the window has been open for half an hour.
      await withStartAt(tx, session.id, new Date(Date.now() + 90 * 60 * 1000));

      const row = await tx.attendanceSession.findUniqueOrThrow({ where: { id: session.id } });
      const checked = await student.attendance.checkIn({
        programId: world.program.id,
        code: codeFor(row),
      });

      expect(checked.status).toBe("PRESENT");
      expect(checked.checkedInAt).not.toBeNull();
    });
  });

  it("refuses a code before the window opens, and writes no failure", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);
      const student = createCaller(tx, world.students[0].id);

      const session = await caller.attendance.start({ programId: world.program.id });
      await withStartAt(tx, session.id, new Date(Date.now() + 3 * 60 * 60 * 1000));

      const row = await tx.attendanceSession.findUniqueOrThrow({ where: { id: session.id } });

      expect(
        await refusal(() =>
          student.attendance.checkIn({ programId: world.program.id, code: codeFor(row) }),
        ),
      ).not.toBe("accepted");

      /*
        A room full of fellows typing the right code off a printed sheet forty minutes early are
        not guessing, and counting them against the twenty-per-session ceiling would lock out
        exactly the people who were paying attention.
      */
      expect(
        await tx.auditEvent.count({ where: { action: "ATTENDANCE_CHECK_IN_FAILED" } }),
      ).toBe(0);
      expect(await tx.attendanceRecord.count({ where: { sessionId: session.id } })).toBe(0);
    });
  });

  // The mechanism that writes absences at all, now that nobody presses prepare or start.
  it("closes an earlier day's books on the first check-in of the morning", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);
      const student = createCaller(tx, world.students[0].id);

      const yesterday = new Date(`${today()}T00:00:00Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayDay = yesterday.toISOString().slice(0, 10);

      const stale = await caller.attendance.start({
        programId: world.program.id,
        day: yesterdayDay,
      });
      // Nobody ended it, and its backstop has long passed.
      expect(
        await tx.attendanceRecord.count({ where: { sessionId: stale.id } }),
      ).toBe(0);

      const todaySession = await caller.attendance.start({ programId: world.program.id });
      // `start` sweeps too, so undo that to prove the check-in is what does the work here.
      await tx.attendanceSession.update({
        where: { id: stale.id },
        data: { endedAt: null },
      });
      await tx.attendanceRecord.deleteMany({ where: { sessionId: stale.id } });

      const row = await tx.attendanceSession.findUniqueOrThrow({
        where: { id: todaySession.id },
      });
      await student.attendance.checkIn({ programId: world.program.id, code: codeFor(row) });

      const closed = await tx.attendanceSession.findUniqueOrThrow({ where: { id: stale.id } });
      expect(closed.endedAt).not.toBeNull();
      expect(
        await tx.attendanceRecord.count({ where: { sessionId: stale.id, status: "ABSENT" } }),
      ).toBe(world.students.length);
    });
  });

  it("writes nothing the second time somebody checks in", async () => {
    await withRollback(async (tx) => {
      const world = await makeWorld(tx);
      const caller = createCaller(tx, world.instructor.id);
      const first = createCaller(tx, world.students[0].id);
      const second = createCaller(tx, world.students[1].id);

      const session = await caller.attendance.start({ programId: world.program.id });
      const row = await tx.attendanceSession.findUniqueOrThrow({ where: { id: session.id } });

      await first.attendance.checkIn({ programId: world.program.id, code: codeFor(row) });
      const before = await tx.attendanceRecord.count();
      await second.attendance.checkIn({ programId: world.program.id, code: codeFor(row) });

      // One new record, from the second fellow. The sweep found nothing to do.
      expect(await tx.attendanceRecord.count()).toBe(before + 1);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:integration -- -t "checking into a scheduled day"
```
Expected: FAIL on the early-code refusal and on the sweep.

- [ ] **Step 3: Sweep at the top of checkIn**

In `checkIn`, immediately after `await assertActiveInProgram(ctx, input.programId);`:

```ts
      /*
        **Close any earlier day's books before doing anything else.**

        This is the sweep that used to run only from `prepare` and `start`. A program on a schedule
        never presses either, so without this nothing would ever write the absences a lapsed day
        leaves implicit: the grid is a pure read, and the figures would be right while the rows
        stayed missing — which a fellow's own calendar would report as "nothing was recorded for
        you" about a morning they missed.

        The first fellow through on Tuesday closes Monday. Every check-in after that costs one
        indexed query returning no rows, because the sweep sets `endedAt` and the selection is on
        its absence. A day nobody attends at all is closed by the next day that somebody does.

        In its own transaction, and first, so it cannot interact with the check-in below: it
        touches only days before today, and today's session is what everything after this reads.
      */
      await inTransaction(ctx.db, (tx) => sweepStale(tx, input.programId, day));
```

- [ ] **Step 4: Refuse a code before the window**

In `checkIn`, replace the `if (!session)` block with:

```ts
      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            `Check-in has not been opened for ${program.name} today. Your instructor starts it ` +
            `at the beginning of class.`,
        });
      }

      /*
        **A day whose window has not opened is refused here, beside the prepared case and for the
        same reason.** Both are "the code is real and it is not time yet", and both are refused
        before the attempt ceilings and without a failure event: a room typing the right code off a
        printed sheet forty minutes early are not guessing, and counting them would lock out the
        people who were paying attention.

        Unlike a prepared session this one can say when, because it has a start. That sentence is
        the whole reason `scheduled` is a state of its own.
      */
      if (sessionStateOf(session, now) === "scheduled") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `Check-in for ${program.name} opens at ${formatSchoolTime(opensAt(session))}, two ` +
            `hours before class starts.`,
        });
      }
```

Add `opensAt` to the `lib/attendance/window` import and `formatSchoolTime` to the `lib/school-time` import.

- [ ] **Step 5: Count failed attempts from when the window opened**

Replace the per-session ceiling's `occurredAt` filter:

```ts
      // The second ceiling, over this session rather than over ten minutes. Four digits and a
      // day-long window would otherwise allow enough attempts to matter.
      //
      // Measured from when the window opened rather than from the start, so the two hours before
      // class are bounded the same way the day after it is.
      const failedThisSession = await ctx.db.auditEvent.count({
        where: {
          actorId: actor.id,
          action: "ATTENDANCE_CHECK_IN_FAILED",
          occurredAt: { gte: opensAt(session) },
        },
      });
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run test:integration -- -t "checking into a scheduled day"
npm run test:integration
```
Expected: PASS, and no regression in the existing attendance tests.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add trpc/routers/attendance.ts tests/integration/attendance.test.ts
git commit -m "$(cat <<'EOF'
The first fellow through in the morning closes yesterday's books

A scheduled program presses neither prepare nor start, so the sweep that
writes absences had nothing left to run it. Check-in runs it, which is the
one write that happens on every day the program meets. A code typed before
the window opens is refused with the time it opens, and writes no failure.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: History stops at today, and two procedures for what is ahead

**Files:**
- Modify: `trpc/routers/attendance.ts`
- Modify: `prisma/schema.prisma` (the `codeSecret` comment)
- Test: `tests/integration/attendance.test.ts`

**Interfaces:**
- Produces: `attendance.upcoming` query returning `{ program: { id, name, term }, days: { id, day, state, startedAt, opensAt, endsAt, lateAfterMinutes, note, code }[] }`; `attendance.removeDays` mutation returning `{ removed: SchoolDay[]; kept: SchoolDay[] }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/attendance.test.ts`:

```ts
describe("the days ahead", () => {
  const today = () => schoolDayOf(new Date());

  function daysFromToday(count: number): string {
    const at = new Date(`${today()}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + count);
    return at.toISOString().slice(0, 10);
  }

  async function scheduled(tx: Tx) {
    const world = await makeWorld(tx);
    const caller = createCaller(tx, world.instructor.id);
    await caller.programs.setAttendanceSchedule({
      programId: world.program.id,
      startsOn: today(),
      endsOn: daysFromToday(6),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsAt: "09:30",
    });
    return { world, caller };
  }

  /*
    The term grid would otherwise stretch to June with a column per day, and the export would carry
    a row per fellow per day that has not happened.
  */
  it("history carries nothing ahead of today", async () => {
    await withRollback(async (tx) => {
      const { world, caller } = await scheduled(tx);

      const term = await caller.attendance.history({ programId: world.program.id });

      expect(term.sessions).toHaveLength(1);
      expect(term.sessions[0].day).toBe(today());
    });
  });

  it("upcoming carries today and everything after it, with the code", async () => {
    await withRollback(async (tx) => {
      const { world, caller } = await scheduled(tx);

      const ahead = await caller.attendance.upcoming({ programId: world.program.id });

      expect(ahead.days).toHaveLength(7);
      expect(ahead.days[0].day).toBe(today());
      expect(ahead.program.name).toBe(world.program.name);

      const row = await tx.attendanceSession.findFirstOrThrow({
        where: { programId: world.program.id, date: dateColumnFor(daysFromToday(3)) },
      });
      expect(ahead.days[3].code).toBe(codeFor(row));
      expect(ahead.days[3].state).toBe("scheduled");
      // Two hours before that day's 9:30.
      expect(ahead.days[3].opensAt?.toISOString()).toBe(
        new Date(
          instantAtSchoolClock(daysFromToday(3), "09:30").getTime() - 120 * 60 * 1000,
        ).toISOString(),
      );
    });
  });

  it("upcoming is refused to a fellow and to an outside instructor", async () => {
    await withRollback(async (tx) => {
      const { world } = await scheduled(tx);

      expect(
        await refusal(() =>
          createCaller(tx, world.students[0].id).attendance.upcoming({
            programId: world.program.id,
          }),
        ),
      ).not.toBe("accepted");
      expect(
        await refusal(() =>
          createCaller(tx, world.outsider.id).attendance.upcoming({
            programId: world.program.id,
          }),
        ),
      ).not.toBe("accepted");
    });
  });

  it("removes a stretch of days and leaves the rest", async () => {
    await withRollback(async (tx) => {
      const { world, caller } = await scheduled(tx);

      const removed = await caller.attendance.removeDays({
        programId: world.program.id,
        from: daysFromToday(2),
        to: daysFromToday(4),
      });

      expect(removed.removed).toEqual([
        daysFromToday(2),
        daysFromToday(3),
        daysFromToday(4),
      ]);
      expect(removed.kept).toEqual([]);
      expect(
        await tx.attendanceSession.count({ where: { programId: world.program.id } }),
      ).toBe(4);
    });
  });

  it("keeps a day somebody checked into and names it", async () => {
    await withRollback(async (tx) => {
      const { world, caller } = await scheduled(tx);

      const session = await tx.attendanceSession.findFirstOrThrow({
        where: { programId: world.program.id, date: dateColumnFor(daysFromToday(3)) },
      });
      await tx.attendanceRecord.create({
        data: {
          sessionId: session.id,
          programId: world.program.id,
          enrollmentId: world.enrollments[0].id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date(),
        },
      });

      const removed = await caller.attendance.removeDays({
        programId: world.program.id,
        from: daysFromToday(2),
        to: daysFromToday(4),
      });

      expect(removed.removed).toEqual([daysFromToday(2), daysFromToday(4)]);
      expect(removed.kept).toEqual([daysFromToday(3)]);
    });
  });

  // Removing the past would destroy the record the feature exists to keep.
  it("never removes a day behind today", async () => {
    await withRollback(async (tx) => {
      const { world, caller } = await scheduled(tx);
      await caller.attendance.start({
        programId: world.program.id,
        day: daysFromToday(-2),
      });

      const removed = await caller.attendance.removeDays({
        programId: world.program.id,
        from: daysFromToday(-5),
        to: daysFromToday(1),
      });

      expect(removed.removed).toEqual([daysFromToday(1)]);
      expect(
        await tx.attendanceSession.count({
          where: { programId: world.program.id, date: dateColumnFor(daysFromToday(-2)) },
        }),
      ).toBe(1);
    });
  });

  it("writes one audit event naming the days", async () => {
    await withRollback(async (tx) => {
      const { world, caller } = await scheduled(tx);

      await caller.attendance.removeDays({
        programId: world.program.id,
        from: daysFromToday(2),
        to: daysFromToday(3),
      });

      const events = await tx.auditEvent.findMany({
        where: { action: "ATTENDANCE_SESSIONS_REMOVED" },
      });
      expect(events).toHaveLength(1);
      expect((events[0].detail as { removed: string[] }).removed).toEqual([
        daysFromToday(2),
        daysFromToday(3),
      ]);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:integration -- -t "the days ahead"
```
Expected: FAIL, `caller.attendance.upcoming is not a function`.

- [ ] **Step 3: Stop history at today**

In `history`, replace the sessions query:

```ts
      ctx.db.attendanceSession.findMany({
        /*
          Today and everything behind it. A scheduled program has a row for every meeting day to
          June, and this payload is what the term grid, the drift list, and the export are all
          built from — so without the bound the grid would stretch a hundred and ninety columns
          into the future and the export would carry a row per fellow per day that has not
          happened. What is ahead is `upcoming`'s job, and it is a different question with a
          different answer shape.
        */
        where: { programId: input.programId, date: { lte: dateColumnFor(schoolDayOf(now)) } },
        orderBy: { date: "asc" },
        select: sessionSelect,
      }),
```

- [ ] **Step 4: Add the upcoming procedure**

After `history` in `trpc/routers/attendance.ts`:

```ts
  /**
   * The days this program has still to meet, with their codes.
   *
   * The counterpart to `history`, which stops at today. Two procedures rather than one payload
   * because the questions differ in everything but the table: one is "what happened, and who was
   * here", answered per fellow across a term; this is "what is coming, and what is the code",
   * answered per day and read by two screens that show no fellow at all.
   *
   * **The third reader of `codeSecret`**, and the one that hands out the most at once. Instructor
   * only, through `programProcedure`. Possessing a code was never enough to check in — `checkIn`
   * asks whether that day's window is open, and it opens two hours before class on the day itself.
   */
  upcoming: programProcedure.query(async ({ ctx, input }) => {
    const now = new Date();

    // The program's name and term come back here rather than being fetched beside this, because
    // the printable sheet needs them and `history` — the only other place they live — loads a
    // term of sessions, enrollments and records to supply two strings.
    const [program, sessions] = await Promise.all([
      ctx.db.program.findUniqueOrThrow({
        where: { id: input.programId },
        select: { id: true, name: true, term: true },
      }),
      ctx.db.attendanceSession.findMany({
        where: { programId: input.programId, date: { gte: dateColumnFor(schoolDayOf(now)) } },
        orderBy: { date: "asc" },
        select: sessionWithSecretSelect,
      }),
    ]);

    return {
      program,
      days: sessions.map((session) => {
        const { startedAt, endsAt } = session;

        return {
          id: session.id,
          day: schoolDayFromColumn(session.date),
          state: sessionStateOf(session, now),
          startedAt,
          endsAt,
          /** Null on a prepared day, which has no start to measure two hours back from. */
          opensAt:
            startedAt !== null && endsAt !== null
              ? opensAt({ ...session, startedAt, endsAt })
              : null,
          lateAfterMinutes: session.lateAfterMinutes,
          note: session.note,
          /** Derived, never stored. See `lib/attendance/code.ts`. */
          code: codeFor(session),
        };
      }),
    };
  }),

  /**
   * Remove a stretch of days at once.
   *
   * **Winter break is the reason this exists.** Ten days removed one at a time from the term
   * screen is ten confirmations, and the alternative — leaving them — is a fortnight of mornings
   * that open themselves, take no check-ins, and finalize the whole roster absent.
   *
   * **Today is removable and yesterday is not.** A day behind today is the record the feature
   * exists to keep, and a range that reaches back is clipped rather than refused, because somebody
   * typing "the whole of December" in January means the part of December that has not happened.
   *
   * A day a fellow checked themselves into is kept and named, never destroyed — the same guard
   * `deleteSession` applies to one day, for the same reason. Absences written by the sweep do not
   * count, so a holiday nobody removed in time is still removable afterwards and takes them with
   * it.
   *
   * One audit event for the stretch, with the days in its detail.
   * `ATTENDANCE_SESSION_DELETED` stays the value for removing one day, where a session id is the
   * subject and worth having.
   */
  removeDays: programProcedure
    .input(z.object({ from: schoolDaySchema, to: schoolDaySchema }))
    .mutation(async ({ ctx, input }) => {
      const today = schoolDayOf(new Date());

      const program = await ctx.db.program.findUniqueOrThrow({
        where: { id: input.programId },
        select: { id: true, name: true, archivedAt: true },
      });

      if (program.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${program.name} has finished, so its attendance cannot be changed.`,
        });
      }

      if (input.to < input.from) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The last day of the stretch comes before the first.",
        });
      }

      // Clipped rather than refused: "the whole of December", asked in January, means what is left
      // of it.
      const from = input.from > today ? input.from : today;

      return inTransaction(ctx.db, async (tx) => {
        await sweepStale(tx, program.id, today);

        const candidates = await tx.attendanceSession.findMany({
          where: {
            programId: program.id,
            date: { gte: dateColumnFor(from), lte: dateColumnFor(input.to) },
          },
          orderBy: { date: "asc" },
          select: { id: true, date: true },
        });

        if (candidates.length === 0) return { removed: [], kept: [] };

        const attended = await tx.attendanceRecord.findMany({
          where: {
            sessionId: { in: candidates.map((session) => session.id) },
            source: "SELF_CHECK_IN",
          },
          select: { sessionId: true },
        });

        const blocked = new Set(attended.map((record) => record.sessionId));

        const removable = candidates.filter((session) => !blocked.has(session.id));
        const removed = removable.map((session) => schoolDayFromColumn(session.date));
        const kept = candidates
          .filter((session) => blocked.has(session.id))
          .map((session) => schoolDayFromColumn(session.date));

        if (removable.length > 0) {
          await tx.attendanceSession.deleteMany({
            where: { id: { in: removable.map((session) => session.id) } },
          });

          await recordEvent(tx, {
            action: "ATTENDANCE_SESSIONS_REMOVED",
            actor: auditActor(ctx),
            subject: { id: program.id, label: `${from} to ${input.to}` },
            program: { id: program.id, label: program.name },
            detail: { from, to: input.to, removed, keptBecauseAttended: kept },
          });
        }

        return { removed, kept };
      });
    }),
```

Add `opensAt` to the window import if Task 7 has not already.

- [ ] **Step 5: Name the third reader in the schema comment**

In `prisma/schema.prisma`, on `AttendanceSession.codeSecret`, replace the last line of its doc comment:

```prisma
  /// **Never selected into a payload.** The same rule as `Program.joinToken` and sharper — that one
  /// admits somebody to a roster, this one lets them mark themselves present from bed. Only
  /// `lib/attendance/code.ts` reads it, for `checkIn`, `sessionCode`, and `upcoming`.
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run test:integration -- -t "the days ahead"
npm run test:integration
```
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add trpc/routers/attendance.ts prisma/schema.prisma tests/integration/attendance.test.ts
git commit -m "$(cat <<'EOF'
What happened and what is coming are two questions

History stops at today, so a term grid does not stretch a hundred and
ninety columns into June and the export carries no day that has not
happened. Upcoming answers the other half per day rather than per fellow,
and removeDays takes winter break out in one act.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: A day that has not opened cannot be ended

**Files:**
- Modify: `trpc/routers/attendance.ts`
- Test: `tests/integration/attendance.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/attendance.test.ts`:

```ts
describe("acting on a day that has not opened", () => {
  async function dayAhead(tx: Tx) {
    const world = await makeWorld(tx);
    const caller = createCaller(tx, world.instructor.id);
    const session = await caller.attendance.start({ programId: world.program.id });
    // Class is three hours away, so the window has not opened.
    await tx.attendanceSession.update({
      where: { id: session.id },
      data: {
        startedAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        endsAt: defaultEndsAt(new Date(Date.now() + 3 * 60 * 60 * 1000)),
      },
    });
    return { world, caller, sessionId: session.id };
  }

  /*
    Ending writes an ABSENT row for every active fellow. Doing that to a morning nobody could have
    attended yet would put a day of absences in a report against a roster that had done nothing
    wrong.
  */
  it("refuses to end it", async () => {
    await withRollback(async (tx) => {
      const { caller, sessionId } = await dayAhead(tx);

      expect(await refusal(() => caller.attendance.endSession({ sessionId }))).not.toBe("accepted");
      expect(await tx.attendanceRecord.count({ where: { sessionId } })).toBe(0);
    });
  });

  // Excusing somebody ahead of time is the reason a scheduled day is not treated like a prepared
  // one: the sweep never deletes it, so a record on it is safe.
  it("allows a status to be set on it", async () => {
    await withRollback(async (tx) => {
      const { world, caller, sessionId } = await dayAhead(tx);

      const set = await caller.attendance.setStatus({
        sessionId,
        enrollmentId: world.enrollments[0].id,
        status: "EXCUSED",
        note: "Hospital appointment",
      });

      expect(set.status).toBe("EXCUSED");
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:integration -- -t "acting on a day that has not opened"
```
Expected: FAIL on the first test; `endSession` accepts it and writes absences.

- [ ] **Step 3: Refuse the end**

In `endSession`, after the session is loaded and narrowed by `requireStarted`, add:

```ts
      /*
        **A day whose window has not opened cannot be ended**, because ending writes an ABSENT row
        for every active fellow and none of them could have checked in yet. Remove the day instead:
        that is what an instructor who knows the program will not meet actually means, and it
        leaves the calendar as though the day had never been made.
      */
      if (sessionStateOf(session, now) === "scheduled") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `Check-in for this day has not opened yet, so ending it would mark everybody absent ` +
            `for a morning nobody could attend. Remove the day instead.`,
        });
      }
```

- [ ] **Step 4: Confirm setStatus needs no change**

`setStatus` narrows with `requireStarted`, which reads the columns rather than the clock. A scheduled session has both, so it passes already. Extend the comment on `requireStarted` by adding a paragraph at its end:

```
 * **A scheduled session passes**, and that is the difference the schedule makes. This reads the
 * columns rather than the clock, so a day made from a schedule — which has a start, just one that
 * has not arrived — is narrowed like any other. That is what lets an instructor excuse somebody
 * for a day next week, and it is safe for the reason the prepared case is not: the sweep never
 * deletes a day ahead, so a record written on one cannot be quietly destroyed.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test:integration -- -t "acting on a day that has not opened"
npm run test:integration
```
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add trpc/routers/attendance.ts tests/integration/attendance.test.ts
git commit -m "$(cat <<'EOF'
Ending a day nobody could attend would mark everybody absent

Refused in words, pointing at removing the day, which is what an instructor
who knows the program will not meet actually means. Setting a status is
allowed on a day ahead, because the sweep never deletes one and a record
written on it is safe.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The "Class meets" settings block

**Files:**
- Create: `components/instructor/program-schedule.tsx`
- Modify: `components/instructor/program-settings.tsx`
- Modify: `trpc/routers/programs.ts` (add the schedule to whatever the settings screen reads)

**Interfaces:**
- Consumes: `programs.attendanceSchedulePreview`, `programs.setAttendanceSchedule`.
- Produces: `<ProgramSchedule program={...} />`.

- [ ] **Step 1: Return the schedule to the settings screen**

The screen's payload is `RouterOutputs["programs"]["settings"]`. In the `programs.settings` procedure, add the four columns to the program `select` and to the `program` object it returns, converting the two dates on the way out:

```ts
        attendanceStartsOn: program.attendanceStartsOn
          ? schoolDayFromColumn(program.attendanceStartsOn)
          : null,
        attendanceEndsOn: program.attendanceEndsOn
          ? schoolDayFromColumn(program.attendanceEndsOn)
          : null,
        attendanceWeekdays: program.attendanceWeekdays,
        attendanceStartsAt: program.attendanceStartsAt,
```

- [ ] **Step 2: Write the component**

Create `components/instructor/program-schedule.tsx`:

```tsx
"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { SCHOOL_WEEK, formatSchoolDay } from "@/lib/school-time";
import { useTRPC } from "@/trpc/client";

/**
 * When the program meets.
 *
 * **A range with the exceptions removed, which is the shape the year actually has.** A program
 * meets nearly every weekday for nine months; declaring those days one at a time is the burden
 * this replaces, and declaring them as a rule leaves only the holidays to deal with.
 *
 * **The sentence above the button is the whole safety of the screen.** Saving makes and deletes
 * attendance sessions in bulk, so it says how many of each before anything happens, and it names
 * the days it will keep because somebody has already checked into them. It comes from
 * `attendanceSchedulePreview`, which is the same arithmetic the save runs — a second
 * implementation here is how the count and the act would come to disagree.
 */

const WEEKDAY_LABEL: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

type Program = {
  id: string;
  attendanceStartsOn: string | null;
  attendanceEndsOn: string | null;
  attendanceWeekdays: number[];
  attendanceStartsAt: string | null;
};

export function ProgramSchedule({ program }: { program: Program }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [startsOn, setStartsOn] = React.useState(program.attendanceStartsOn ?? "");
  const [endsOn, setEndsOn] = React.useState(program.attendanceEndsOn ?? "");
  const [startsAt, setStartsAt] = React.useState(program.attendanceStartsAt ?? "09:30");
  const [weekdays, setWeekdays] = React.useState<number[]>(
    program.attendanceWeekdays.length > 0 ? program.attendanceWeekdays : [1, 2, 3, 4, 5],
  );

  const whole = startsOn !== "" && endsOn !== "" && startsAt !== "" && weekdays.length > 0;
  const forward = startsOn !== "" && endsOn !== "" && endsOn >= startsOn;
  const valid = whole && forward;

  const input = {
    programId: program.id,
    startsOn: startsOn || null,
    endsOn: endsOn || null,
    weekdays,
    startsAt: startsAt || null,
  };

  const preview = useQuery({
    ...trpc.programs.attendanceSchedulePreview.queryOptions(input),
    enabled: valid,
  });

  const save = useMutation(
    trpc.programs.setAttendanceSchedule.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            result.make.length === 0 && result.remove.length === 0
              ? "The schedule is saved. No days changed."
              : `Saved. ${describe(result.make.length, "day")} made, ` +
                `${describe(result.remove.length, "day")} removed.`,
          ),
      }),
    ),
  );

  const clear = useMutation(
    trpc.programs.setAttendanceSchedule.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            `The schedule is cleared. ${describe(result.remove.length, "day")} removed. ` +
              `Attendance goes back to being started by hand.`,
          ),
      }),
    ),
  );

  const busy = save.isPending || clear.isPending;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Class meets</h2>
        <p className="text-xs text-muted-foreground">
          Say when the program meets and every day makes itself, with its code ready in advance.
          Check-in opens two hours before class and the code stops working eight hours after it
          starts. Remove the days you do not meet from the attendance screen.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save.mutate(input);
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">First day</span>
          <Input
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
            className="w-40"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Last day</span>
          <Input
            type="date"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
            className="w-40"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Class starts at</span>
          <Input
            type="time"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="w-32"
          />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium">Days it meets</legend>
          <div className="flex flex-wrap items-center gap-3">
            {SCHOOL_WEEK.map((weekday) => (
              <label key={weekday} className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={weekdays.includes(weekday)}
                  onCheckedChange={(checked) =>
                    setWeekdays((current) =>
                      checked
                        ? [...current, weekday].sort()
                        : current.filter((day) => day !== weekday),
                    )
                  }
                />
                {WEEKDAY_LABEL[weekday]}
              </label>
            ))}
          </div>
        </fieldset>

        <Button type="submit" size="sm" disabled={!valid || busy}>
          Save
        </Button>
      </form>

      {!forward && startsOn !== "" && endsOn !== "" && (
        <p className="text-xs text-destructive">The last day comes before the first.</p>
      )}

      {valid && preview.data && (
        <p className="text-xs text-muted-foreground">
          Saving makes {describe(preview.data.make.length, "day")} and removes{" "}
          {describe(preview.data.remove.length, "day")}.
          {preview.data.blocked.length > 0 && (
            <>
              {" "}
              {describe(preview.data.blocked.length, "day")} stays, because somebody has already
              checked in on {preview.data.blocked.map(formatSchoolDay).join(", ")}.
            </>
          )}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Changing the start time applies to every day that has not begun. Today keeps the time it
        started with, because fellows may already have checked in against it — to move today, open
        it from the attendance screen.
      </p>

      {program.attendanceStartsOn !== null && (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              clear.mutate({
                programId: program.id,
                startsOn: null,
                endsOn: null,
                weekdays: [],
                startsAt: null,
              })
            }
          >
            Clear the schedule
          </Button>
        </div>
      )}
    </section>
  );
}

/** "1 day" or "3 days". Here because the sentence above the button says it four times. */
function describe(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
```

- [ ] **Step 3: Mount it**

In `components/instructor/program-settings.tsx`, import `ProgramSchedule` and render it immediately before `<AttendanceCard data={data} />`:

```tsx
      <ProgramSchedule program={data.program} />
```

Update the paragraph inside `AttendanceCard` that begins "Applies to sessions started from now on" to read:

```tsx
      <p className="text-xs text-muted-foreground">
        Applies to every day that has not begun, including days the schedule has already made.
        Nothing already recorded changes — to correct a morning that was taken with the wrong
        number, open that day from the attendance screen.
      </p>
```

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/instructor/program-schedule.tsx components/instructor/program-settings.tsx trpc/routers/programs.ts
git commit -m "$(cat <<'EOF'
The settings screen says how many days saving will make

A first day, a last day, the weekdays and a start time, with the count of
days made and removed above the button. The count comes from the preview
query rather than from arithmetic repeated here, so the sentence and the
act cannot disagree, and it names any day kept because somebody checked in.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: The coming days, and removing a stretch

**Files:**
- Create: `components/instructor/attendance-upcoming.tsx`
- Modify: `components/instructor/attendance-term.tsx`

**Interfaces:**
- Consumes: `attendance.upcoming`, `attendance.removeDays`, `attendance.deleteSession`.
- Produces: `<AttendanceUpcoming programId={...} />`.

- [ ] **Step 1: Write the component**

Create `components/instructor/attendance-upcoming.tsx`:

```tsx
"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatSchoolDay, formatSchoolTime } from "@/lib/school-time";
import { useTRPC } from "@/trpc/client";

/**
 * The days this program has still to meet.
 *
 * **Separate from the term grid above it, because they answer different questions.** The grid is
 * what happened and who was here; this is what is coming and whether it should be. The grid stops
 * at today for that reason — a hundred and ninety empty columns stretching to June would bury the
 * fortnight anybody actually reads.
 *
 * **Removing is the only maintenance a schedule needs.** A holiday nobody removes opens itself,
 * takes no check-ins, and finalizes the whole roster absent, which shows up as a column of red on
 * the grid and is still removable afterwards. Doing it ahead of time is cheaper, and winter break
 * is why the stretch dialog exists beside the per-day button.
 */

type Upcoming = {
  id: string;
  day: string;
  state: string;
  opensAt: Date | null;
  startedAt: Date | null;
  endsAt: Date | null;
};

export function AttendanceUpcoming({ programId }: { programId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const settled = useServerMutation();

  const upcoming = useQuery(trpc.attendance.upcoming.queryOptions({ programId }));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.attendance.upcoming.queryKey({ programId }) });

  const removeOne = useMutation(
    trpc.attendance.deleteSession.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`${formatSchoolDay(result.day)} removed.`);
          void invalidate();
        },
      }),
    ),
  );

  const days = upcoming.data?.days ?? [];

  if (days.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Days still to come</h2>
          <p className="text-xs text-muted-foreground">
            Each one opens itself two hours before class. Remove the days the program will not
            meet — a day left in place marks everybody absent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RemoveStretch programId={programId} onDone={invalidate} />
          <Button size="sm" variant="outline" asChild>
            <a href={`/present/attendance/${programId}/codes`} target="_blank" rel="noreferrer">
              <Printer data-icon="inline-start" />
              Print the coming codes
            </a>
          </Button>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
        {days.map((day: Upcoming) => (
          <li key={day.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{formatSchoolDay(day.day)}</span>
              <span className="text-xs text-muted-foreground">
                {day.opensAt && day.startedAt && day.endsAt
                  ? `Check-in opens ${formatSchoolTime(day.opensAt)}, class starts ` +
                    `${formatSchoolTime(day.startedAt)}, code stops ${formatSchoolTime(day.endsAt)}`
                  : "The code is made; check-in has not been opened"}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={removeOne.isPending}
              onClick={() => removeOne.mutate({ sessionId: day.id })}
            >
              <Trash2 data-icon="inline-start" />
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Winter break, in one act rather than ten. */
function RemoveStretch({ programId, onDone }: { programId: string; onDone: () => void }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const remove = useMutation(
    trpc.attendance.removeDays.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(
            result.kept.length === 0
              ? `${result.removed.length} day${result.removed.length === 1 ? "" : "s"} removed.`
              : `${result.removed.length} removed. ` +
                `${result.kept.map(formatSchoolDay).join(", ")} kept, because somebody had ` +
                `already checked in.`,
          );
          setOpen(false);
          setFrom("");
          setTo("");
          onDone();
        },
      }),
    ),
  );

  const valid = from !== "" && to !== "" && to >= from;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Remove a stretch of days
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove a stretch of days</DialogTitle>
          <DialogDescription>
            Every day between these two, today included, stops being a class day. A day somebody
            has already checked into is kept and named. Days that have already happened are never
            touched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">From</span>
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-40"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">To</span>
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-40"
            />
          </label>
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="destructive"
            disabled={!valid || remove.isPending}
            onClick={() => remove.mutate({ programId, from, to })}
          >
            Remove day(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Mount it on the term screen**

In `components/instructor/attendance-term.tsx`, import the component and render it at the end of the `AttendanceTerm` body, after the grid:

```tsx
      <AttendanceUpcoming programId={programId} />
```

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/instructor/attendance-upcoming.tsx components/instructor/attendance-term.tsx
git commit -m "$(cat <<'EOF'
The days still to come, and the one act that takes winter break out

Separate from the term grid because they answer different questions: the
grid is what happened, this is what is coming and whether it should be.
Removing is the only maintenance a schedule needs, so the per-day button and
the stretch dialog sit above the list with the printable sheet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: The day screen says when the code starts working

**Files:**
- Modify: `components/instructor/attendance-day.tsx`

- [ ] **Step 1: Give the start card the scheduled case**

In `StartCard`, replace the button row and the description so that a program with a schedule offers one action. Add a `hasSchedule` prop threaded from the grid payload (add `hasSchedule: boolean` to what `attendance.grid` returns, computed as `scheduleOf(program) !== null` with the four columns added to its program `select`).

```tsx
function StartCard({
  day,
  isToday,
  archived,
  hasSchedule,
  busy,
  onStart,
  onPrepare,
}: {
  day: string;
  isToday: boolean;
  archived: boolean;
  hasSchedule: boolean;
  busy: boolean;
  onStart: () => void;
  onPrepare: () => void;
}) {
  if (archived) {
    return (
      <EmptyState
        icon={<Clock />}
        title="This program has finished"
        description="Its attendance stays readable and exportable, but no new session can be started."
      />
    );
  }

  /*
    A scheduled program reaching this card means the day was removed, or it falls outside the
    program's dates. Either way there is one thing to do and it needs no choice: make the day, and
    it gets the clock the schedule would have given it.
  */
  if (hasSchedule) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">
            {formatSchoolDay(day)} is not a class day
          </span>
          <span className="text-xs text-muted-foreground">
            It was removed, or it falls outside the dates on the settings screen. Making it gives
            it the program&rsquo;s usual start time, and its code is ready at once.
          </span>
        </div>
        <Button size="sm" disabled={busy} onClick={onPrepare}>
          <KeyRound data-icon="inline-start" />
          Make a session for this day
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">No check-in yet for {formatSchoolDay(day)}</span>
        <span className="text-xs text-muted-foreground">
          {isToday
            ? "Starting it puts a code on the screen. Fellows check in with it until you end check-in, or for eight hours. Make the code first if you want to write it up before class — nobody can check in until you start."
            : "Starting it lets you record this day by hand. No code will be useful this long after the fact."}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isToday && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onPrepare}>
            <KeyRound data-icon="inline-start" />
            Make the code
          </Button>
        )}
        <Button size="sm" disabled={busy} onClick={onStart}>
          <Play data-icon="inline-start" />
          Start check-in
        </Button>
      </div>
    </div>
  );
}
```

Pass the day to `prepare` at the call site, so making a day that is not today works:

```tsx
          onPrepare={() => prepare.mutate({ programId, day })}
```

- [ ] **Step 2: Draw the scheduled session's card**

In `SessionHeader` at `components/instructor/attendance-day.tsx:353`, add a scheduled branch beside `pending`. Replace the `pending` constant at line 376:

```tsx
  const pending = session.state === "pending";
  const scheduled = session.state === "scheduled";
```

Where the card prints its times, add the scheduled case:

```tsx
            {scheduled && session.startedAt && session.endsAt && (
              <span className="text-xs text-muted-foreground">
                Check-in opens {formatSchoolTime(new Date(session.opensAt!))}, class starts{" "}
                {formatSchoolTime(new Date(session.startedAt))}, the code stops working{" "}
                {formatSchoolTime(new Date(session.endsAt))}. Nobody needs to press anything.
              </span>
            )}
```

Add `opensAt` to `publicSession`'s payload so the screen has it:

```ts
  // The `_pending_is_paired` CHECK is what makes these safe: any state but `pending` has both.
  const started = { startedAt: session.startedAt!, endsAt: session.endsAt! };
  return {
    ...common,
    state,
    ...started,
    /** When the code begins to work. Two hours before the start; null on a prepared day. */
    opensAt: opensAt({ ...started, endedAt: session.endedAt, lateAfterMinutes: session.lateAfterMinutes }),
  };
```

and `opensAt: null` in the pending branch.

Show the code card and the roster for a scheduled session as for an open one:

```tsx
      {(open || pending || scheduled) && <CodeCard sessionId={session.id} endsAt={session.endsAt} />}
```

and in the roster guard, `session.state !== "pending"` already admits `scheduled`, so the roster appears with everybody reading "Not checked in yet", which is true.

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/instructor/attendance-day.tsx trpc/routers/attendance.ts
git commit -m "$(cat <<'EOF'
A day that opens itself says when, and offers nothing to press

The card prints all three times — when check-in opens, when class starts,
when the code dies — which is what a scheduled day has and a prepared one
does not. A scheduled program reaching the empty card means the day was
removed, so it offers one action rather than a choice between two.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: The projector keeps the code on screen

**Files:**
- Modify: `components/instructor/attendance-display.tsx`

- [ ] **Step 1: Admit the scheduled state**

The branch at line 66 sends every state but `pending` and `open` to "Check-in is closed", which would take the code off the projector for the two hours before class — exactly when a room is filling and the code is most wanted. Replace it:

```tsx
  /*
    A prepared or scheduled session is handled before the closed branch, and the difference matters
    on a projector: the code is on screen and correct, but typing it would be refused. So the line
    under it says what the room needs to know rather than printing a closing time. This is the
    state a screen is likely to sit in while the room fills up.

    A scheduled day can say more than a prepared one, because it knows when the code starts
    working. Without this branch it would fall through to "Check-in is closed" and the projector
    would go blank for the two hours the code is most wanted.
  */
  const pending = view.session.state === "pending";
  const scheduled = view.session.state === "scheduled";

  if (!pending && !scheduled && view.session.state !== "open") {
```

Under the code, where the pending case prints its line, add:

```tsx
        {scheduled && view.session.opensAt && (
          <p className="text-[1.6vw] text-muted-foreground">
            Check-in opens at {formatSchoolTime(new Date(view.session.opensAt))}
          </p>
        )}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/instructor/attendance-display.tsx
git commit -m "$(cat <<'EOF'
The projector keeps the code up while the room fills

Without a branch for it, a scheduled day fell through to "check-in is
closed" and the screen went blank for the two hours before class — which is
exactly when a room wants the code. It says when check-in opens instead.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: What a fellow sees about a day still to come

**Files:**
- Modify: `components/student/attendance-calendar.tsx`
- Modify: `components/student/attendance-strip.tsx`
- Modify: `components/student/check-in-card.tsx`
- Modify: `trpc/routers/attendance.ts` (`myWeek`, `myHistory`, `today`)

- [ ] **Step 1: Give the payloads the upcoming flag**

In `myHistory`, replace the `summarySessions` mapping and add the flag to each day:

```ts
      const summarySessions = sessions.map((session) => {
        const state = sessionStateOf(session, now);
        return {
          id: session.id,
          day: schoolDayFromColumn(session.date),
          unsettled: state === "open" || state === "pending" || state === "scheduled",
        };
      });
```

In the `days` mapping, add:

```ts
            /** A day the program will meet that has not come. Drawn hollow, counted by nobody. */
            upcoming: sessionStateOf(session, now) === "scheduled",
            open: sessionStateOf(session, now) === "open",
```

Do the same in `myWeek`: add `upcoming` beside `open` on each day it returns, and use the three-state `unsettled` for the summarize input.

In `today`, the query already filters `startedAt: { not: null }`, which now admits scheduled days. Add the state to what it returns so the card can word itself; `publicSession` already carries it.

- [ ] **Step 2: Draw the square**

In `components/student/attendance-calendar.tsx`, add to `CalendarDay`:

```ts
  /**
   * A day the program will meet that has not come.
   *
   * Drawn hollow rather than blank, because a schedule's whole value to a fellow is being able to
   * see that next Tuesday is a class day. It is not an absence and not an open check-in, and
   * `kindOf` ranks it behind a status so an excusal set ahead of time still shows.
   */
  upcoming: boolean;
```

Pass it through to `kindOf`, replacing the `upcoming: false` Task 4 added.

Do the same in `components/student/attendance-strip.tsx`.

- [ ] **Step 3: Say when check-in opens**

In `components/student/check-in-card.tsx` and in the strip's row, where the code box renders on an open session, add the scheduled case:

```tsx
        {row.session?.state === "scheduled" && row.session.opensAt && (
          <span className="text-xs text-muted-foreground">
            Check-in opens at {formatSchoolTime(new Date(row.session.opensAt))}
          </span>
        )}
```

- [ ] **Step 4: Typecheck, test, lint**

```bash
npx tsc --noEmit && npm test && npm run test:integration && npm run lint
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add components/student trpc/routers/attendance.ts
git commit -m "$(cat <<'EOF'
A fellow can see that next Tuesday is a class day

The square is hollow rather than blank, because being able to see the week
ahead is most of what a schedule is worth to the person attending it. It
ranks behind a status, so an excusal set in advance still shows, and the row
says when check-in opens rather than offering a box that would refuse.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: The printable sheet of codes

**Files:**
- Create: `app/present/attendance/[programId]/codes/page.tsx`
- Create: `components/instructor/attendance-codes-sheet.tsx`

- [ ] **Step 1: Write the page**

It sits outside `app/(shell)/` for the reason the projector page does, and it is authorized the same way: the proxy keeps out anybody not signed in, and `attendance.upcoming` is instructor-gated, so a student who guesses the address is refused by the procedure. Create `app/present/attendance/[programId]/codes/page.tsx`:

```tsx
import { Suspense } from "react";

import { AttendanceCodesSheet } from "@/components/instructor/attendance-codes-sheet";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The fortnight of codes, on paper.
 *
 * **Outside `app/(shell)/`**, like the projector page beside it and for a related reason: what
 * comes out of a printer should be the sheet and nothing else — no sidebar, no breadcrumb, no
 * header band.
 *
 * Leaving the shell costs no authorization. `lib/supabase/proxy.ts` redirects every path except
 * `/`, `/login`, and `/auth`, and `attendance.upcoming` is instructor-gated behind that, so a
 * signed-in student who guesses the address is refused by the procedure rather than by the route.
 */
export default function PresentAttendanceCodesPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <Sheet params={params} />
    </Suspense>
  );
}

async function Sheet({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const queryClient = getQueryClient();

  const upcoming = await queryClient.fetchQuery(
    trpc.attendance.upcoming.queryOptions({ programId }),
  );

  return (
    <AttendanceCodesSheet
      programName={upcoming.program.name}
      term={upcoming.program.term}
      days={upcoming.days}
    />
  );
}
```

- [ ] **Step 2: Write the sheet**

Create `components/instructor/attendance-codes-sheet.tsx`:

```tsx
import { formatSchoolDay, formatSchoolTime } from "@/lib/school-time";

/**
 * A fortnight of codes, on paper, for whoever opens the building.
 *
 * **The reason the whole feature exists.** An instructor is not always in before the first fellow,
 * and the code has to be at the front desk anyway. This is the sheet that goes there.
 *
 * **Fourteen days, not the term.** A sheet of a hundred and ninety codes is one somebody keeps,
 * and a code kept is a code still being read out three months after the day it belonged to was
 * removed. Fourteen is a fortnight of cover and a sheet that gets replaced.
 *
 * Server-rendered and static: no polling, no clock, nothing that changes under somebody at a
 * printer. The warning at the top is the honest part — replacing a code or removing a day makes a
 * printed row wrong, and nothing here can know that has happened.
 */

const DAYS_ON_A_SHEET = 14;

type Day = {
  day: string;
  opensAt: Date | null;
  startedAt: Date | null;
  endsAt: Date | null;
  code: string;
};

export function AttendanceCodesSheet({
  programName,
  term,
  days,
}: {
  programName: string;
  term: string;
  days: Day[];
}) {
  const sheet = days.slice(0, DAYS_ON_A_SHEET);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-white p-10 text-black print:p-0">
      <header className="flex flex-col gap-1 border-b border-black/20 pb-4">
        <h1 className="text-2xl font-semibold">
          {programName} — check-in codes
        </h1>
        <p className="text-sm">{term}</p>
        <p className="text-sm">
          Give out <strong>today&rsquo;s code only</strong>. Each code works from two hours before
          class until eight hours after it starts, on its own day and no other. If an instructor
          replaces a code or removes a day, the row for that day on this sheet is wrong — ask them
          for a new sheet.
        </p>
      </header>

      {sheet.length === 0 ? (
        <p className="text-sm">
          This program has no days coming up. Set when it meets on its settings screen.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black/20">
              <th className="py-2 text-sm font-semibold">Day</th>
              <th className="py-2 text-sm font-semibold">Code</th>
              <th className="py-2 text-sm font-semibold">When it works</th>
            </tr>
          </thead>
          <tbody>
            {sheet.map((day) => (
              <tr key={day.day} className="border-b border-black/10">
                <td className="py-3 text-base">{formatSchoolDay(day.day)}</td>
                <td className="py-3 font-mono text-3xl font-bold tracking-[0.2em]">{day.code}</td>
                <td className="py-3 text-sm">
                  {day.opensAt && day.startedAt && day.endsAt
                    ? `${formatSchoolTime(day.opensAt)} to ${formatSchoolTime(day.endsAt)}, ` +
                      `class starts ${formatSchoolTime(day.startedAt)}`
                    : "Check-in has not been opened for this day"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck, build, lint**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: the build succeeds and the new route appears in its output.

- [ ] **Step 4: Commit**

```bash
git add app/present/attendance components/instructor/attendance-codes-sheet.tsx
git commit -m "$(cat <<'EOF'
A fortnight of codes on paper, for whoever opens the building

The sheet that goes to the front desk, which is the reason the feature
exists. Fourteen days rather than the term, because a sheet of a hundred and
ninety codes is one somebody keeps and reads out three months later, and it
says plainly that a replaced code makes its row wrong.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: The documentation stops saying attendance has no calendar

**Files:**
- Modify: `FEATURES.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Rewrite the attendance section of FEATURES.md**

Replace the bullet beginning "**Attendance knows nothing about a calendar.**" with:

```markdown
- **A program says when it meets, and the exceptions are removed.** A first day, a last day, the weekdays, and a start time make one session per meeting day from today onward, each with its code ready and its clock set: check-in opens two hours before class, lateness is measured from the start, and the code stops working eight hours later. Nobody presses anything. What this costs is that the dates have to be right — a spring break nobody removes is a week of mornings that open themselves, take no check-ins, and mark the whole roster absent. That shows up as a column of red on the term grid and is still removable afterwards, which takes the absences with it. A program with no schedule works as it always did: an instructor presses Start and the session measures from the press.
```

In the same section, replace the paragraph beginning "**One press at the start of the day**" so it describes both ways a day opens, and the paragraph about the fixed code so it says a day's code exists from the moment the day is made. Add after them:

```markdown
**The codes for the fortnight print on one sheet.** Reached from the attendance screen, it lists each coming day with its code and the hours it works, for the people who open the building before an instructor arrives. It says to give out today's code only, and that replacing a code or removing a day makes that row wrong.
```

- [ ] **Step 2: Remove the roadmap entry it delivers**

In `ROADMAP.md`, delete the bullet beginning "**Term dates, and a meeting pattern on a program.**" and replace the early-intervention bullet's reference to it if there is one. Do not add a note saying it was delivered; a roadmap lists what is still to do.

- [ ] **Step 3: Check nothing else still claims there is no calendar**

```bash
grep -rn "no term dates\|knows nothing about a calendar\|no timetable" --include=*.md --include=*.ts --include=*.tsx --include=*.prisma . | grep -v node_modules
```
Expected: no hits outside the spec. Fix any that remain, including the comment on `Program.term` in the schema, which should now read that term dates live in the four schedule columns and that `term` remains free text used for identity and naming.

- [ ] **Step 4: Commit**

```bash
git add FEATURES.md ROADMAP.md prisma/schema.prisma
git commit -m "$(cat <<'EOF'
Attendance has a calendar now, and the documentation says so

The feature list describes the schedule, the exceptions and what a forgotten
holiday costs. The roadmap entry that asked for term dates is gone rather
than annotated, because a roadmap lists what is still to do.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Run everything**

```bash
npm test
npm run test:integration
npm run lint
npx tsc --noEmit
npm run build
```
Expected: all green.

- [ ] **Confirm the secret never leaves**

```bash
npm run test:integration -- -t "codeSecret"
```
Expected: PASS. The existing `containsKey` checks must still hold against every payload, including `upcoming`, which returns a derived code and must not return the secret it came from.

- [ ] **Report to Ben what deploying it takes**

The migration adds four columns and two audit values, all additive. It can run before the code deploys, and a code rollback leaves harmless columns. The command is `npm run db:deploy:deployment`, and it is Ben's to run. No program changes behaviour until its schedule is saved.
