/**
 * Thirty fake fellows, a six-week schedule around today, and a term's worth of their attendance,
 * hand-ins and check answers — so the roster, gradebook, attendance and performance screens can be
 * read at the size of a real cohort on the development database.
 *
 * **A fake fellow is not a test student.** A test student is excluded from every figure, because it
 * exists to preview a course. A fake fellow exists to be measured: `testStudentNumber` stays null,
 * so every screen counts them exactly as it counts a real person. What makes them fake is the
 * address, `fake-fellow-N@fake.invalid` — `.invalid` is reserved by RFC 2606 and can never receive
 * mail, so nobody can sign in as one — and the absence of a GitHub username, so nothing ever
 * creates a repository or calls GitHub for them. Every fake fellow can be found by that domain.
 *
 * **Every outcome is decided by a hash, not a random number.** Whether fellow 12 was late on 14
 * October is a function of "12", "2026-10-14", and whether that day falls in the fortnight before
 * the run — the one input that moves. Every write below skips rows that already exist, so a second
 * run adds only what has newly come due: days that have since passed, and assignments whose
 * deadlines have. A slipping fellow struggles on every day that was recent when it was written, so
 * a seed run every week or so keeps them slipping, and one run after a long gap leaves them
 * struggling for the whole gap.
 *
 * **It creates; it does not modify**, like the rest of the seed, with one exception: the program's
 * schedule, which is moved to the six weeks around the day the seed runs. That is the point of it:
 * a schedule fixed in September is a program whose recent fortnight is empty by November.
 */
import { randomUUID } from "node:crypto";

import { TASK_POINT_VALUE } from "../lib/assignments/spec";
import { newSessionSecret } from "../lib/attendance/code";
import { meetingDaysBetween, meetsOn, scheduleOf, type Schedule } from "../lib/attendance/schedule";
import { defaultEndsAt } from "../lib/attendance/window";
import {
  addSchoolDays,
  dateColumnFor,
  instantAtSchoolClock,
  schoolDayFromColumn,
  schoolDayOf,
  weekdayOf,
} from "../lib/school-time";
import { CheckLevel, Prisma, type PrismaClient } from "../lib/generated/prisma/client";

/**
 * The fellows, in the order they are numbered.
 *
 * Several names have three or four parts, because fellows here commonly do and a name that long is
 * what the frozen name column has to cope with.
 */
const NAMES = [
  "Amara Okafor",
  "Luis Fernando Castillo Rivera",
  "Jasmine Wu",
  "Kwame Mensah",
  "Sofia Isabel Martínez",
  "Darnell Brooks",
  "Priya Raghunathan",
  "Mohammed Al-Hassan",
  "Grace Kim",
  "Tyrone Jackson",
  "Valentina Rosa Herrera Gómez",
  "Ethan Liu",
  "Fatoumata Diallo",
  "Marcus Williams",
  "Aaliyah Johnson",
  "José Manuel Rodríguez",
  "Nia Thompson",
  "Kenji Watanabe",
  "Destiny Moore",
  "Abdoulaye Traoré",
  "Isabella Cruz",
  "Jamal Robinson",
  "Mei Ling Chen",
  "Andre Baptiste",
  "Esperanza Lucía Morales Vega",
  "Tariq Hussain",
  "Keisha Davis",
  "Samuel Owusu-Ansah",
  "Camila Reyes",
  "DeShawn Carter",
];

/**
 * How a fellow behaves, as chances.
 *
 * `slipping` is the one pattern that changes over time: steady until the last two weeks and
 * struggling within them, which is what puts a fellow with a good term figure into Needs support
 * on a recent window alone.
 */
type Habits = {
  absent: number;
  late: number;
  excused: number;
  handIn: number;
  onTime: number;
  complete: number;
  answersChecks: number;
};

const STRONG: Habits = {
  absent: 0.02,
  late: 0.03,
  excused: 0.01,
  handIn: 0.98,
  onTime: 0.95,
  complete: 0.95,
  answersChecks: 0.95,
};
const STEADY: Habits = {
  absent: 0.05,
  late: 0.08,
  excused: 0.03,
  handIn: 0.9,
  onTime: 0.85,
  complete: 0.85,
  answersChecks: 0.85,
};
const STRUGGLING: Habits = {
  absent: 0.18,
  late: 0.15,
  excused: 0.05,
  handIn: 0.6,
  onTime: 0.6,
  complete: 0.6,
  answersChecks: 0.5,
};

type Pattern = "strong" | "steady" | "slipping" | "struggling";

/** Eight strong, ten steady, six slipping, six struggling — so every performance group has rows. */
function patternOf(n: number): Pattern {
  if (n <= 8) return "strong";
  if (n <= 18) return "steady";
  if (n <= 24) return "slipping";
  return "struggling";
}

function habitsOf(pattern: Pattern, recent: boolean): Habits {
  if (pattern === "strong") return STRONG;
  if (pattern === "steady") return STEADY;
  if (pattern === "slipping") return recent ? STRUGGLING : STEADY;
  return STRUGGLING;
}

/**
 * A number from 0 up to 1, fixed for its inputs. FNV-1a over the joined parts, then the 32-bit
 * finalizer from MurmurHash3, because FNV alone gives nearly equal answers for keys that differ
 * only in their last character — fellow 12 and fellow 13 would be late on the same days.
 */
function chance(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const character of parts.join(":")) {
    h ^= character.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const EXCUSE_NOTES = [
  "Doctor's appointment",
  "Family emergency",
  "Court date",
  "Sick, emailed ahead",
];

const CHECK_ANSWER =
  "I think it works because each step builds on the one before it, so if I change the input the " +
  "output changes the same way. I am less sure what happens when the list is empty.";

type SeedProgram = {
  id: string;
  attendanceStartsOn: Date | null;
  attendanceEndsOn: Date | null;
  attendanceWeekdays: number[];
  attendanceStartsAt: string | null;
  attendanceLateAfterMinutes: number;
};

export async function seedFakeFellows(
  prisma: PrismaClient,
  { program, instructorId }: { program: SeedProgram; instructorId: string },
) {
  const now = new Date();
  const today = schoolDayOf(now);
  const recentFrom = addSchoolDays(today, -13);

  /*
    ---- Schedule -----------------------------------------------------------

    Six weeks: the four before this one, this one, and the next. Monday to Friday of those weeks,
    so the window always opens on a Monday and closes on a Friday whatever day the seed runs. The
    weeks behind today are what the screens measure; the week ahead keeps the program in progress.

    The weekdays and the start time are kept from the program's current schedule where it has one,
    because only the dates are what has gone stale.
  */
  const previous = scheduleOf(program);
  const monday = addSchoolDays(today, -((weekdayOf(today) + 6) % 7));
  const schedule: Schedule = {
    startsOn: addSchoolDays(monday, -28),
    endsOn: addSchoolDays(monday, 11),
    weekdays: previous?.weekdays ?? [1, 2, 3, 4, 5],
    startsAt: previous?.startsAt ?? "09:30",
  };

  await prisma.program.update({
    where: { id: program.id },
    data: {
      attendanceStartsOn: dateColumnFor(schedule.startsOn),
      attendanceEndsOn: dateColumnFor(schedule.endsOn),
      attendanceWeekdays: schedule.weekdays,
      attendanceStartsAt: schedule.startsAt,
    },
  });

  /*
    One session per meeting day, made the way saving a schedule makes them — with one difference:
    past days are made too, because they are what the fellows' attendance is written against.

    **A day the previous schedule already met on is left alone**, which is `scheduleDiff`'s rule:
    if it has a session that session stands, and if it has none an instructor removed it as a
    holiday, and recreating it would undo that.

    **Left open, as the schedule leaves every day it makes.** A past day is settled by its backstop
    alone, and the sweep the next Start runs writes an absence for every other fellow without a
    record — the seeded student and any test student — which is what the application would have
    written for a real day nobody closed.
  */
  const newDays = meetingDaysBetween(schedule, schedule.startsOn, schedule.endsOn).filter(
    (day) => previous === null || !meetsOn(previous, day),
  );
  const made = await prisma.attendanceSession.createMany({
    data: newDays.map((day) => {
      const startedAt = instantAtSchoolClock(day, schedule.startsAt);
      return {
        programId: program.id,
        date: dateColumnFor(day),
        startedAt,
        endsAt: defaultEndsAt(startedAt),
        lateAfterMinutes: program.attendanceLateAfterMinutes,
        codeSecret: newSessionSecret(),
        startedById: null,
      };
    }),
    skipDuplicates: true,
  });
  console.log(
    `Schedule: ${schedule.startsOn} to ${schedule.endsOn}, ${made.count} new attendance days`,
  );

  // ---- Cohorts ------------------------------------------------------------
  // The program's own two where it has them, so the fake fellows sit beside the real ones.
  let cohorts = await prisma.cohort.findMany({
    where: { programId: program.id },
    orderBy: { name: "asc" },
    select: { id: true },
    take: 2,
  });
  if (cohorts.length < 2) {
    for (const name of ["A", "B"]) {
      await prisma.cohort.upsert({
        where: { programId_name: { programId: program.id, name } },
        create: { programId: program.id, name },
        update: {},
      });
    }
    cohorts = await prisma.cohort.findMany({
      where: { programId: program.id, name: { in: ["A", "B"] } },
      orderBy: { name: "asc" },
      select: { id: true },
    });
  }

  // ---- Fellows ------------------------------------------------------------
  const fellows: { n: number; studentId: string; enrollmentId: string; pattern: Pattern }[] = [];

  for (const [index, name] of NAMES.entries()) {
    const n = index + 1;
    const email = `fake-fellow-${n}@fake.invalid`;

    let profile = await prisma.profile.findUnique({ where: { email }, select: { id: true } });

    if (!profile) {
      /*
        An account arrives as a row in `auth.users`, and the `on_auth_user_created` trigger makes
        the profile from it — the route `tests/integration/fixtures.ts` takes, for the same reason:
        Prisma will not write that table. No password and an undeliverable address, so nobody can
        sign in as one.

        The four token columns are written as empty strings rather than left null. Supabase's auth
        server reads them as plain strings and fails on a null, which takes the dashboard's list of
        users down with it.
      */
      const id = randomUUID();
      await prisma.$executeRaw`
        insert into auth.users (
          id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at,
          confirmation_token, recovery_token, email_change_token_new, email_change
        ) values (
          ${id}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          ${email}, '{"provider":"email","providers":["email"]}'::jsonb,
          ${JSON.stringify({ display_name: name })}::jsonb,
          now(), now(), '', '', '', ''
        )`;
      profile = { id };
    }

    /*
      Enrolled on the schedule's first day, because a fellow is measured only from the day they
      joined — written as of today, every day of the window would be before their enrollment and
      their attendance would count for nothing.
    */
    const enrollment = await prisma.enrollment.upsert({
      where: { programId_studentId: { programId: program.id, studentId: profile.id } },
      create: {
        programId: program.id,
        studentId: profile.id,
        cohortId: cohorts[index % cohorts.length]?.id ?? null,
        status: "ACTIVE",
        createdAt: instantAtSchoolClock(schedule.startsOn, "08:00"),
      },
      update: {},
      select: { id: true },
    });

    fellows.push({ n, studentId: profile.id, enrollmentId: enrollment.id, pattern: patternOf(n) });
  }
  console.log(`Fake fellows: ${fellows.length}, as fake-fellow-N@fake.invalid`);

  /*
    ---- Attendance ---------------------------------------------------------

    Every day of the window that has already happened, which is every session the screens treat
    as settled. A fellow who was there checked themselves in, at a time either side of the start
    for PRESENT and after the grace period for LATE. An absence is what the sweep writes; an
    excused one is what an instructor writes, with the reason they were given.
  */
  const sessions = await prisma.attendanceSession.findMany({
    where: {
      programId: program.id,
      date: { gte: dateColumnFor(schedule.startsOn), lt: dateColumnFor(today) },
      startedAt: { not: null },
    },
    select: { id: true, date: true, startedAt: true, lateAfterMinutes: true },
  });

  const records: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (const session of sessions) {
    const day = schoolDayFromColumn(session.date);
    const startedAt = session.startedAt!;

    for (const fellow of fellows) {
      const habits = habitsOf(fellow.pattern, day >= recentFrom);
      const roll = chance(fellow.n, day, "attendance");
      const base = {
        sessionId: session.id,
        programId: program.id,
        enrollmentId: fellow.enrollmentId,
      };

      if (roll < habits.absent) {
        records.push({ ...base, status: "ABSENT", source: "FINALIZED" });
      } else if (roll < habits.absent + habits.excused) {
        records.push({
          ...base,
          status: "EXCUSED",
          source: "INSTRUCTOR",
          recordedById: instructorId,
          note: EXCUSE_NOTES[Math.floor(chance(fellow.n, day, "note") * EXCUSE_NOTES.length)],
        });
      } else if (roll < habits.absent + habits.excused + habits.late) {
        const minutes = session.lateAfterMinutes + 1 + Math.floor(chance(fellow.n, day, "at") * 40);
        records.push({
          ...base,
          status: "LATE",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date(startedAt.getTime() + minutes * MINUTE),
        });
      } else {
        const span = 20 + session.lateAfterMinutes;
        const minutes = -20 + Math.floor(chance(fellow.n, day, "at") * (span + 1));
        records.push({
          ...base,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date(startedAt.getTime() + minutes * MINUTE),
        });
      }
    }
  }
  const recorded = await prisma.attendanceRecord.createMany({
    data: records,
    skipDuplicates: true,
  });

  /*
    A day the sweep reached before the seed did. The days are left open, so a Start between two
    runs writes an absence for every fake fellow on each day that has passed since the first — and
    `skipDuplicates` would then keep those absences over what the seed decided. A swept absence
    is the only record a fake fellow can hold that nobody chose, so it is the one record the seed
    restates. Nothing a person wrote is touched, and nothing is deleted.
  */
  const decided = new Map(
    records.map((record) => [`${record.sessionId}:${record.enrollmentId}`, record]),
  );
  const swept = await prisma.attendanceRecord.findMany({
    where: {
      source: "FINALIZED",
      sessionId: { in: sessions.map((session) => session.id) },
      enrollmentId: { in: fellows.map((fellow) => fellow.enrollmentId) },
    },
    select: { id: true, sessionId: true, enrollmentId: true },
  });
  let restated = 0;
  for (const row of swept) {
    const record = decided.get(`${row.sessionId}:${row.enrollmentId}`);
    if (!record || record.source === "FINALIZED") continue;
    await prisma.attendanceRecord.update({
      where: { id: row.id },
      data: {
        status: record.status,
        source: record.source,
        checkedInAt: record.checkedInAt ?? null,
        recordedById: record.recordedById ?? null,
        note: record.note ?? null,
      },
    });
    restated += 1;
  }
  console.log(
    `Attendance: ${recorded.count} new records over ${sessions.length} past days` +
      (restated > 0 ? `, ${restated} swept absences restated` : ""),
  );

  /*
    ---- Submissions --------------------------------------------------------

    Every released assignment whose deadline has passed, in the program's published courses. A
    fellow who did not hand one in has no row, which is what missing is.

    Team assignments are skipped: their rows belong to a team, and inventing teams is a different
    seed. A repository assignment is only ever written graded, never waiting, because opening an
    ungraded one goes looking for a pull request that does not exist.
  */
  const assignments = await prisma.assignment.findMany({
    where: {
      course: { programId: program.id, publishedAt: { not: null } },
      distributedAt: { not: null },
      dueAt: { lt: now },
      teamSetId: null,
    },
    select: {
      id: true,
      kind: true,
      handInMethods: true,
      dueAt: true,
      distributedAt: true,
      pointValue: true,
      completionThreshold: true,
    },
  });

  const submissions: Prisma.SubmissionCreateManyInput[] = [];
  for (const assignment of assignments) {
    const dueAt = assignment.dueAt!;
    const recent = schoolDayOf(dueAt) >= recentFrom;

    for (const fellow of fellows) {
      const habits = habitsOf(fellow.pattern, recent);
      if (chance(fellow.n, assignment.id, "hand-in") >= habits.handIn) continue;

      const onTime = chance(fellow.n, assignment.id, "on-time") < habits.onTime;
      const offset = chance(fellow.n, assignment.id, "when");
      // Never before the work was released, and never in the future.
      const submittedAt = new Date(
        Math.min(
          now.getTime() - HOUR,
          onTime
            ? Math.max(
                assignment.distributedAt!.getTime() + HOUR,
                dueAt.getTime() - (1 + Math.floor(offset * 72)) * HOUR,
              )
            : dueAt.getTime() + (2 + Math.floor(offset * 94)) * HOUR,
        ),
      );
      const gradedAt = new Date(
        Math.min(now.getTime(), submittedAt.getTime() + (24 + Math.floor(offset * 48)) * HOUR),
      );
      const base = {
        assignmentId: assignment.id,
        studentId: fellow.studentId,
        submittedAt,
        lastActivityAt: submittedAt,
      };
      const completeRoll = chance(fellow.n, assignment.id, "complete");

      // A task is marked done or not done, worth one point, the way `taskVerdict` writes it.
      if (assignment.kind === "TASK") {
        const done = completeRoll < habits.complete;
        submissions.push({
          ...base,
          status: "GRADED",
          finalScore: done ? TASK_POINT_VALUE : 0,
          finalScorePossible: TASK_POINT_VALUE,
          isComplete: done,
          gradedById: instructorId,
          gradedAt,
        });
        continue;
      }

      // Some of the last week's hand-ins are still waiting, so the grading pile has something in it.
      const waiting =
        assignment.kind !== "REPO" &&
        now.getTime() - dueAt.getTime() < 7 * 24 * HOUR &&
        chance(fellow.n, assignment.id, "waiting") < 0.4;
      if (waiting) {
        submissions.push({ ...base, status: "SUBMITTED" });
        continue;
      }

      /*
        A score on the right side of the passing line, and `isComplete` read back from the score
        rather than from the roll, so the two cannot disagree the way they could if each were
        chosen separately.
      */
      const possible = assignment.pointValue;
      const passing = Math.ceil(possible * assignment.completionThreshold);
      const spread = chance(fellow.n, assignment.id, "score");
      const score =
        completeRoll < habits.complete
          ? passing + Math.floor(spread * (possible - passing + 1))
          : Math.floor(spread * passing);
      submissions.push({
        ...base,
        status: "GRADED",
        finalScore: score,
        finalScorePossible: possible,
        isComplete: possible > 0 && score / possible >= assignment.completionThreshold,
        gradedById: instructorId,
        gradedAt,
      });
    }
  }
  const handedIn = await prisma.submission.createMany({ data: submissions, skipDuplicates: true });
  console.log(
    `Submissions: ${handedIn.count} new across ${assignments.length} past-due assignments`,
  );

  /*
    The link each hand-in carries, on the kinds handed in as one: a Google Doc, and self-directed
    work that takes a link. Without it an instructor opening the work finds nothing to read. The
    address is example.com, which can never be anybody's real work. A self-directed assignment
    taken only as a file gets nothing, because an upload needs a real object in storage.

    Read back rather than written with the submissions above, because `createMany` returns no ids,
    and limited to hand-ins with no artifact yet, so a second run adds none.
  */
  const linked = assignments
    .filter(
      (assignment) =>
        assignment.kind === "GOOGLE_DRIVE" ||
        (assignment.kind === "SELF_DIRECTED" && assignment.handInMethods.includes("LINK")),
    )
    .map((assignment) => assignment.id);
  const bare = await prisma.submission.findMany({
    where: {
      assignmentId: { in: linked },
      studentId: { in: fellows.map((fellow) => fellow.studentId) },
      submittedAt: { not: null },
      artifacts: { none: {} },
    },
    select: { id: true, assignmentId: true, studentId: true, submittedAt: true },
  });
  const numberOf = new Map(fellows.map((fellow) => [fellow.studentId, fellow.n]));
  const links = await prisma.submissionArtifact.createMany({
    data: bare.map((submission) => ({
      submissionId: submission.id,
      kind: "LINK" as const,
      url: `https://example.com/fake-fellow-${numberOf.get(submission.studentId)}/${submission.assignmentId}`,
      createdAt: submission.submittedAt!,
    })),
  });
  console.log(`Hand-in links: ${links.count} new`);

  // ---- Checks for understanding --------------------------------------------
  const checks = await prisma.checkForUnderstanding.findMany({
    where: {
      resource: { courseUnit: { course: { programId: program.id, publishedAt: { not: null } } } },
    },
    select: { id: true, createdAt: true },
  });

  const LEVELS: Record<Pattern, CheckLevel[]> = {
    strong: [CheckLevel.RELATIONAL, CheckLevel.EXTENDED_ABSTRACT],
    steady: [CheckLevel.MULTISTRUCTURAL, CheckLevel.RELATIONAL],
    slipping: [CheckLevel.UNISTRUCTURAL, CheckLevel.MULTISTRUCTURAL],
    struggling: [CheckLevel.BLOCKED, CheckLevel.UNISTRUCTURAL],
  };

  const attempts: Prisma.CheckAttemptCreateManyInput[] = [];
  for (const check of checks) {
    for (const fellow of fellows) {
      const habits = habitsOf(fellow.pattern, false);
      if (chance(fellow.n, check.id, "answers") >= habits.answersChecks) continue;

      const levels = LEVELS[fellow.pattern];
      const after = Math.floor(chance(fellow.n, check.id, "when") * 72) * HOUR;
      attempts.push({
        checkId: check.id,
        studentId: fellow.studentId,
        attempt: 1,
        answer: CHECK_ANSWER,
        level: levels[Math.floor(chance(fellow.n, check.id, "level") * levels.length)],
        submittedAt: new Date(Math.min(now.getTime(), check.createdAt.getTime() + HOUR + after)),
      });
    }
  }
  const answered = await prisma.checkAttempt.createMany({ data: attempts, skipDuplicates: true });
  console.log(`Check answers: ${answered.count} new across ${checks.length} checks`);
}
