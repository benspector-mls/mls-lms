/**
 * Bootstraps an empty database. **It creates; it does not modify.**
 *
 * Creates: the four rubrics that exist in grading-toolkit/rubric.md, one course, its modules, one
 * instructor, one enrolled student, and one assignment whose `sections` mapping points at real
 * files in the answer-keys repository.
 *
 * ## The rule, and why it is stricter than it used to be
 *
 * This began as the only way to get data into the application, so it asserted the shape it
 * describes on every run — module names, assignment fields, enrollment status, roles. Every one of
 * those is now something an instructor sets through the interface, and each reassertion was a
 * silent revert of a real decision. All three happened on the development database:
 *
 * - A renamed module was **recreated** under its seeded name, leaving an empty duplicate beside
 *   the real one, which a course copied from it then inherited.
 * - A removed student would have been **put back** into the cohort.
 * - An edited assignment would have had its title, points, and rubric **reverted**.
 *
 * So: existing rows are left alone. Roles are raised and never lowered. The one exception is
 * rubrics, which no router can author — see the comment at the top of `main`.
 *
 * **Modules are found by name, then by ordinal.** They were found by their `position` column,
 * which broke once a project could sit in the same sequence: "the module at position 2" found a
 * project there, concluded the module was missing, and created a second copy of one the course
 * already had — at a slot another unit occupied, corrupting the ordering as well as duplicating
 * the row. Matching on name alone is no better on its own, because the seeded names are
 * placeholders most courses have renamed, and every one of them would get a duplicate.
 *
 * So both, in that order, against a list of the course's modules *only*. A course this script set
 * up matches by name; a course that renamed its modules matches by ordinal; and a course with
 * fewer modules than the seed expects gets a new one appended, never dropped into a slot
 * something else holds.
 *
 * The cost, stated rather than discovered: a corrected spec does not reach a row that already
 * exists. Edit it in the application, or delete the row and run this again.
 *
 * This script does NOT create auth users. Identity is owned by Supabase Auth, so both profiles
 * must already exist from a real login. It looks them up by email and fails with an explanation if
 * they are absent.
 *
 * Run with: npm run db:seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";

import { AssignmentKind, parseAssignmentSpec } from "../lib/assignments/spec";
import { suggestCourseSlug } from "../lib/courses/course-slug";
import { newJoinToken } from "../lib/courses/join-token";
import { END_OF_DAY, instantAtSchoolClock, schoolDayOf } from "../lib/school-time";
import {
  PrismaClient,
  Prisma,
  Role,
  EnrollmentStatus,
  RubricScaleType,
} from "../lib/generated/prisma/client";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

/**
 * The student account must have a GitHub identity linked, because accepting an
 * assignment creates a repository named after their GitHub login and adds them
 * as a collaborator. Of the two existing accounts, ben@marcylabschool.org is the
 * one with GitHub linked, so it is the default student. Override with env vars
 * if you link GitHub to the other account.
 */
const INSTRUCTOR_EMAIL = process.env.SEED_INSTRUCTOR_EMAIL ?? "benj.spector@gmail.com";
const STUDENT_EMAIL = process.env.SEED_STUDENT_EMAIL ?? "ben@marcylabschool.org";

/** Use the sandbox organization, never the production one, until verified. */
const GITHUB_ORG = process.env.SEED_GITHUB_ORG ?? "marcy-lms";
const TEMPLATE_REPO = process.env.SEED_TEMPLATE_REPO
  ? `${GITHUB_ORG}/${process.env.SEED_TEMPLATE_REPO}`
  : `${GITHUB_ORG}/swe-1-4-loops`;

/**
 * The repository name is the template repository's name, so a student's
 * repository is `{courseSlug}-{assignmentRepoName}-{their github login}`. Derived rather than
 * written out separately, because the two must always agree: if they disagree,
 * `accept` creates a repository from one template and names it after another.
 */
const ASSIGNMENT_REPO_NAME = TEMPLATE_REPO.split("/")[1];

/**
 * The one assignment this bootstraps, and what it contains.
 *
 * **A bootstrap, not a registry.** This map held three assignments and read as a partial
 * curriculum: their point values, their answer-key directories, and the reasoning behind each
 * one, maintained by hand in a seed script. All of that is now authored in the application —
 * an instructor creates an assignment, names its template and answer keys, and enters its
 * sections against a validated form — so a second and third entry here were two more copies of
 * facts with a real home, kept in step by nobody.
 *
 * What remains is the minimum that produces a working local database: one assignment with a
 * runnable suite, so the whole pipeline can be exercised on a fresh checkout before anything has
 * been authored. It is a `Record` rather than a single object because `SEED_TEMPLATE_REPO` still
 * chooses, and a set of one is the honest shape of a chooser with one choice.
 *
 * `answerKeyDir` is the directory holding the module's answer keys; the assignment's own folder
 * inside it is named after the template repository, which is where every file is the reference
 * set.
 */
type SeedAssignment = {
  answerKeyDir: string;
  /** Names an entry in lib/sandbox/presets.ts. "none" means no runnable tests. */
  runnerPreset: string;
  /**
   * Shallow override merged over the named preset, for the exceptions. The one entry below
   * does not use it; the SQL preset will, once it needs its own E2B template.
   *
   * Present because the column is, and because the authoring form offers it — so the seeded
   * assignment has to be able to carry one for the round trip to be the real one. Reach for it
   * only when an assignment needs something different about the *environment*: a template with
   * PostgreSQL installed, a longer timeout. When a test asserts something the git archive cannot
   * carry, fix the test instead — an override fixes one assignment, a corrected test fixes it
   * everywhere the tests run.
   */
  runnerConfig?: Record<string, unknown>;
  /**
   * Every section carries its own `pointValue`, and the assignment total is their
   * sum. A checkpoint scores its short response and its coding work against
   * different rubrics with different maximums, and each gets its own model call and
   * its own report, so one number per assignment cannot serve both.
   *
   * A function of `rubricId` rather than a literal, because a section names the `Rubric` row it
   * is graded against and those rows are created by this same script a few lines earlier. The
   * pairing itself is not decided here — `SECTION_TYPE_REGISTRY` in `lib/section-types.ts` owns
   * which rubric a section type takes, and the authoring form validates against it.
   */
  sections: (rubricId: (name: string) => string | undefined) => SeedSection[];
};

/**
 * Every seeded section is AI-graded, so `grading` is filled in below rather than being a
 * field each entry has to remember. A manually graded section is a different shape — a
 * label and a point value, no rubric — and nothing seeded needs one: manual grading exists
 * for the assignment kinds a seed script cannot usefully create.
 */
type SeedSection = {
  type: string;
  pointValue: number;
  rubricId?: string;
  reportTemplate?: string;
  evidence?: string;
  testNamePattern?: string;
};

const SEED_ASSIGNMENTS: Record<string, SeedAssignment> = {
  // A standard three-question algorithm assignment: from-scratch, modify, and debug, with the
  // instructor's Jest suite in the template's tests/ directory.
  //
  // This one rather than another because it is the only shape that exercises everything: a
  // template to generate from, answer keys to load, a rubric to grade against, and a suite the
  // sandbox can actually run. An assignment with no tests would leave half the pipeline
  // unreachable on a fresh database.
  "swe-1-4-loops": {
    answerKeyDir: "answer-keys/mod-1-js-fundamentals",
    runnerPreset: "node-jest",
    sections: (rubricId) => [
      {
        type: "coding_algorithm",
        // Ten questions at 3 points each. The unit is a question, not a file — the
        // six functions in from-scratch, two in modify, and two in debug are ten
        // separately scored questions.
        pointValue: 30,
        rubricId: rubricId("CODING_ALGORITHM_FLUENCY"),
        reportTemplate: "coding-fluency",
        // The whole suite counts toward this section, so no testNamePattern.
        evidence: "tests",
      },
    ],
  },
};

const SPEC = SEED_ASSIGNMENTS[ASSIGNMENT_REPO_NAME];
if (!SPEC) {
  throw new Error(
    `No seed definition for template repository "${ASSIGNMENT_REPO_NAME}".\n` +
      `  Known: ${Object.keys(SEED_ASSIGNMENTS).join(", ")}\n` +
      `  This script bootstraps one assignment so a fresh database is usable; it is not\n` +
      `  where the curriculum lives. Author the one you want in the application, which\n` +
      `  validates its answer keys and rubric pairing against the real repositories —\n` +
      `  seeding it from a guess here would load the wrong answer keys and apply the\n` +
      `  wrong rubric.`,
  );
}

/**
 * Taken from the spec rather than the environment. There is no override, because the
 * directory has to match a real one in the answer-key repository and an override can only
 * move it away from the verified value. `mod-1` looks plausible and is wrong; the directory
 * is `answer-keys/mod-1-js-fundamentals`.
 */
const ANSWER_KEY_DIR = SPEC.answerKeyDir;

/**
 * Where the seeded assignment's reference solutions live.
 *
 * The same repository `GRADING_ASSETS_REPO` names, which is what every existing assignment
 * uses — an authored assignment can name any repository, and this one names the one the
 * seeded answer key paths are real in.
 */
const ANSWER_KEY_REPO = process.env.GRADING_ASSETS_REPO;
if (!ANSWER_KEY_REPO) {
  throw new Error(
    "GRADING_ASSETS_REPO must be set — the seeded assignment names it as the repository " +
      "its reference solutions live in. See .env.example.",
  );
}

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DIRECT_URL or DATABASE_URL must be set — see .env.example.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

/**
 * The four rubric sections that exist in
 * grading/swe-assignment-grading-guides/grading-toolkit/rubric.md today. This is
 * a fixed taxonomy, not an instructor-authored rubric builder.
 *
 * `maxScore` is the maximum for ONE gradable unit, not for a whole assignment,
 * because assignments contain a variable number of questions. Criteria carry a
 * `perQuestion` flag so the grading pipeline knows which ones repeat: a
 * short-response assignment with 4 questions is worth 15 points, being 3
 * technical points per question plus a single 3-point writing quality score for
 * the submission as a whole.
 */
const RUBRICS = [
  {
    name: "SHORT_RESPONSE",
    scaleType: RubricScaleType.SHORT_RESPONSE,
    maxScore: 6,
    criteria: [
      {
        key: "technical",
        label: "Technical Score",
        max_points: 3,
        perQuestion: true,
        description:
          "Technical accuracy and precision of the content. Required terminology counts here, not in writing quality.",
      },
      {
        key: "writing_quality",
        label: "Writing Quality Score",
        max_points: 3,
        perQuestion: false,
        description:
          "Mechanics, clarity, organization, and markdown rendering for the whole submission. Broken markdown is a writing deduction, never a technical one.",
      },
    ],
  },
  {
    name: "CODING_ALGORITHM_FLUENCY",
    scaleType: RubricScaleType.POINTS,
    // One 3-point score per question, with code style folded into it rather than
    // scored separately: rubric.md's bands require clean code for a 3, and pull a
    // question down a band for lint errors, poor names, or dead code even when the
    // tests pass. A ten-question assignment is therefore out of 30.
    maxScore: 3,
    criteria: [
      {
        key: "algorithm",
        label: "Algorithm Score",
        max_points: 3,
        perQuestion: true,
        description:
          "3 all tests pass with clean code, 2 one small fix away or one or two style " +
          "problems, 1 multiple or major errors, 0 does not work or was not attempted. " +
          "Code style is part of this score, not a separate criterion.",
      },
    ],
  },
  {
    // Sandbox execution for SQL is deferred, so these sections route to
    // NEEDS_MANUAL_REVIEW. The rubric row exists so assignments can reference it.
    name: "CODING_SQL_FLUENCY",
    scaleType: RubricScaleType.POINTS,
    maxScore: 1,
    criteria: [
      {
        key: "query_task",
        label: "Query Task",
        max_points: 1,
        perQuestion: true,
        description:
          "One point per correct query result set. Schema design tasks are checkbox-based.",
      },
    ],
  },
  {
    // Frontend grading is a README-checklist and code-reading judgment today, so
    // there is no execution score in this build.
    name: "CODING_FRONTEND",
    scaleType: RubricScaleType.CHECKLIST,
    maxScore: 0,
    criteria: [],
  },
] as const;

async function requireProfile(email: string, role: Role) {
  const profile = await prisma.profile.findUnique({ where: { email } });

  if (!profile) {
    throw new Error(
      `No profile found for ${email}.\n\n` +
        `Profiles are created by Supabase Auth when someone logs in — this script cannot create them.\n` +
        `Log in as ${email} at least once, then run the seed again.\n` +
        `To use different accounts, set SEED_INSTRUCTOR_EMAIL and SEED_STUDENT_EMAIL.`,
    );
  }

  /*
    Raised, never lowered. `SEED_INSTRUCTOR_EMAIL` asks for INSTRUCTOR, and the account that
    holds it is the deployment's admin — so writing the role unconditionally would demote the
    only admin every time this ran, locking the admin screens against everybody. The same rule
    `redeemInvite` follows, for the same reason: a bootstrap step must not take access away.
  */
  const RANK: Record<Role, number> = {
    [Role.STUDENT]: 0,
    [Role.INSTRUCTOR]: 1,
    [Role.ADMIN]: 2,
  };

  if (RANK[profile.role] < RANK[role]) {
    await prisma.profile.update({ where: { id: profile.id }, data: { role } });
    console.log(`  raised ${email} to ${role}`);
    return { ...profile, role };
  }

  if (profile.role !== role) {
    console.log(
      `  left ${email} as ${profile.role}, which is above the ${role} this seed asks for`,
    );
  }
  return profile;
}

async function main() {
  /*
    ---- Rubrics ------------------------------------------------------------

    **The one thing this seed still updates, and the exception is deliberate.**

    Everything else here creates and never modifies, because everything else is editable in the
    application and re-seeding was reverting instructors' decisions. Rubrics are not: there is no
    rubric mutation in any router, so this script is their only author. Refusing to update them
    would mean a corrected rubric could never reach a database that already has the old one, with
    nothing to gain — there is no instructor edit here to protect.

    That changes the day rubrics become editable, which the ROADMAP has as instructor-authored
    rubrics. At that point this becomes `update: {}` like the rest.
  */
  const rubricsByName = new Map<string, string>();
  for (const rubric of RUBRICS) {
    const row = await prisma.rubric.upsert({
      where: { name: rubric.name },
      create: {
        name: rubric.name,
        scaleType: rubric.scaleType,
        maxScore: rubric.maxScore,
        criteria: rubric.criteria,
      },
      update: {
        scaleType: rubric.scaleType,
        maxScore: rubric.maxScore,
        criteria: rubric.criteria,
      },
    });
    rubricsByName.set(row.name, row.id);
  }
  console.log(`Rubrics: ${RUBRICS.length} upserted`);

  // ---- People -------------------------------------------------------------
  const instructor = await requireProfile(INSTRUCTOR_EMAIL, Role.INSTRUCTOR);
  const student = await requireProfile(STUDENT_EMAIL, Role.STUDENT);

  if (!student.githubUsername) {
    console.warn(
      `\n  WARNING: ${STUDENT_EMAIL} has no GitHub identity linked.\n` +
        `  Accepting an assignment will fail, because the repository name and the\n` +
        `  collaborator invitation both need a GitHub login. Sign in with GitHub as\n` +
        `  this account, or set SEED_STUDENT_EMAIL to an account that has.\n`,
    );
  }

  if (!instructor.githubUsername) {
    console.warn(
      `  Note: ${INSTRUCTOR_EMAIL} has no GitHub identity linked, so this instructor\n` +
        `  will be skipped when adding collaborators. Accepting an assignment still\n` +
        `  works; the instructor just will not have repository access until they link it.\n`,
    );
  }

  // ---- Course -------------------------------------------------------------
  //
  // One-time cleanup. An earlier version of this script created the course with a
  // hardcoded id, "00000000-0000-0000-0000-00000000c0de". Postgres accepts that
  // as a uuid value, but it is not a valid UUID: the version nibble must be 1
  // through 8 and that one is 0. So z.string().uuid() rejects it, and every page
  // that takes a courseId in its URL fails validation.
  //
  // Deleting cascades to that course's assignments, enrollments, and submissions.
  // That is acceptable only because this id could not have come from anywhere
  // except the old seed. Do not generalise this to real course ids.
  const LEGACY_COURSE_ID = "00000000-0000-0000-0000-00000000c0de";
  const legacy = await prisma.course.findUnique({
    where: { id: LEGACY_COURSE_ID },
    select: { id: true, _count: { select: { assignments: true } } },
  });

  if (legacy) {
    console.log(
      `  removing the old seed course with the invalid id ${LEGACY_COURSE_ID}\n` +
        `    (${legacy._count.assignments} assignment(s) and any submissions)`,
    );
    await prisma.course.delete({ where: { id: LEGACY_COURSE_ID } });
  }

  /*
    The program, then its one course.

    The id is generated by the database in both cases. Idempotency comes from the natural key
    instead: a program is identified by its name and its term, which is what
    `@@unique([name, term])` says, and a course by its name within that program.

    **The roster, the join link, and the attendance days belong to the program**, which is why the
    course below carries none of them. It carries the short name that prefixes its repositories, and
    it is published — an unpublished course is invisible to fellows, which is not what a development
    database wants.
  */
  const PROGRAM_NAME = "Test Program";
  // "Cohort Test" would read as a *cohort* now that the word means a division of a roster, so
  // the seeded term is one a person would actually write. It is also what makes the suggested
  // short name come out as `fse-f26` rather than `fse-cohort-test`.
  const TERM = "Fall 2026";
  const COURSE_NAME = "Test Course";

  const program =
    (await prisma.program.findFirst({
      where: { name: PROGRAM_NAME, term: TERM },
    })) ??
    (await prisma.program.create({
      data: {
        name: PROGRAM_NAME,
        term: TERM,
        joinToken: newJoinToken(),
        instructorToken: newJoinToken(),
      },
    }));
  console.log(`Program: ${program.name} (${program.term}) — ${program.id}`);

  const course =
    (await prisma.course.findFirst({
      where: { programId: program.id, name: COURSE_NAME },
    })) ??
    (await prisma.course.create({
      data: {
        programId: program.id,
        name: COURSE_NAME,
        // The same suggestion `courses.create` offers, so the seeded and authored shapes cannot
        // drift — which is the rule this whole script is written to.
        slug: suggestCourseSlug({ courseName: COURSE_NAME, term: TERM }),
        publishedAt: new Date(),
      },
    }));
  console.log(`Course: ${course.name} (${program.term}) — ${course.id}`);

  /*
    The course's modules, as rows.

    These are the program's real module names and they are deliberately NOT the answer-keys
    repository's directory names — Mod 0 has no directory at all, and the repository holds
    mod-2-review and mod-8-capstone which are not modules of this course. That divergence is
    the point of modules being rows: what a cohort takes is a cohort decision, not a fact
    about how a repository is laid out.

    **Identified by position, not by name**, which is the only reason re-seeding is safe.

    This upserted by name and the comment here claimed that survived a rename. It does the
    opposite: rename "Mod 1 - JavaScript Fundamentals" to "Mod 1 - JS Fundamentals" and the next
    seed run finds nothing by the old name and *creates* it — so the course ends up with the
    renamed module holding all the assignments and an empty impostor beside it, at the position
    the seed wanted. It happened, twice, and the copy of that course inherited both.

    A name is what an instructor changes; a position is what the seed is actually asserting —
    "this course has eight modules in this order". So a module already at position N *is* this
    module, whatever it has since been called, and the seed leaves its name alone.
  */
  const MODULE_NAMES = [
    "Mod 0 - Command Line Interfaces, Git, and GitHub",
    "Mod 1 - JavaScript Fundamentals",
    "Mod 2 - Object-Oriented Programming",
    "Mod 3 - HTML & CSS",
    "Mod 4 - Interactive & Data-Driven User Interfaces",
    "Mod 5 - Server-Side Development",
    "Mod 6 - Databases",
    "Mod 7 - React",
  ];

  /**
   * The seed's modules, indexed by where they appear in `MODULE_NAMES`.
   *
   * **By name, not by the `position` column**, and the difference matters. `position` is the
   * instructor's ordering: it is shared by all three categories, it is not unique, and `reorder`
   * rewrites the whole sequence whenever somebody drags a unit. What this map means is "the module
   * this seed calls index 1", which `MODULE_FOR_KEY_DIR` uses to route assignments — a stable
   * property of the seed rather than of the course.
   *
   * Reading the column instead is a bug this script has already had. Looking up "the module at
   * position 2" found a *project* sitting there, concluded there was no module, and created one —
   * a second copy of a module the course already had, at a position another unit already occupied.
   * Names are what identify these rows, so names are what this asks about.
   */
  const moduleIdByPosition = new Map<number, string>();

  /*
    Where a module the course does not have yet should go: after everything already in it. Never
    at the seed's own index, which is what claimed an occupied slot before. An instructor moves it
    afterwards if they want it elsewhere, and `reorder` renumbers the sequence when they do.
  */
  const last = await prisma.courseUnit.aggregate({
    where: { courseId: course.id },
    _max: { position: true },
  });
  let nextPosition = (last._max.position ?? -1) + 1;

  /*
    The course's modules in order, and **only its modules**. This is the list the seed's index
    means: `MODULE_FOR_KEY_DIR` says an assignment belongs to "module 4", and the fourth module of
    the course is what that names — whatever the `position` column happens to read, and whatever
    projects or assessments sit among them in the shared sequence.

    Reading the column directly is the bug this replaced. "The module at position 2" found a
    project there, concluded no module existed, and created a second copy of one the course
    already had.
  */
  const modulesInOrder = await prisma.courseUnit.findMany({
    where: { courseId: course.id, category: "MODULE" },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  for (const [index, name] of MODULE_NAMES.entries()) {
    /*
      By name first, then by ordinal.

      Both, because either alone is wrong in a way that shows up on a real database. By name only
      creates a duplicate in a course whose modules an instructor has renamed — which is most
      courses, since the seeded names are placeholders. By ordinal only would attach the seed's
      assignments to whatever module happens to be fourth in a course that has its own curriculum,
      which is a guess about somebody else's course.

      Together they degrade sensibly: a course this seed set up matches by name, a course that
      renamed its modules matches by ordinal, and only a course with fewer modules than the seed
      expects gets a new one — appended, never at a slot something else holds.
    */
    const existing =
      modulesInOrder.find((unit) => unit.name === name) ?? modulesInOrder[index] ?? null;

    if (existing) {
      moduleIdByPosition.set(index, existing.id);
      continue;
    }

    const row = await prisma.courseUnit.create({
      data: { courseId: course.id, name, position: nextPosition, category: "MODULE" },
      select: { id: true, name: true },
    });
    nextPosition += 1;
    modulesInOrder.push(row);
    moduleIdByPosition.set(index, row.id);
  }
  console.log(`Modules: ${MODULE_NAMES.length}`);

  /**
   * Which module each seeded assignment goes in.
   *
   * Keyed by the answer-keys directory the assignment's solutions live under, because that is
   * what `SEED_ASSIGNMENTS` already carries. The two are no longer the same thing, so the
   * mapping has to be written down rather than derived — which is exactly the freedom the
   * change bought, and exactly the cost of it.
   *
   * The value is a **position** in `MODULE_NAMES`, not a name, for the same reason as above: a
   * name is what an instructor renames, and a mapping that went through the name would stop
   * resolving the moment they did. Only new assignments are placed by it — an existing one keeps
   * whatever module it is in.
   */
  const MODULE_FOR_KEY_DIR: Record<string, number> = {
    "answer-keys/mod-1-js-fundamentals": 1,
    "answer-keys/mod-2-oop": 2,
    "answer-keys/mod-3-html-css": 3,
    "answer-keys/mod-4-dom": 4,
    "answer-keys/mod-5-servers": 5,
    "answer-keys/mod-6-databases": 6,
    "answer-keys/mod-7-react": 7,
  };

  function moduleIdFor(keyDir: string): string {
    const position = MODULE_FOR_KEY_DIR[keyDir];
    const id = position === undefined ? undefined : moduleIdByPosition.get(position);
    if (!id) {
      throw new Error(
        `No module for answer key directory "${keyDir}". Add it to MODULE_FOR_KEY_DIR, or to ` +
          `MODULE_NAMES if the course should have a module it does not.`,
      );
    }
    return id;
  }

  /*
    An instructor of the program, and the owner of it.

    **Authority comes from this row and not from the one below.** An instructor of a program may
    author and grade in every course of it, so `CourseInstructor` records who is working which
    course — which decides whose name is on it and who is added as a collaborator on the
    repositories it generates.
  */
  await prisma.programInstructor.upsert({
    where: { programId_userId: { programId: program.id, userId: instructor.id } },
    create: { programId: program.id, userId: instructor.id, isPrimary: true },
    update: { isPrimary: true },
  });

  await prisma.courseInstructor.upsert({
    where: { courseId_userId: { courseId: course.id, userId: instructor.id } },
    create: { courseId: course.id, programId: program.id, userId: instructor.id },
    update: {},
  });
  console.log(`Instructor: ${INSTRUCTOR_EMAIL}`);

  // ---- Enrollment ---------------------------------------------------------
  // Written directly, because both accounts already exist. Redeeming the program's join link is
  // what a real new fellow goes through instead, and it produces exactly this row.
  //
  // **On the program, so it admits them to every published course of it.** There is no per-course
  // enrollment to write, which is the duplication the program removed.
  await prisma.enrollment.upsert({
    where: { programId_studentId: { programId: program.id, studentId: student.id } },
    create: {
      programId: program.id,
      studentId: student.id,
      status: EnrollmentStatus.ACTIVE,
    },
    /*
      Deliberately empty. This used to force the status back to ACTIVE, which meant re-seeding
      un-removed a student an instructor had removed — the same mistake as recreating a renamed
      module, one table over. Removing somebody is a decision made in the application, and a
      bootstrap script is not the authority on it.
    */
    update: {},
  });
  console.log(
    `Student: ${STUDENT_EMAIL}${student.githubUsername ? ` (${student.githubUsername})` : ""}`,
  );

  // ---- Assignment ---------------------------------------------------------
  //
  // Shape comes from SEED_ASSIGNMENTS at the top of this file, keyed by template
  // repository name, so the sections always describe the assignment actually
  // being seeded.
  //
  // The folder whose contents are the reference solutions: a real directory inside
  // ANSWER_KEY_REPO, built from ANSWER_KEY_DIR and ASSIGNMENT_REPO_NAME so it cannot drift
  // from the template repository.
  const keyDir = `${ANSWER_KEY_DIR}/${ASSIGNMENT_REPO_NAME}`;

  // Whether it exists is deliberately not checked here. It used to be, against a local clone;
  // with assets read over the API that would make seeding require GitHub credentials and a
  // network round trip to produce a warning it can do nothing about. `npm run verify:assets`
  // reads the real repository, and `checkAnswerKeyDir` is what the authoring form calls —
  // both are better placed for it than a seed script.

  /*
    Validated through the same schema the authoring procedures use, so the seeded
    shape and the authored shape cannot drift — the rules live in one module and this
    script is a caller of them rather than a second implementation.

    It also turns two silent failures into loud ones. A rubric name that does not
    match a seeded row used to write a section with `rubricId: undefined`, which only
    surfaced when grading loaded no rubric; and the assignment total is now computed
    by `parseAssignmentSpec`, so there is no input to this script that could make the
    gradebook column disagree with the reports beneath it.
  */
  const spec = parseAssignmentSpec({
    kind: AssignmentKind.REPO,
    // For repository-based assignments the title is the repository name, so that
    // what a student sees in the LMS matches the repository they are working in.
    // `title` stays a separate column because a Google Doc or upload assignment
    // still needs a human-readable name and has no repository to borrow one from.
    title: ASSIGNMENT_REPO_NAME,
    courseUnitId: moduleIdFor(ANSWER_KEY_DIR),
    completionThreshold: 0.75,
    templateRepo: TEMPLATE_REPO,
    answerKeyRepo: ANSWER_KEY_REPO,
    answerKeyDir: keyDir,
    assignmentRepoName: ASSIGNMENT_REPO_NAME,
    githubOrg: GITHUB_ORG,
    runnerPreset: SPEC.runnerPreset,
    runnerConfig: SPEC.runnerConfig ?? null,
    sections: SPEC.sections((name) => rubricsByName.get(name)).map((section) => ({
      grading: "ai" as const,
      ...section,
    })),
  });

  const assignment = await prisma.assignment.upsert({
    where: {
      courseId_assignmentRepoName: {
        courseId: course.id,
        assignmentRepoName: ASSIGNMENT_REPO_NAME,
      },
    },
    create: {
      courseId: course.id,
      kind: spec.kind,
      title: spec.title,
      courseUnitId: spec.courseUnitId,
      pointValue: spec.pointValue,
      completionThreshold: spec.completionThreshold,
      templateRepo: spec.templateRepo,
      answerKeyRepo: spec.answerKeyRepo,
      answerKeyDir: spec.answerKeyDir,
      assignmentRepoName: spec.assignmentRepoName,
      githubOrg: spec.githubOrg,
      templateRef: spec.templateRef,
      distributedAt: new Date(),
      runnerPreset: spec.runnerPreset,
      // Prisma.DbNull writes SQL NULL. Passing plain `null` to a Json? column
      // writes the JSON value `null` instead, which an `IS NULL` filter misses.
      runnerConfig: (spec.runnerConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
      sections: spec.sections as unknown as Prisma.InputJsonValue,
    },
    /*
      Deliberately empty. **This seed creates; it does not correct.**

      Every field the spec describes used to be refreshed here too, so that a row seeded before
      its spec was fixed would pick the fix up. That was defensible while this database held
      nothing but seeded rows. It is not now: an assignment's title, point value, thresholds,
      repositories, and rubric sections are all editable in the authoring form, and re-seeding
      reverted whichever of them an instructor had changed — silently, and with no record that
      the values had ever been different.

      The cost is stated rather than hidden: a corrected spec no longer reaches an assignment
      that already exists. Edit it in the authoring form, which is where its current values came
      from, or remove the row and seed again.
    */
    update: {},
  });
  console.log(`Assignment: ${assignment.title} — template ${assignment.templateRepo}`);
  console.log(
    `  student repositories will be named ${course.slug}-${ASSIGNMENT_REPO_NAME}-{github login}`,
  );

  // Assignments from earlier runs that used a different template repository are
  // left in place. Changing SEED_TEMPLATE_REPO therefore adds an assignment
  // rather than replacing one, and the course can end up listing more than one.
  // Remove any you do not want by hand — this script does not delete assignments.

  /*
    One project and one assessment, so the three gradebook tabs and a student's course list all
    have something real to render.

    **Course units of their own, sitting after the modules in the same sequence.** A project is
    not a thing inside a module: it is a peer of one, with its own deliverables and its own place
    in the term. That is what makes the gradebook's tabs a property of the unit rather than a join
    through something else.

    **Every assignment is left unpublished.** `distributedAt` stays null, so no student sees any
    of this and nobody's progress bar moves — an instructor opening the Projects tab sees the
    shape of the feature, and the course's own screens are untouched. Publish one from the
    authoring form to try the student side.

    **Not repository-backed.** These are all `SELF_DIRECTED`, so nothing here implies
    a GitHub template that does not exist, and every section is graded by hand — which is what
    `noRepository` in `lib/assignments/spec.ts` requires of those kinds anyway.

    Idempotent by name within the course, the same rule `@@unique([courseId, name])` enforces:
    running the seed twice leaves one of each rather than adding another.
  */
  const SAMPLE_UNITS = [
    {
      category: "PROJECT" as const,
      name: "Sample Project",
      overview:
        "A worked example of a project, seeded so the Projects tab has something in it. Its " +
        "deliverables are unpublished, so no student can see them.",
      work: [
        {
          title: "Sample Project — wireframes",
          kind: "SELF_DIRECTED" as const,
          handInMethods: ["LINK" as const],
          acceptedFileTypes: [] as string[],
          days: 7,
        },
        {
          title: "Sample Project — deployed site",
          kind: "SELF_DIRECTED" as const,
          handInMethods: ["LINK" as const],
          acceptedFileTypes: [] as string[],
          days: 21,
        },
      ],
    },
    {
      category: "ASSESSMENT" as const,
      name: "Sample Assessment",
      overview:
        "A worked example of an assessment: several parts, each handed in separately and in its " +
        "own format. Unpublished, so no student can see them.",
      work: [
        /*
          Both ways in, deliberately: this is the one sample assignment that puts the hand-in
          chooser on screen, so a fresh database shows what a choose-your-own-path assignment
          looks like rather than only what the two single-method ones do.
        */
        {
          title: "Sample Assessment — short response",
          kind: "SELF_DIRECTED" as const,
          handInMethods: ["LINK" as const, "FILE" as const],
          acceptedFileTypes: ["pdf", "document"] as string[],
          days: 3,
        },
        {
          title: "Sample Assessment — ERD",
          kind: "SELF_DIRECTED" as const,
          handInMethods: ["LINK" as const],
          acceptedFileTypes: [] as string[],
          days: 3,
        },
        {
          title: "Sample Assessment — queries",
          kind: "SELF_DIRECTED" as const,
          handInMethods: ["FILE" as const],
          acceptedFileTypes: ["python"] as string[],
          days: 5,
        },
      ],
    },
  ];

  for (const [offset, sample] of SAMPLE_UNITS.entries()) {
    const unit = await prisma.courseUnit.upsert({
      where: { courseId_name: { courseId: course.id, name: sample.name } },
      create: {
        courseId: course.id,
        category: sample.category,
        name: sample.name,
        overview: sample.overview,
        // At the end of whatever the course already holds, for the reason the modules above are:
        // a position chosen from the seed's own numbering claims a slot another unit may occupy.
        position: nextPosition + offset,
      },
      // Deliberately empty, for the reason the assignment upsert above gives: this seed creates,
      // it does not correct. A name an instructor has edited stays edited.
      update: {},
      select: { id: true, name: true },
    });

    for (const item of sample.work) {
      const existing = await prisma.assignment.findFirst({
        where: { courseId: course.id, title: item.title },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.assignment.create({
        data: {
          courseId: course.id,
          courseUnitId: unit.id,
          kind: item.kind,
          handInMethods: item.handInMethods,
          acceptedFileTypes: item.acceptedFileTypes,
          title: item.title,
          pointValue: 10,
          completionThreshold: 0.75,
          /*
            Staggered, so the by-due-date ordering every screen applies has something to do, and
            at 11:59pm on each of those days rather than at whatever time the seed happened to
            run. A sample assignment due at 4:04pm reads as a deliberate deadline somebody chose,
            and it is really just the clock.
          */
          dueAt: instantAtSchoolClock(
            schoolDayOf(new Date(Date.now() + item.days * 24 * 60 * 60 * 1000)),
            END_OF_DAY,
          ),
          // Unpublished: this is what keeps the sample out of every student's course page.
          distributedAt: null,
          sections: [{ grading: "manual", label: "Overall", pointValue: 10 }],
        },
      });
    }

    console.log(
      `${sample.category === "PROJECT" ? "Project" : "Assessment"}: ${unit.name} — ` +
        `${sample.work.length} unpublished assignments`,
    );
  }

  /*
    A term's worth of GCF results for the seeded student, so every state the screens draw has
    something real behind it: a proctored sitting above the target and one below, mocks that
    improve over time, and a flagged attempt both with a note and without — the second being the
    case the student's page has a sentence for.

    Idempotent on the same triple the import upserts on: a fellow, a kind, and a day. Re-running
    the seed leaves one of each rather than adding another, and an instructor who edited a note
    keeps it, because the update below never touches one.
  */
  const GCF_ATTEMPTS = [
    {
      kind: "MOCK" as const,
      score: 420,
      scorePossible: 1200,
      daysAgo: 84,
      flagged: false,
      note: null,
    },
    {
      kind: "MOCK" as const,
      score: 660,
      scorePossible: 1200,
      daysAgo: 56,
      flagged: false,
      note: null,
    },
    {
      kind: "MOCK" as const,
      score: 780,
      scorePossible: 1200,
      daysAgo: 28,
      flagged: true,
      note: "Flagged for a long paste. We talked it through — it was scaffolding from the lecture.",
    },
    // Flagged with no note, which is what a fellow's page has to handle without leaving them
    // with a bare word and nobody to ask.
    {
      kind: "MOCK" as const,
      score: 540,
      scorePossible: 1200,
      daysAgo: 14,
      flagged: true,
      note: null,
    },
    {
      kind: "PROCTORED" as const,
      score: 356,
      scorePossible: null,
      daysAgo: 70,
      flagged: false,
      note: null,
    },
    {
      kind: "PROCTORED" as const,
      score: 431,
      scorePossible: null,
      daysAgo: 21,
      flagged: false,
      note: null,
    },
  ];

  for (const attempt of GCF_ATTEMPTS) {
    const takenOn = new Date(Date.now() - attempt.daysAgo * 24 * 60 * 60 * 1000);
    // Midnight UTC, which is how Prisma and Postgres represent a bare `@db.Date`.
    const day = new Date(`${takenOn.toISOString().slice(0, 10)}T00:00:00Z`);

    await prisma.gcfAttempt.upsert({
      where: {
        studentId_kind_takenOn: { studentId: student.id, kind: attempt.kind, takenOn: day },
      },
      create: {
        studentId: student.id,
        kind: attempt.kind,
        score: attempt.score,
        scorePossible: attempt.scorePossible,
        takenOn: day,
        integrityFlagged: attempt.flagged,
        note: attempt.note,
      },
      // Deliberately empty, for the reason every other upsert here is: this seed creates, it does
      // not correct. A note an instructor wrote stays written.
      update: {},
    });
  }

  console.log(
    `GCF: ${GCF_ATTEMPTS.length} attempts for ${STUDENT_EMAIL} ` +
      `(${GCF_ATTEMPTS.filter((a) => a.kind === "PROCTORED").length} proctored)`,
  );

  console.log("\nSeed complete.");
}

main()
  .catch((error) => {
    console.error(`\nSeed failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
