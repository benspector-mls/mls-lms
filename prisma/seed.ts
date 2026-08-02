/**
 * Seed script for Phase 1 verification.
 *
 * Creates: the four rubrics that exist in grading-toolkit/rubric.md, one course,
 * one instructor, one enrolled student, and one assignment whose `sections`
 * mapping points at real files in the answer-keys repository.
 *
 * This script does NOT create auth users. Identity is owned by Supabase Auth, so
 * both profiles must already exist from a real login. The script looks them up
 * by email and fails with an explanation if they are absent.
 *
 * Idempotent: every write is an upsert keyed on a natural unique column, so
 * running it repeatedly converges rather than duplicating.
 *
 * Run with: npm run db:seed
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";

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
 * repository is `{assignmentRepoName}-{their github login}`. Derived rather than
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
 * `moduleTag` is also the first path segment inside the answer-keys repository,
 * which is why the answer key paths are built from it rather than written out.
 * Verify a new entry against
 * `swe-assignment-grading-guides/answer-keys/{moduleTag}/{repo}/`.
 */
type SeedAssignment = {
  moduleTag: string;
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
  sections: (keyDir: string, rubricId: (name: string) => string | undefined) => SeedSection[];
};

type SeedSection = {
  type: string;
  pointValue: number;
  rubricId?: string;
  answerKeyPaths?: string[];
  reportTemplate?: string;
  evidence?: string;
  testNamePattern?: string;
};

const SEED_ASSIGNMENTS: Record<string, SeedAssignment> = {
  // A standard three-question algorithm assignment: from-scratch, modify, and
  // debug, with the instructor's Jest suite in the template's tests/ directory.
  // This is the assignment Phase 2 is verified against.
  "swe-1-4-loops": {
    moduleTag: "mod-1-js-fundamentals",
    runnerPreset: "node-jest",
    sections: (keyDir, rubricId) => [
      {
        type: "coding_algorithm",
        // Ten questions at 3 points each. The unit is a question, not a file — the
        // six functions in from-scratch, two in modify, and two in debug are ten
        // separately scored questions.
        pointValue: 30,
        rubricId: rubricId("CODING_ALGORITHM_FLUENCY"),
        answerKeyPaths: [
          `${keyDir}/from-scratch.js`,
          `${keyDir}/modify.js`,
          `${keyDir}/debug.js`,
        ],
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
    moduleTag: "mod-1-js-fundamentals",
    runnerPreset: "node-jest",
    sections: (keyDir, rubricId) => [
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
        answerKeyPaths: [
          `${keyDir}/modify.js`,
          `${keyDir}/madlib-challenge/index.js`,
          `${keyDir}/madlib-challenge/madlib.js`,
        ],
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
    moduleTag: "mod-4-dom",
    runnerPreset: "none",
    sections: (keyDir, rubricId) => [
      {
        type: "short_response",
        // Three technical points for each of 4 questions, plus a single 3-point
        // writing quality score for the submission as a whole.
        pointValue: 15,
        rubricId: rubricId("SHORT_RESPONSE"),
        answerKeyPaths: [`${keyDir}/SHORT_RESPONSE.MD`],
        reportTemplate: "short-response",
      },
      {
        type: "coding_frontend",
        // One point per item in the README checklist, of which there are 25. This
        // section is deliberately worth more than the short response above; the two
        // are scored against different rubrics and are not meant to be comparable.
        pointValue: 25,
        rubricId: rubricId("CODING_FRONTEND"),
        answerKeyPaths: [
          `${keyDir}/src/main.js`,
          `${keyDir}/src/dom-helpers.js`,
          `${keyDir}/src/fetch-helpers.js`,
          `${keyDir}/src/RecipeCollection.js`,
          `${keyDir}/styles.css`,
        ],
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
    `  Add an entry to SEED_ASSIGNMENTS in prisma/seed.ts naming its module tag,\n` +
    `  point value, runner preset, and gradable sections. Seeding it with another\n` +
    `  assignment's sections would load the wrong answer keys and apply the wrong\n` +
    `  rubric, so this fails rather than guessing.`,
  );
}

/**
 * Taken from the spec rather than the environment. There is no SEED_MODULE_TAG
 * override, because the tag has to match a real directory in the answer-keys
 * repository and an override can only move it away from the verified value.
 * `mod-1` looks plausible and is wrong; the directory is `mod-1-js-fundamentals`.
 */
const MODULE_TAG = SPEC.moduleTag;

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

  if (profile.role !== role) {
    await prisma.profile.update({ where: { id: profile.id }, data: { role } });
    console.log(`  set ${email} role to ${role}`);
  }

  return { ...profile, role };
}

async function main() {
  // ---- Rubrics ------------------------------------------------------------
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
        // The real module tags, taken from the directory names in the
        // answer-keys repository. These are the values assignments use in
        // moduleTag, so inventing different ones would break any grouping by
        // module.
        moduleStructure: [
          "mod-1-js-fundamentals",
          "mod-2-oop",
          "mod-3-html-css",
          "mod-4-dom",
          "mod-5-servers",
          "mod-6-databases",
          "mod-7-react",
          "mod-8-capstone",
        ],
      },
    }));
  console.log(`Course: ${course.name} (${course.cohortTerm}) — ${course.id}`);

  await prisma.courseInstructor.upsert({
    where: { courseId_userId: { courseId: course.id, userId: instructor.id } },
    create: { courseId: course.id, userId: instructor.id, isPrimary: true },
    update: { isPrimary: true },
  });
  console.log(`Instructor: ${INSTRUCTOR_EMAIL}`);

  // ---- Enrollment ---------------------------------------------------------
  // Already bound to a student, because both accounts exist. The invite-token
  // redemption path is what a real new student would go through instead.
  await prisma.enrollment.upsert({
    where: { courseId_studentId: { courseId: course.id, studentId: student.id } },
    create: {
      courseId: course.id,
      studentId: student.id,
      inviteToken: `seed-${course.id}-${student.id}`,
      invitedEmail: STUDENT_EMAIL,
      status: EnrollmentStatus.ACTIVE,
    },
    update: { status: EnrollmentStatus.ACTIVE },
  });
  console.log(`Student: ${STUDENT_EMAIL}${student.githubUsername ? ` (${student.githubUsername})` : ""}`);

  // ---- Assignment ---------------------------------------------------------
  //
  // Shape comes from SEED_ASSIGNMENTS at the top of this file, keyed by template
  // repository name, so the sections always describe the assignment actually
  // being seeded.
  //
  // answerKeyPaths are real paths inside
  // grading/swe-assignment-grading-guides/answer-keys, built from MODULE_TAG and
  // ASSIGNMENT_REPO_NAME so they cannot drift from the template repository. Not
  // read in Phase 1; the grading pipeline uses them in Phase 3.
  const keyDir = `${MODULE_TAG}/${ASSIGNMENT_REPO_NAME}`;

  // A wrong answer key path is invisible until the grading pipeline runs and
  // silently has no reference solution to compare against, so check it here
  // while the local clone is available. GRADING_ASSETS_PATH is not set in every
  // environment, and its absence is not an error.
  const assetsPath = process.env.GRADING_ASSETS_PATH;
  if (assetsPath) {
    const dir = path.join(assetsPath, "answer-keys", keyDir);
    if (!existsSync(dir)) {
      console.warn(
        `  WARNING: answer keys not found at ${dir}\n` +
        `    Check moduleTag for "${ASSIGNMENT_REPO_NAME}" in SEED_ASSIGNMENTS.\n` +
        `    Seeding continues — Phase 1 does not read answer keys.`,
      );
    }
  }

  const sections = SPEC.sections(keyDir, (name) => rubricsByName.get(name));

  // The assignment total is the sum of its sections, never entered separately. A
  // gradebook column that disagreed with the reports beneath it would be worse than
  // no column at all.
  const totalPointValue = sections.reduce((total, section) => total + section.pointValue, 0);

  const assignment = await prisma.assignment.upsert({
    where: {
      courseId_assignmentRepoName: {
        courseId: course.id,
        assignmentRepoName: ASSIGNMENT_REPO_NAME,
      },
    },
    create: {
      courseId: course.id,
      // For repository-based assignments the title is the repository name, so
      // that what a student sees in the LMS matches the repository they are
      // working in. `title` stays a separate column because assignments that are
      // not repository-based still need a human-readable name.
      title: ASSIGNMENT_REPO_NAME,
      moduleTag: MODULE_TAG,
      pointValue: totalPointValue,
      completionThreshold: 0.75,
      templateRepo: TEMPLATE_REPO,
      assignmentRepoName: ASSIGNMENT_REPO_NAME,
      githubOrg: GITHUB_ORG,
      distributedAt: new Date(),
      runnerPreset: SPEC.runnerPreset,
      // Prisma.DbNull writes SQL NULL. Passing plain `null` to a Json? column
      // writes the JSON value `null` instead, which an `IS NULL` filter misses.
      runnerConfig: (SPEC.runnerConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
      sections: sections as unknown as Prisma.InputJsonValue,
    },
    // Everything the spec describes is refreshed here as well as on create,
    // because a row seeded before its spec was corrected would otherwise keep
    // the wrong shape forever. Due dates, scores, and anything an instructor
    // sets by hand are not in the spec and are left alone.
    update: {
      title: ASSIGNMENT_REPO_NAME,
      moduleTag: MODULE_TAG,
      templateRepo: TEMPLATE_REPO,
      githubOrg: GITHUB_ORG,
      pointValue: totalPointValue,
      runnerPreset: SPEC.runnerPreset,
      // Prisma.DbNull writes SQL NULL. Passing plain `null` to a Json? column
      // writes the JSON value `null` instead, which an `IS NULL` filter misses.
      runnerConfig: (SPEC.runnerConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
      sections: sections as unknown as Prisma.InputJsonValue,
    },
  });
  console.log(
    `Assignment: ${assignment.title} (${assignment.moduleTag}) — template ${assignment.templateRepo}`,
  );
  console.log(`  student repositories will be named ${ASSIGNMENT_REPO_NAME}-{github login}`);

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
