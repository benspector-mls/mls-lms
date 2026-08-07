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
 * So: existing rows are left alone. Modules are identified by position rather than name, because
 * position is what this script is actually asserting and a name is what an instructor changes.
 * Roles are raised and never lowered. The one exception is rubrics, which no router can author —
 * see the comment at the top of `main`.
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
import { slugifyCohort } from "../lib/courses/cohort-slug";
import { newJoinToken } from "../lib/courses/join-token";
import { PrismaClient, Prisma, Role, EnrollmentStatus, RubricScaleType } from "../lib/generated/prisma/client";

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
const GITHUB_ORG = process.env.SEED_GITHUB_ORG ?? "marcy-lms-test";
const TEMPLATE_REPO = process.env.SEED_TEMPLATE_REPO ? `${GITHUB_ORG}/${process.env.SEED_TEMPLATE_REPO}` : `${GITHUB_ORG}/swe-1-4-loops`;

/**
 * The repository name is the template repository's name, so a student's
 * repository is `{cohortSlug}-{assignmentRepoName}-{their github login}`. Derived rather than
 * written out separately, because the two must always agree: if they disagree,
 * `accept` creates a repository from one template and names it after another.
 */
const ASSIGNMENT_REPO_NAME = TEMPLATE_REPO.split("/")[1];

/**
 * What each seedable assignment actually contains, keyed by template repository
 * name.
 *
 * This exists because an assignment's gradable sections cannot be derived from
 * its name, and getting them wrong is not a harmless default: sections drive
 * which answer keys are loaded and which rubric is applied. An unknown template
 * therefore fails the seed rather than borrowing another assignment's shape.
 *
 * `answerKeyDir` is the directory holding the module's answer keys; the assignment's own
 * folder inside it is named after the template repository, which is where every file is
 * the reference set. Verify a new entry against
 * `{GRADING_ASSETS_REPO}/{answerKeyDir}/{repo}/`.
 */
type SeedAssignment = {
  answerKeyDir: string;
  /** Names an entry in lib/sandbox/presets.ts. "none" means no runnable tests. */
  runnerPreset: string;
  /**
   * Shallow override merged over the named preset, for the exceptions. Nothing uses
   * it today; the SQL preset will, once it needs its own E2B template.
   *
   * Reach for it only when the assignment needs something different about the
   * *environment* — a template with PostgreSQL installed, a longer timeout. When a
   * test asserts something the git archive cannot carry, fix the test instead: an
   * override fixes one assignment, a corrected test fixes it everywhere the tests
   * run. See swe-1-3-node-modules below.
   */
  runnerConfig?: Record<string, unknown>;
  /**
   * Every section carries its own `pointValue`, and the assignment total is their
   * sum. A checkpoint scores its short response and its coding work against
   * different rubrics with different maximums, and each gets its own model call and
   * its own report, so one number per assignment cannot serve both.
   *
   * These are a stopgap until an instructor can enter them when creating an
   * assignment. They do not belong in a repository, and not every assignment has one
   * to derive them from: a writing assignment submitted as a Google Doc, or a resume
   * uploaded as a PDF, has no template repository and no test suite but still has a
   * point value. This map only pre-fills the seeded assignments so the pipeline is
   * testable before the authoring interface exists.
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
  // A standard three-question algorithm assignment: from-scratch, modify, and
  // debug, with the instructor's Jest suite in the template's tests/ directory.
  // This is the assignment Phase 2 is verified against.
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

  // Student work here includes a *nested* npm package: the student runs
  // `npm init -y` and installs `prompt-sync` inside src/madlib-challenge/.
  //
  // Two things this does NOT need, both of which look at first as though it would.
  //
  // It does not need `allowStudentDependencies`. That flag governs the repository's
  // own package.json, which is a protected path. A nested package.json is ordinary
  // student work and is never restored or merged, so the student's dependency
  // survives untouched.
  //
  // It does not need a `setupCommands` override to install that nested package
  // either. Its test asserted that node_modules/prompt-sync existed on disk, which
  // `node_modules/` being gitignored made impossible to satisfy from any checkout;
  // the assertion was removed from the template instead. Fixing a test that asserted
  // something git cannot carry was smaller than teaching the runner a special case.
  "swe-1-3-node-modules": {
    answerKeyDir: "answer-keys/mod-1-js-fundamentals",
    runnerPreset: "node-jest",
    sections: (rubricId) => [
      {
        type: "coding_algorithm",
        // PLACEHOLDER — confirm before grading anyone on this assignment.
        //
        // Two questions at 3 points each: the modify exercise and the madlib
        // challenge. The count is genuinely arguable, which is why this needs a
        // person: the madlib challenge is one exercise but seven checklist-like
        // steps, and grading it as seven questions would make it worth 24 rather
        // than 6.
        // Confirmed 6 points — there are only 2 real questions even though each 
        // may have multiple tests or steps
        pointValue: 6,
        rubricId: rubricId("CODING_ALGORITHM_FLUENCY"),
        reportTemplate: "coding-fluency",
        evidence: "tests",
      },
    ],
  },

  // A checkpoint carrying two sections at once, which is the case the explicit
  // `sections` mapping exists for: one pull request contains both a short
  // response file and frontend source files, and a path convention alone cannot
  // express that. Neither section has a suite this build can run — the short
  // response has nothing to execute and frontend execution is deferred — so the
  // preset is "none" and neither section declares `evidence`.
  "swe-checkpoint-summative-1-4": {
    answerKeyDir: "answer-keys/mod-4-dom",
    runnerPreset: "none",
    sections: (rubricId) => [
      {
        type: "short_response",
        // Three technical points for each of 4 questions, plus a single 3-point
        // writing quality score for the submission as a whole.
        pointValue: 15,
        rubricId: rubricId("SHORT_RESPONSE"),
        reportTemplate: "short-response",
      },
      {
        type: "coding_frontend",
        // One point per item in the README checklist, of which there are 25. This
        // section is deliberately worth more than the short response above; the two
        // are scored against different rubrics and are not meant to be comparable.
        pointValue: 25,
        rubricId: rubricId("CODING_FRONTEND"),
        reportTemplate: "coding-frontend",
      },
    ],
  },
};

const SPEC = SEED_ASSIGNMENTS[ASSIGNMENT_REPO_NAME];
if (!SPEC) {
  throw new Error(
    `No seed definition for template repository "${ASSIGNMENT_REPO_NAME}".\n` +
    `  Known: ${Object.keys(SEED_ASSIGNMENTS).join(", ")}\n` +
    `  Add an entry to SEED_ASSIGNMENTS in prisma/seed.ts naming its answer-key\n` +
    `  directory, point value, runner preset, and gradable sections. Seeding it with\n` +
    `  another assignment's sections would load the wrong answer keys and apply the\n` +
    `  wrong rubric, so this fails rather than guessing.`,
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
        description: "One point per correct query result set. Schema design tasks are checkbox-based.",
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
    console.log(`  left ${email} as ${profile.role}, which is above the ${role} this seed asks for`);
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
    select: { id: true, _count: { select: { assignments: true, enrollments: true } } },
  });

  if (legacy) {
    console.log(
      `  removing the old seed course with the invalid id ${LEGACY_COURSE_ID}\n` +
      `    (${legacy._count.assignments} assignment(s), ${legacy._count.enrollments} enrollment(s), and any submissions)`,
    );
    await prisma.course.delete({ where: { id: LEGACY_COURSE_ID } });
  }

  // The id is generated by the database. Idempotency comes from the natural key
  // instead: a course is identified by its name and cohort term.
  const existingCourse = await prisma.course.findFirst({
    where: { name: "Software Engineering Fellowship", cohortTerm: "Cohort Test" },
  });

  const course =
    existingCourse ??
    (await prisma.course.create({
      data: {
        name: "Software Engineering Fellowship",
        cohortTerm: "Cohort Test",
        cohortSlug: slugifyCohort("Cohort Test"),
        joinToken: newJoinToken(),
      },
    }));
  console.log(`Course: ${course.name} (${course.cohortTerm}) — ${course.id}`);

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

  /** Module id by position, because position is what survives an instructor renaming one. */
  const moduleIdByPosition = new Map<number, string>();
  for (const [position, name] of MODULE_NAMES.entries()) {
    /*
      `findFirst` rather than a unique lookup: `position` is deliberately not unique, so that
      `reorder` can rewrite the whole sequence in one statement. The name tie-break matches
      `modules.listForCourse`, so "the module at position 1" means the same row here as on screen.
    */
    const existing = await prisma.module.findFirst({
      where: { courseId: course.id, position },
      orderBy: { name: "asc" },
      select: { id: true },
    });

    if (existing) {
      moduleIdByPosition.set(position, existing.id);
      continue;
    }

    /*
      Nothing at this position, so create it — but by name, and tolerating one that already
      exists. A module carrying this name somewhere else is this module after a reorder, and
      claiming the name again would be refused by `@@unique([courseId, name])` anyway.
    */
    const row = await prisma.module.upsert({
      where: { courseId_name: { courseId: course.id, name } },
      create: { courseId: course.id, name, position },
      // Deliberately empty. A module an instructor moved stays where they put it.
      update: {},
      select: { id: true },
    });
    moduleIdByPosition.set(position, row.id);
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

  await prisma.courseInstructor.upsert({
    where: { courseId_userId: { courseId: course.id, userId: instructor.id } },
    create: { courseId: course.id, userId: instructor.id, isPrimary: true },
    update: { isPrimary: true },
  });
  console.log(`Instructor: ${INSTRUCTOR_EMAIL}`);

  // ---- Enrollment ---------------------------------------------------------
  // Written directly, because both accounts already exist. Redeeming the course's join link is
  // what a real new student goes through instead, and it produces exactly this row.
  await prisma.enrollment.upsert({
    where: { courseId_studentId: { courseId: course.id, studentId: student.id } },
    create: {
      courseId: course.id,
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
  console.log(`Student: ${STUDENT_EMAIL}${student.githubUsername ? ` (${student.githubUsername})` : ""}`);

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
    moduleId: moduleIdFor(ANSWER_KEY_DIR),
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
      moduleId: spec.moduleId,
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
  console.log(
    `Assignment: ${assignment.title} — template ${assignment.templateRepo}`,
  );
  console.log(
    `  student repositories will be named ${course.cohortSlug}-${ASSIGNMENT_REPO_NAME}-{github login}`,
  );

  // Assignments from earlier runs that used a different template repository are
  // left in place. Changing SEED_TEMPLATE_REPO therefore adds an assignment
  // rather than replacing one, and the course can end up listing more than one.
  // Remove any you do not want by hand — this script does not delete assignments.

  console.log("\nSeed complete.");
}

main()
  .catch((error) => {
    console.error(`\nSeed failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
