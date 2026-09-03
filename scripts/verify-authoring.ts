/**
 * The six questions about an assignment draft that only GitHub can answer.
 *
 *   npm run verify:authoring
 *
 * `validateAssignmentDraft` in `lib/assignments/validate.ts` makes three real requests whenever the
 * draft is repository-backed and the GitHub App is configured: it reads the template repository, it
 * asks whether the App is installed on the organization that owns the answer key repository, and it
 * lists the answer key folder. What comes back is a fact about GitHub and about the organizations
 * this deployment works with, rather than a fact about this repository, so no test suite can stand
 * in for it — a disposable local database has no App installation and no repositories to read.
 *
 * Everything else this script used to hold now runs on every change instead:
 *
 * - `tests/lib/assignments/spec.test.ts` holds the 125 pure checks: what a valid assignment is, how
 *   a section is graded, what each kind requires, and how a repository-backed row is read back.
 *   `tests/lib/assignments/sections.test.ts` and `tests/lib/assignments/task-spec.test.ts` already
 *   covered nineteen of them, and those are not repeated.
 * - `tests/integration/authoring.test.ts` holds everything that needs the database: the authoring
 *   procedures driven through tRPC callers, who is allowed to reach them, the round trip between
 *   `getDraft` and `update`, and what removing an assignment reports. It creates every row it
 *   reads, so it cannot quietly stop checking because the seed changed shape.
 *
 * This script needs two things: the development database, for the one repository-backed assignment
 * every draft below is built from, and the GitHub App's credentials. Without either it skips, and a
 * skip exits non-zero, because a run that asked GitHub nothing is not a run that passed.
 */
import { createChecker, loadEnvironment } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();

/**
 * The assignment `prisma/seed.ts` creates, named the way the seed names it.
 *
 * Read rather than built, because each check below takes one real draft and changes a single
 * repository field in it. The rest of the draft has to be valid and its repositories have to be
 * ones GitHub can really be asked about, or the finding a check looks for could come from
 * somewhere other than the field it is about.
 *
 * Read from `SEED_TEMPLATE_REPO` with the same default `prisma/seed.ts` uses, because a name
 * written out twice is a name that drifts: this script hard-coded `swe-1-3-node-modules` and went
 * on skipping every check after the seed stopped creating that assignment.
 */
const SEEDED_ASSIGNMENT_REPO_NAME = process.env.SEED_TEMPLATE_REPO ?? "swe-1-4-loops";

async function main() {
  // The environment is already loaded at module scope, which runs before this does.
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { isGithubAppConfigured } = await import("../lib/github/app-client");

  /*
    Unconfigured, `validateAssignmentDraft` records a warning saying the repositories were not
    checked and makes no request at all. Every check below would then be asking about a code path
    that did not run, so this is a skip rather than a run that reports six passes.
  */
  if (!isGithubAppConfigured()) {
    skip(
      "every check here needs the GitHub App, which is not configured in this environment. Set " +
        "GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET and " +
        "GITHUB_APP_INSTALLATION_ID in .env.local — see the GitHub App section of the README.",
    );
    return;
  }

  const seeded = await db.assignment.findFirst({
    where: { assignmentRepoName: SEEDED_ASSIGNMENT_REPO_NAME },
    select: {
      id: true,
      courseId: true,
      kind: true,
      title: true,
      courseUnitId: true,
      answerKeyRepo: true,
      answerKeyDir: true,
      completionThreshold: true,
      templateRepo: true,
      assignmentRepoName: true,
      githubOrg: true,
      templateRef: true,
      runnerPreset: true,
      runnerConfig: true,
      sections: true,
    },
  });

  if (!seeded) {
    skip(
      `every check here builds its draft from the assignment named ` +
        `${SEEDED_ASSIGNMENT_REPO_NAME} (SEED_TEMPLATE_REPO), and this database has no such ` +
        `assignment. Run npm run db:seed.`,
    );
    return;
  }

  // `validateDraft` is a course procedure, so it has to be called as somebody who teaches the
  // course the seeded assignment belongs to.
  const instructor = await db.courseInstructor.findFirst({
    where: { courseId: seeded.courseId },
    select: { userId: true },
  });

  if (!instructor) {
    skip(
      "every check here is made as an instructor of the course the seeded assignment belongs " +
        "to, and that course has no instructor",
    );
    return;
  }

  const asInstructor = createCallerFactory(appRouter)({
    db,
    user: { id: instructor.userId },
  } as never);

  /** The draft an instructor would submit for the seeded assignment. */
  const draftFromSeed = {
    kind: seeded.kind,
    title: seeded.title,
    courseUnitId: seeded.courseUnitId,
    answerKeyRepo: seeded.answerKeyRepo,
    answerKeyDir: seeded.answerKeyDir,
    completionThreshold: seeded.completionThreshold,
    dueAt: null,
    templateRepo: seeded.templateRepo,
    assignmentRepoName: seeded.assignmentRepoName,
    githubOrg: seeded.githubOrg,
    templateRef: seeded.templateRef,
    runnerPreset: seeded.runnerPreset,
    runnerConfig: seeded.runnerConfig,
    sections: seeded.sections,
  };

  // `assignmentId` on every call below excludes the seeded assignment from its own repository
  // name collision, so the only finding a check can see is the one it provoked.

  /*
    A real, readable, public repository that is not a template.

    `octocat/Hello-World` is GitHub's own example repository: it has existed since 2011, it is
    public, and it is not a template. It also proves the reach a public template buys —
    nothing has installed this App on `octocat`, and an installation token reads it anyway.
  */
  const NOT_A_TEMPLATE_REPO = "octocat/Hello-World";

  const badRepo = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, templateRepo: "marcy-lms/does-not-exist-anywhere" },
  });
  check(
    "an unreachable template repository is refused",
    badRepo.findings.some((f) => f.path === "templateRepo" && f.severity === "error"),
    true,
  );

  /*
    A repository that exists and is readable but is not a template.

    Refused here because `generate` refuses it too, at the moment a student presses Accept —
    and with a message about the API rather than about the assignment. `marcy-lms`
    itself is an organization rather than a repository, so this uses one that is genuinely
    an ordinary repository: an easy mistake, since it looks and reads exactly right.
  */
  const notATemplate = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, templateRepo: NOT_A_TEMPLATE_REPO },
  });
  check(
    "a repository that is not a template repository is refused",
    notATemplate.findings.some(
      (f) =>
        f.path === "templateRepo" &&
        f.severity === "error" &&
        f.message.includes("not a template repository"),
    ),
    true,
  );

  /*
    The two answer-key failures that must not be reported as one.

    An organization the App was never installed on and a repository that does not exist both
    answer 404, and they are not the same thing to the person reading the message: one is a
    typo fixed in seconds, the other is an installation nobody can perform from a form. If
    these two messages ever converge, the second reads as the first forever.
  */
  const missingKeyRepo = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: {
      ...draftFromSeed,
      answerKeyRepo: `${seeded.answerKeyRepo!.split("/")[0]}/no-such-answer-keys`,
    },
  });
  const notInstalled = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, answerKeyRepo: "an-org-this-app-is-not-on-xyz/keys" },
  });
  const missingMessage =
    missingKeyRepo.findings.find((f) => f.path === "answerKeyRepo")?.message ?? "";
  const notInstalledMessage =
    notInstalled.findings.find((f) => f.path === "answerKeyRepo")?.message ?? "";

  check(
    "an answer key repository that does not exist is refused",
    missingMessage.includes("Check the name"),
    true,
  );
  check(
    "an organization the App is not installed on says so instead",
    notInstalledMessage.includes("not installed on"),
    true,
  );
  check(
    "the two are told apart rather than reported identically",
    missingMessage !== "" && missingMessage !== notInstalledMessage,
    true,
  );

  /*
    A folder that is not in the repository.

    A warning rather than a refusal, and deliberately: an assignment whose folder has been
    renamed or emptied upstream still grades, with the model reading the code against the
    rubric alone. It is worse and it is not nothing, so it belongs on this screen rather than
    in a report weeks later.
  */
  const badDir = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, answerKeyDir: `${seeded.answerKeyDir}-does-not-exist` },
  });
  check(
    "an answer key folder that is not there is a warning, not a refusal",
    {
      warns: badDir.findings.some((f) => f.severity === "warning" && f.path === "answerKeyDir"),
      canSave: badDir.canSave,
    },
    { warns: true, canSave: true },
  );
}

// Not top-level await: tsx compiles this to CommonJS, which rejects it.
main()
  .then(() => finish())
  .catch((err) => {
    console.error("\n", err);
    process.exit(1);
  });
