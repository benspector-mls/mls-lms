/**
 * Checks the rules that decide what a valid assignment is.
 *
 *   npm run verify:authoring
 *
 * Pure: no database, no network, no model. Every check here is a rule that, if it
 * silently stopped holding, would produce a confidently wrong grade rather than an
 * error — a section with no point value, a test pattern that matches nothing, a
 * repository-backed assignment with no repository. Those are the expensive failures,
 * and they are all cheap to check as functions.
 *
 * The second half is not pure: it drives the tRPC callers against the real database,
 * because authorization is half of what the authoring procedures are and a check that only
 * holds when called through the interface is not a check. Every write it makes happens
 * inside a transaction that is rolled back, so it is safe against live data.
 */
import {
  AssignmentConfigurationError,
  AssignmentKind,
  IMPLEMENTED_KINDS,
  isAiGraded,
  isManualOnly,
  parseAssignmentSpec,
  repositorySource,
  requiresRepository,
  sectionsPointTotal,
  UnsupportedAssignmentKindError,
} from "../lib/assignments/spec";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`); }
  else console.log(`ok   ${label}`);
}

/**
 * What a parse rejected, by field, so a check names the field and not just "threw".
 *
 * An unrecognised key is reported by Zod against the *object* rather than the key, which
 * would make "a manual section may not carry a rubric" and "...may not carry answer keys"
 * indistinguishable — both would read `sections.0`. The offending keys are appended so each
 * check proves the specific field was the one refused.
 */
function rejects(input: unknown): string[] | "accepted" {
  try {
    parseAssignmentSpec(input);
    return "accepted";
  } catch (err) {
    const issues = (err as {
      issues?: { path: (string | number)[]; code?: string; keys?: string[] }[];
    }).issues;
    if (!issues) return [(err as Error).name];
    return issues.map((issue) => {
      const path = issue.path.join(".") || "(root)";
      return issue.keys?.length ? `${path}:${issue.keys.join(",")}` : path;
    });
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : String(err);
}

const RUBRIC = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const codingSection = {
  grading: "ai",
  type: "coding_algorithm",
  pointValue: 30,
  rubricId: RUBRIC,
  answerKeyPaths: ["mod-1-js-fundamentals/swe-1-4-loops/from-scratch.js"],
  reportTemplate: "coding-fluency",
  evidence: "tests",
} as const;

const manualSection = { grading: "manual", label: "Reflection", pointValue: 10 } as const;

const repoSpec = {
  kind: AssignmentKind.REPO,
  title: "swe-1-4-loops",
  moduleTag: "mod-1-js-fundamentals",
  templateRepo: "marcy-lms-test/swe-1-4-loops",
  assignmentRepoName: "swe-1-4-loops",
  githubOrg: "marcy-lms-test",
  runnerPreset: "node-jest",
  sections: [codingSection],
};

// --- the total is derived, never entered --------------------------------------
check("pointValue is the sum of the sections", parseAssignmentSpec(repoSpec).pointValue, 30);
check("two sections sum", sectionsPointTotal([{ pointValue: 15 }, { pointValue: 25 }]), 40);
check("a pointValue on the assignment is refused outright",
  rejects({ ...repoSpec, pointValue: 999 }), ["(root):pointValue"]);
check("a section with no point value is refused",
  rejects({ ...repoSpec, sections: [{ grading: "ai", type: "coding_algorithm", rubricId: RUBRIC }] }),
  ["sections.0.pointValue"]);
check("a zero-point section is refused",
  rejects({ ...repoSpec, sections: [{ ...codingSection, pointValue: 0 }] }),
  ["sections.0.pointValue"]);
check("an assignment with no sections is refused", rejects({ ...repoSpec, sections: [] }), ["sections"]);

// --- sections describe something a rubric covers ------------------------------
check("an unknown section type is refused",
  rejects({ ...repoSpec, sections: [{ ...codingSection, type: "coding_python" }] }),
  ["sections.0.type"]);
check("a section with no rubric is refused",
  rejects({ ...repoSpec, sections: [{ ...codingSection, rubricId: undefined }] }),
  ["sections.0.rubricId"]);
/*
  A pattern with no `evidence: "tests"` is silently ignored, so the section is graded
  with no test evidence at all — the opposite of what naming a pattern means. This is
  the class of mistake the whole module exists for: nothing throws, and the report
  reads as though the tests were consulted.
*/
check("a testNamePattern without evidence:tests is refused",
  rejects({
    ...repoSpec,
    sections: [{ ...codingSection, evidence: undefined, testNamePattern: "^from-scratch" }],
  }),
  ["sections.0.testNamePattern"]);
check("a testNamePattern with evidence:tests is accepted",
  rejects({ ...repoSpec, sections: [{ ...codingSection, testNamePattern: "^from-scratch" }] }),
  "accepted");

// --- how a section is graded --------------------------------------------------
/*
  The two section shapes are deliberately not one shape with optional fields. A manual
  section that could carry a rubricId would eventually carry one that nothing applies, and
  an AI section that could omit its rubric would reach the model with nothing to score
  against. Each check below is one of those two mistakes being refused.
*/
check("a section must say how it is graded",
  rejects({ ...repoSpec, sections: [{ ...codingSection, grading: undefined }] }),
  ["sections.0.grading"]);
check("a manual section is accepted with just a label and points",
  rejects({ ...repoSpec, sections: [manualSection] }), "accepted");
check("a manual section may not carry a rubric",
  rejects({ ...repoSpec, sections: [{ ...manualSection, rubricId: RUBRIC }] }),
  ["sections.0:rubricId"]);
check("a manual section may not carry answer keys",
  rejects({ ...repoSpec, sections: [{ ...manualSection, answerKeyPaths: ["a/b.js"] }] }),
  ["sections.0:answerKeyPaths"]);
check("a manual section may not claim test evidence",
  rejects({ ...repoSpec, sections: [{ ...manualSection, evidence: "tests" }] }),
  ["sections.0:evidence"]);
check("a manual section needs a label",
  rejects({ ...repoSpec, sections: [{ grading: "manual", pointValue: 10 }] }),
  ["sections.0.label"]);
check("a manual section still needs a point value",
  rejects({ ...repoSpec, sections: [{ grading: "manual", label: "Reflection" }] }),
  ["sections.0.pointValue"]);
check("an AI section may not use a label instead of a type",
  rejects({ ...repoSpec, sections: [{ ...codingSection, label: "Whatever" }] }),
  ["sections.0:label"]);

// Mixed is legitimate: a repository assignment can have work the pipeline grades and work
// an instructor scores by hand, and the total is still the sum of both.
check("ai and manual sections can coexist, and both count toward the total",
  parseAssignmentSpec({ ...repoSpec, sections: [codingSection, manualSection] }).pointValue,
  40);
check("isAiGraded splits them",
  parseAssignmentSpec({ ...repoSpec, sections: [codingSection, manualSection] })
    .sections.map(isAiGraded),
  [true, false]);
check("manual-only is detected", isManualOnly([manualSection]), true);
check("a mix is not manual-only", isManualOnly([codingSection, manualSection]), false);
check("no sections is not manual-only", isManualOnly([]), false);

// --- the kind axis ------------------------------------------------------------
check("REPO requires a template repository",
  rejects({ ...repoSpec, templateRepo: undefined }), ["templateRepo"]);
check("REPO requires an org", rejects({ ...repoSpec, githubOrg: undefined }), ["githubOrg"]);
check("a templateRepo that is not owner/repo is refused",
  rejects({ ...repoSpec, templateRepo: "swe-1-4-loops" }), ["templateRepo"]);
check("a repo name with a slash in it is refused",
  rejects({ ...repoSpec, assignmentRepoName: "a/b" }), ["assignmentRepoName"]);
check("an unknown runner preset is refused, and the message names it",
  rejects({ ...repoSpec, runnerPreset: "npx-jest-typo" }), ["runnerPreset"]);
check("the none preset is accepted", rejects({ ...repoSpec, runnerPreset: "none" }), "accepted");

const docSpec = {
  kind: AssignmentKind.GOOGLE_DOC,
  title: "Reflection: what I learned in mod 1",
  moduleTag: "mod-1-js-fundamentals",
  sections: [manualSection],
};

check("a Google Doc assignment needs no repository fields", rejects(docSpec), "accepted");
check("...and its repository fields come out null", (() => {
  const parsed = parseAssignmentSpec(docSpec);
  return [parsed.templateRepo, parsed.assignmentRepoName, parsed.githubOrg];
})(), [null, null, null]);
/*
  No repository means no template to take a suite from, so there is nothing to run.
  Accepting a runner here would produce an assignment that looks like it has test
  evidence and can never have any.
*/
check("a Google Doc assignment may not name a runner",
  rejects({ ...docSpec, runnerPreset: "node-jest" }), ["runnerPreset"]);
check("a Google Doc assignment may not name a repository",
  rejects({ ...docSpec, templateRepo: "marcy-lms-test/whatever" }), ["templateRepo"]);
check("an unknown kind is refused", rejects({ ...repoSpec, kind: "SLACK_MESSAGE" }), ["kind"]);

// --- narrowing at the point of use -------------------------------------------
check("REPO requires a repository", requiresRepository(AssignmentKind.REPO), true);
check("GOOGLE_DOC does not", requiresRepository(AssignmentKind.GOOGLE_DOC), false);
check("only REPO is implemented today", [...IMPLEMENTED_KINDS], [AssignmentKind.REPO]);

check("repositorySource narrows a REPO row",
  repositorySource({
    kind: AssignmentKind.REPO,
    templateRepo: "marcy-lms-test/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: "marcy-lms-test",
    templateRef: null,
  }),
  {
    templateRepo: "marcy-lms-test/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: "marcy-lms-test",
    templateRef: null,
  });

/*
  Two failures that must not be reported as one another. A Google Doc assignment is a
  feature that does not exist; a REPO assignment with no org is a row that should never
  have been written. An instructor can act on the second and not on the first.
*/
let unsupported = "";
try {
  repositorySource({
    kind: AssignmentKind.GOOGLE_DOC,
    templateRepo: null,
    assignmentRepoName: null,
    githubOrg: null,
  });
} catch (err) { unsupported = errName(err); }
check("an unimplemented kind throws UnsupportedAssignmentKindError",
  unsupported, new UnsupportedAssignmentKindError(AssignmentKind.GOOGLE_DOC).name);

let misconfigured = "", misconfiguredMessage = "";
try {
  repositorySource({
    kind: AssignmentKind.REPO,
    templateRepo: "marcy-lms-test/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: null,
  });
} catch (err) {
  misconfigured = errName(err);
  misconfiguredMessage = err instanceof Error ? err.message : "";
}
check("a REPO row missing a column throws AssignmentConfigurationError",
  misconfigured, new AssignmentConfigurationError("").name);
check("...and the message names the missing column",
  misconfiguredMessage.includes("githubOrg"), true);

// =====================================================================================
// The procedures, against the real database.
//
// Everything above is pure. What follows drives the tRPC callers, because authorization is
// half of what these procedures are: a check that only holds when called through the
// interface is not a check. Every write happens inside a transaction that is rolled back,
// so this can run against live data without harming any of it.
//
// The strongest check here is the first: authoring `swe-1-3-node-modules` through `create`
// and diffing the row against what `prisma/seed.ts` produces. That assignment already
// grades correctly end to end, so an identical row proves the authoring path produces
// grading-correct output rather than merely well-formed output.
// =====================================================================================

async function procedures() {
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ quiet: true });

  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  const seeded = await db.assignment.findFirst({
    where: { assignmentRepoName: "swe-1-3-node-modules" },
    select: {
      id: true, courseId: true, kind: true, title: true, moduleTag: true, pointValue: true,
      completionThreshold: true, templateRepo: true, assignmentRepoName: true, githubOrg: true,
      templateRef: true, runnerPreset: true, runnerConfig: true, sections: true,
      distributedAt: true,
    },
  });

  if (!seeded) {
    console.log("\nskip the procedure checks — swe-1-3-node-modules is not seeded");
    return;
  }

  const instructor = await db.courseInstructor.findFirst({
    where: { courseId: seeded.courseId },
    select: { userId: true },
  });
  const student = await db.enrollment.findFirst({
    where: { courseId: seeded.courseId, status: "ACTIVE" },
    select: { studentId: true },
  });
  if (!instructor || !student) {
    console.log("\nskip the procedure checks — the seeded course has no instructor or student");
    return;
  }

  const createCaller = createCallerFactory(appRouter);
  const asInstructor = createCaller({ db, user: { id: instructor.userId } } as never);
  const asStudent = createCaller({ db, user: { id: student.studentId } } as never);

  /** The draft an instructor would submit for the seeded assignment. */
  const draftFromSeed = {
    kind: seeded.kind,
    title: seeded.title,
    moduleTag: seeded.moduleTag,
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

  // --- validateDraft ---------------------------------------------------------
  const valid = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: draftFromSeed,
  });
  check("the seeded assignment validates as a draft",
    { canSave: valid.canSave, points: valid.pointValue, errors: valid.findings.filter((f) => f.severity === "error") },
    { canSave: true, points: seeded.pointValue, errors: [] });

  // Without excluding itself, its own repository name is a collision.
  const collides = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    draft: draftFromSeed,
  });
  check("a colliding repository name is refused",
    collides.findings.some((f) => f.path === "assignmentRepoName" && f.severity === "error"),
    true);

  const badModule = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, moduleTag: "mod-99-not-in-this-course" },
  });
  check("a module tag outside the course is refused",
    badModule.findings.some((f) => f.path === "moduleTag" && f.severity === "error"), true);

  const badRepo = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, templateRepo: "marcy-lms-test/does-not-exist-anywhere" },
  });
  check("an unreachable template repository is refused",
    badRepo.findings.some((f) => f.path === "templateRepo" && f.severity === "error"), true);

  const badKey = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: {
      ...draftFromSeed,
      sections: (seeded.sections as { answerKeyPaths?: string[] }[]).map((s) => ({
        ...s, answerKeyPaths: ["mod-1-js-fundamentals/swe-1-3-node-modules/typo.js"],
      })),
    },
  });
  check("a mistyped answer key is a warning, not a refusal",
    {
      warns: badKey.findings.some((f) => f.severity === "warning" && f.message.includes("typo.js")),
      canSave: badKey.canSave,
    },
    { warns: true, canSave: true });

  // The rubric pairing, which nothing else would catch: a plausible report against
  // criteria that do not apply to the work.
  const wrongRubric = await db.rubric.findFirst({
    where: { name: "SHORT_RESPONSE" }, select: { id: true },
  });
  if (wrongRubric) {
    const mismatched = await asInstructor.assignments.validateDraft({
      courseId: seeded.courseId,
      assignmentId: seeded.id,
      draft: {
        ...draftFromSeed,
        sections: (seeded.sections as object[]).map((s) => ({ ...s, rubricId: wrongRubric.id })),
      },
    });
    check("a coding section graded against the short response rubric is refused",
      mismatched.findings.some((f) => f.path.endsWith("rubricId") && f.severity === "error"), true);
  }

  // --- authorization ---------------------------------------------------------
  async function refused(label: string, run: () => Promise<unknown>) {
    try {
      await run();
      check(label, "allowed", "FORBIDDEN");
    } catch (err) {
      check(label, (err as { code?: string }).code ?? String(err), "FORBIDDEN");
    }
  }

  await refused("a student cannot validate a draft", () =>
    asStudent.assignments.validateDraft({ courseId: seeded.courseId, draft: draftFromSeed }));
  await refused("a student cannot create an assignment", () =>
    asStudent.assignments.create({ courseId: seeded.courseId, draft: draftFromSeed }));
  await refused("a student cannot remove an assignment", () =>
    asStudent.assignments.remove({ assignmentId: seeded.id, confirmTitle: seeded.title }));

  const otherCourse = await db.course.findFirst({
    where: { id: { not: seeded.courseId } }, select: { id: true },
  });
  if (otherCourse) {
    const outsider = await db.courseInstructor.findFirst({
      where: { courseId: otherCourse.id, userId: { not: instructor.userId } },
      select: { userId: true },
    });
    if (outsider) {
      const asOutsider = createCaller({ db, user: { id: outsider.userId } } as never);
      await refused("an instructor who does not teach the course cannot author in it", () =>
        asOutsider.assignments.create({ courseId: seeded.courseId, draft: draftFromSeed }));
    }
  }

  // --- create, diffed against the seed --------------------------------------
  try {
    await db.$transaction(async (tx) => {
      const inTx = createCaller({ db: tx, user: { id: instructor.userId } } as never);

      const { assignment } = await inTx.assignments.create({
        courseId: seeded.courseId,
        draft: { ...draftFromSeed, assignmentRepoName: "swe-1-3-node-modules-authored" },
      });

      const authored = await tx.assignment.findUnique({
        where: { id: assignment.id },
        select: {
          kind: true, title: true, moduleTag: true, pointValue: true, completionThreshold: true,
          templateRepo: true, githubOrg: true, templateRef: true, runnerPreset: true,
          runnerConfig: true, sections: true, distributedAt: true,
        },
      });

      // Everything the seed writes, except the two that are deliberately different: the
      // repository name was changed to avoid the collision, and an authored assignment
      // starts unpublished where the seed publishes immediately.
      check("an authored row matches the seeded one field for field",
        {
          kind: authored?.kind, title: authored?.title, moduleTag: authored?.moduleTag,
          pointValue: authored?.pointValue, completionThreshold: authored?.completionThreshold,
          templateRepo: authored?.templateRepo, githubOrg: authored?.githubOrg,
          templateRef: authored?.templateRef, runnerPreset: authored?.runnerPreset,
          runnerConfig: authored?.runnerConfig, sections: authored?.sections,
        },
        {
          kind: seeded.kind, title: seeded.title, moduleTag: seeded.moduleTag,
          pointValue: seeded.pointValue, completionThreshold: seeded.completionThreshold,
          templateRepo: seeded.templateRepo, githubOrg: seeded.githubOrg,
          templateRef: seeded.templateRef, runnerPreset: seeded.runnerPreset,
          runnerConfig: seeded.runnerConfig, sections: seeded.sections,
        });
      check("an authored assignment starts unpublished", authored?.distributedAt, null);

      // --- publish, and what a student can see -------------------------------
      const asStudentInTx = createCaller({ db: tx, user: { id: student.studentId } } as never);

      const hiddenFromStudent = await asStudentInTx.assignments.listForCourse({
        courseId: seeded.courseId,
      });
      check("an unpublished assignment is invisible to a student",
        hiddenFromStudent.some((a) => a.id === assignment.id), false);

      const visibleToInstructor = await inTx.assignments.listForCourse({
        courseId: seeded.courseId,
      });
      check("...and visible to an instructor",
        visibleToInstructor.some((a) => a.id === assignment.id), true);

      await inTx.assignments.publish({ assignmentId: assignment.id });
      const afterPublish = await asStudentInTx.assignments.listForCourse({
        courseId: seeded.courseId,
      });
      check("publishing makes it visible to a student",
        afterPublish.some((a) => a.id === assignment.id), true);

      await inTx.assignments.unpublish({ assignmentId: assignment.id });
      const afterUnpublish = await asStudentInTx.assignments.listForCourse({
        courseId: seeded.courseId,
      });
      check("unpublishing hides it again",
        afterUnpublish.some((a) => a.id === assignment.id), false);

      // --- update ------------------------------------------------------------
      const updated = await inTx.assignments.update({
        assignmentId: assignment.id,
        draft: { ...draftFromSeed, assignmentRepoName: "swe-1-3-node-modules-authored", title: "Renamed" },
      });
      check("update writes the new title", updated.assignment.title, "Renamed");

      // The rename guard applies to the seeded assignment, which has real submissions.
      let renameRefused = "";
      try {
        await inTx.assignments.update({
          assignmentId: seeded.id,
          draft: { ...draftFromSeed, assignmentRepoName: "renamed-out-from-under-students" },
        });
      } catch (err) {
        renameRefused = (err as { code?: string }).code ?? String(err);
      }
      check("renaming an assignment students have accepted is refused",
        renameRefused, "PRECONDITION_FAILED");

      // --- duplicate ---------------------------------------------------------
      const copy = await inTx.assignments.duplicate({
        assignmentId: seeded.id,
        targetCourseId: seeded.courseId,
        assignmentRepoName: "swe-1-3-node-modules-copy",
      });
      check("a duplicate carries the same sections",
        JSON.stringify(
          (await tx.assignment.findUnique({
            where: { id: copy.assignment.id }, select: { sections: true },
          }))?.sections,
        ),
        JSON.stringify(seeded.sections));
      check("a duplicate starts unpublished", copy.assignment.distributedAt, null);

      let dupCollision = "";
      try {
        await inTx.assignments.duplicate({
          assignmentId: seeded.id,
          targetCourseId: seeded.courseId,
          assignmentRepoName: seeded.assignmentRepoName!,
        });
      } catch (err) {
        dupCollision = (err as { code?: string }).code ?? String(err);
      }
      check("a duplicate colliding with an existing repository name is refused",
        dupCollision, "BAD_REQUEST");

      // --- removalImpact and remove -----------------------------------------
      const impact = await inTx.assignments.removalImpact({ assignmentId: seeded.id });
      check("removalImpact counts the submissions that exist",
        impact.submissions > 0 && impact.title === seeded.title, true);

      let wrongTitle = "";
      try {
        await inTx.assignments.remove({ assignmentId: seeded.id, confirmTitle: "not the title" });
      } catch (err) {
        wrongTitle = (err as { code?: string }).code ?? String(err);
      }
      // Called directly rather than through a dialog, which is the whole point of the
      // check living in the procedure.
      check("remove refuses when the typed title does not match", wrongTitle, "BAD_REQUEST");

      const removed = await inTx.assignments.remove({
        assignmentId: seeded.id,
        confirmTitle: seeded.title,
      });
      check("what remove reports matches what removalImpact predicted",
        { submissions: removed.submissions, drafts: removed.drafts, testRuns: removed.testRuns },
        { submissions: impact.submissions, drafts: impact.drafts, testRuns: impact.testRuns });
      check("student repositories are reported rather than deleted",
        removed.orphanedRepositories.length, impact.orphanedRepositories.length);
      check("the assignment is gone",
        await tx.assignment.findUnique({ where: { id: seeded.id }, select: { id: true } }), null);

      throw new Error("ROLLBACK");
    }, { timeout: 30_000 });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  // Nothing above survived.
  const stillThere = await db.assignment.findUnique({
    where: { id: seeded.id }, select: { title: true, distributedAt: true },
  });
  check("the rollback left the seeded assignment untouched",
    { title: stillThere?.title, published: stillThere?.distributedAt !== null },
    { title: seeded.title, published: seeded.distributedAt !== null });
  check("no authored rows survived the rollback",
    await db.assignment.count({ where: { assignmentRepoName: { contains: "-authored" } } }), 0);
}

// Not top-level await: tsx compiles this to CommonJS, which rejects it.
procedures()
  .then(() => {
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("\n", err);
    process.exit(1);
  });
