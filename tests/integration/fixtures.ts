/**
 * The rows a suite needs, made by the suite that needs them.
 *
 * **Why this exists.** The `verify:` scripts looked for a seeded course with the right shape and
 * stood down when they could not find one. That is how `verify:attendance` and `verify:team-sets`
 * came to measure nothing at all for weeks, and how `verify:dashboard` came to skip the three
 * cross-fellow checks its own header calls the point of the file. A fixture a test builds is a
 * fixture that is always there, always the same, and says in the test what it assumes.
 *
 * It is also what lets one suite run against either database: the development Supabase project, or
 * the disposable local one `npm run db:test:reset` builds from the migrations. Nothing here reads a
 * row it did not write.
 *
 * **Everything is written inside the caller's transaction and rolled back with it.** Nothing here
 * commits, so a suite leaves no trace on the development database — which is the property that
 * makes it safe to point at one somebody is using.
 *
 * **Accounts arrive the way real accounts arrive.** Identity belongs to Supabase, so a profile is
 * not inserted directly: a row goes into `auth.users` and the `on_auth_user_created` trigger makes
 * the profile. Raw SQL because Prisma treats that table as external and will not write it. Building
 * the profile by hand instead would test a path nobody uses and would miss the trigger breaking.
 */
import type { Prisma } from "@/lib/generated/prisma/client";

import { required, type Tx } from "./transaction";

/** Distinct every call, so nothing collides with a real row on the development database. */
const unique = () => crypto.randomUUID();

/**
 * An account, as one arrives: a row in `auth.users`, and the profile the trigger makes from it.
 *
 * Returns the profile id, which is the same uuid — `profiles.id` is a foreign key to
 * `auth.users.id` rather than a key of its own, so a person has one id everywhere.
 */
export async function makeAccount(
  tx: Tx,
  options: { role?: "STUDENT" | "INSTRUCTOR" | "ADMIN"; displayName?: string } = {},
): Promise<string> {
  const id = unique();
  const email = `integration-${id}@example.test`;

  await tx.$executeRawUnsafe(
    `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
             'authenticated', $2, now(), now(), $3::jsonb)`,
    id,
    email,
    JSON.stringify(options.displayName ? { display_name: options.displayName } : {}),
  );

  const profile = required(
    "a profile for the account just created — the on_auth_user_created trigger makes it, so its " +
      "absence means the trigger is missing from this database rather than anything about the test",
    await tx.profile.findUnique({ where: { id }, select: { id: true } }),
  );

  if (options.role && options.role !== "STUDENT") {
    await tx.profile.update({ where: { id: profile.id }, data: { role: options.role } });
  }

  return profile.id;
}

/** A program: the thing that owns a roster, its cohorts, its attendance and its instructors. */
export async function makeProgram(tx: Tx, options: { name?: string } = {}) {
  const suffix = unique().slice(0, 8);
  return tx.program.create({
    data: {
      name: options.name ?? `Integration Program ${suffix}`,
      term: `Cohort Integration ${suffix}`,
      joinToken: `integration-join-${unique()}`,
      instructorToken: `integration-inst-${unique()}`,
    },
    select: { id: true, name: true, term: true },
  });
}

/**
 * A course of a program.
 *
 * Published by default, because an unpublished course is refused to a fellow and most groups want
 * one their fixture student can actually read. `published: false` is for the checks about what
 * publication keeps out.
 */
export async function makeCourse(
  tx: Tx,
  options: { programId: string; published?: boolean; name?: string },
) {
  const suffix = unique().slice(0, 8);
  return tx.course.create({
    data: {
      programId: options.programId,
      name: options.name ?? `Integration Course ${suffix}`,
      slug: `integration-${suffix}`,
      publishedAt: options.published === false ? null : new Date("2026-01-01T00:00:00Z"),
    },
    select: { id: true, name: true, slug: true },
  });
}

/** A unit of a course, at the end of its sequence unless placed. */
export async function makeUnit(
  tx: Tx,
  options: { courseId: string; name?: string; position?: number },
) {
  const position =
    options.position ??
    (await tx.courseUnit.count({ where: { courseId: options.courseId } }));

  return tx.courseUnit.create({
    data: {
      courseId: options.courseId,
      name: options.name ?? `Mod ${position} - Integration Unit ${unique().slice(0, 6)}`,
      position,
    },
    select: { id: true, name: true, position: true },
  });
}

/**
 * Somebody on a program's roster.
 *
 * The enrollment is what makes a person a student of every course of the program, so this is the
 * row every student-facing check actually depends on — not the STUDENT role.
 */
export async function enroll(
  tx: Tx,
  options: { programId: string; studentId: string; status?: "ACTIVE" | "REMOVED" },
) {
  return tx.enrollment.create({
    data: {
      programId: options.programId,
      studentId: options.studentId,
      status: options.status ?? "ACTIVE",
    },
    select: { id: true, studentId: true, programId: true },
  });
}

/**
 * An instructor of a program, and of one of its courses.
 *
 * Both rows, because `CourseInstructor` has a composite foreign key onto `ProgramInstructor`: there
 * is no such thing as teaching a course of a program you are not an instructor of, and Postgres
 * refuses to record one. Writing only the course row is the mistake this helper exists to prevent.
 */
export async function addInstructor(
  tx: Tx,
  options: { programId: string; userId: string; courseId?: string; isPrimary?: boolean },
) {
  const program = await tx.programInstructor.create({
    data: {
      programId: options.programId,
      userId: options.userId,
      isPrimary: options.isPrimary ?? false,
    },
    select: { id: true },
  });

  if (options.courseId) {
    await tx.courseInstructor.create({
      data: {
        courseId: options.courseId,
        programId: options.programId,
        userId: options.userId,
      },
      select: { id: true },
    });
  }

  return program;
}

/**
 * A piece of work.
 *
 * Published by default and self-directed with a link, which is the kind that needs no repository,
 * no sandbox and no model call — the difference between the kinds is *where the work is*, and that
 * is the part a rolled-back transaction can say nothing about anyway.
 */
export async function makeAssignment(
  tx: Tx,
  options: {
    courseId: string;
    courseUnitId: string;
    title?: string;
    kind?: "REPO" | "SELF_DIRECTED" | "TASK";
    dueAt?: Date | null;
    published?: boolean;
    pointValue?: number;
    sections?: Prisma.InputJsonValue;
    teamSetId?: string | null;
    studentMayMarkDone?: boolean;
  },
) {
  const kind = options.kind ?? "SELF_DIRECTED";
  const pointValue = options.pointValue ?? 10;

  return tx.assignment.create({
    data: {
      courseId: options.courseId,
      courseUnitId: options.courseUnitId,
      title: options.title ?? `Integration Assignment ${unique().slice(0, 6)}`,
      kind,
      handInMethods: kind === "SELF_DIRECTED" ? ["LINK"] : [],
      pointValue: kind === "TASK" ? 1 : pointValue,
      completionThreshold: 0.75,
      dueAt: options.dueAt === undefined ? new Date("2026-10-01T00:00:00Z") : options.dueAt,
      distributedAt: options.published === false ? null : new Date("2026-01-02T09:00:00Z"),
      sections:
        options.sections ??
        (kind === "TASK" ? [] : [{ grading: "manual", label: "Overall", pointValue }]),
      teamSetId: options.teamSetId ?? null,
      studentMayMarkDone: options.studentMayMarkDone ?? (kind === "TASK" ? true : null),
    },
    select: { id: true, title: true, dueAt: true },
  });
}

/**
 * A submission in whatever state the group needs.
 *
 * `graded` fills in every column a released grade writes, because the checks that read one read
 * several — a row with a score and no `gradedAt` is not a state approval can produce, and a fixture
 * that produced it would fail a correct `feedbackIsUnread`.
 */
export async function makeSubmission(
  tx: Tx,
  options: {
    assignmentId: string;
    studentId: string;
    status?: "NOT_STARTED" | "ACCEPTED" | "SUBMITTED" | "GRADED" | "RESUBMITTED";
    graded?: { score: number; possible: number; isComplete: boolean; reviewed?: boolean };
    submittedAt?: Date | null;
  },
) {
  const graded = options.graded;
  const gradedAt = graded ? new Date("2026-02-01T12:00:00Z") : null;

  return tx.submission.create({
    data: {
      assignmentId: options.assignmentId,
      studentId: options.studentId,
      status: options.status ?? (graded ? "GRADED" : "SUBMITTED"),
      submittedAt:
        options.submittedAt === undefined ? new Date("2026-01-20T10:00:00Z") : options.submittedAt,
      lastActivityAt: new Date("2026-01-20T10:00:00Z"),
      finalScore: graded?.score ?? null,
      finalScorePossible: graded?.possible ?? null,
      isComplete: graded?.isComplete ?? null,
      feedbackMarkdown: graded ? "Integration fixture feedback." : null,
      gradedById: graded ? options.studentId : null,
      gradedAt,
      /*
        Left unread unless asked. `feedbackIsUnread` compares this against `gradedAt` rather than
        checking for null, so "read" means a timestamp after the grade — which is what a second
        round of grading makes stale again.
      */
      feedbackReviewedAt:
        graded && options.graded?.reviewed ? new Date("2026-02-02T12:00:00Z") : null,
    },
    select: {
      id: true,
      studentId: true,
      status: true,
      finalScore: true,
      isComplete: true,
      gradedAt: true,
      feedbackReviewedAt: true,
    },
  });
}

/** What {@link makeWorld} hands back. */
export type World = {
  programId: string;
  courseId: string;
  unitId: string;
  instructorId: string;
  /** Everyone on the roster, in the order they were created. */
  students: { id: string; studentId: string; programId: string }[];
  /** The first of them, which is what most groups mean by "the fellow". */
  student: { id: string; studentId: string; programId: string };
};

/**
 * A program with a course, a unit, an instructor and however many fellows are asked for.
 *
 * The shape nearly every group starts from, in one call, so that a suite's own `beforeAll` is about
 * what makes that suite different rather than about rebuilding this. Ask for the fellows the checks
 * need: two is what "one fellow is unaffected by what another does" requires, and three is what
 * makes an even distribution across teams uneven.
 */
export async function makeWorld(
  tx: Tx,
  options: { students?: number; published?: boolean } = {},
): Promise<World> {
  const program = await makeProgram(tx);
  const course = await makeCourse(tx, {
    programId: program.id,
    published: options.published,
  });
  const unit = await makeUnit(tx, { courseId: course.id });

  const instructorId = await makeAccount(tx, { role: "INSTRUCTOR" });
  await addInstructor(tx, {
    programId: program.id,
    userId: instructorId,
    courseId: course.id,
    isPrimary: true,
  });

  const students = [];
  for (let index = 0; index < (options.students ?? 1); index += 1) {
    const studentId = await makeAccount(tx);
    students.push(await enroll(tx, { programId: program.id, studentId }));
  }

  return {
    programId: program.id,
    courseId: course.id,
    unitId: unit.id,
    instructorId,
    students,
    student: students[0]!,
  };
}
