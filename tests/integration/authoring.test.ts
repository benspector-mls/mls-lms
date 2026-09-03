/**
 * The authoring procedures, driven through tRPC callers against the real database.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * The pure half of `verify:authoring` — the rules that decide what a valid assignment is — is
 * `tests/lib/assignments/spec.test.ts`, where it needs no database and runs on every save. What is
 * left is the half a database is required for, and much of it is authorization: a check that only
 * holds when called through the interface is not a check, because a student who cannot reach
 * `create` is a fact about the procedure rather than about the schema.
 *
 * Every write happens inside a transaction that is rolled back, and every row read here was written
 * by the same transaction, so this depends on nothing having been seeded.
 *
 * **The script created its submission outside its transaction and deleted it in a `finally`,
 * because `getDraft` was reached through a caller bound to the root client and would not have seen
 * a row written inside one.** Every caller here is built on the group's own `tx`, so a submission
 * created inside the transaction is visible to the procedure and is discarded by the rollback. The
 * two housekeeping checks that went with that arrangement — that the script's own program, course
 * and submission were gone again — have nothing left to describe, and the last group below makes
 * the claim that replaces them.
 *
 * **What is not here: the six checks that need a real GitHub round trip.** `validateAssignmentDraft`
 * reads the template repository, asks whether the App is installed on the answer key repository's
 * owner, and lists the answer key folder, so "an unreachable template repository is refused", "a
 * repository that is not a template repository is refused", the two answer-key failures that must
 * not be reported as one another, the check that tells them apart, and the missing-folder warning
 * are all assertions about GitHub's answers rather than about this application. They stay in
 * `scripts/verify-authoring.ts`, which is run on purpose against a configured deployment.
 *
 * **Three checks are stronger here than they were in the script**, because the fixture is built
 * rather than found. The submission count and the removal impact are compared against the exact
 * number of submissions this suite handed in rather than against "more than none"; the submission
 * carries a repository name, so "student repositories are reported rather than deleted" compares
 * two non-empty lists instead of two empty ones; and the instructor who does not teach the course
 * is created here, where the script looked for one, found none on a seeded database, and printed a
 * line that counted as neither a pass nor a failure.
 */
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  addInstructor,
  makeAccount,
  makeCourse,
  makeProgram,
  makeSubmission,
  makeUnit,
  makeWorld,
  type World,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

/*
  The GitHub App's credentials, put out of reach for the length of this file.

  `validateAssignmentDraft` reads the template and the answer key repository over the network
  whenever `isGithubAppConfigured()` is true, which on a machine with a filled-in `.env.local` it
  is. That would make every repository-backed draft below depend on GitHub answering, and on the
  fixture naming repositories that really exist — neither of which a suite against a disposable
  local database can promise. Unconfigured, the same code path records a warning saying the
  repositories were not checked, which does not block saving; the checks that are genuinely about
  GitHub's answers stay in the script.

  Restored afterwards because `maxWorkers: 1` puts every test file in one process, so a variable
  deleted here would otherwise be missing from whatever runs next.
*/
const GITHUB_APP_VARIABLES = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_APP_INSTALLATION_ID",
] as const;

const githubAppCredentials = GITHUB_APP_VARIABLES.map((name) => [name, process.env[name]] as const);
for (const [name] of githubAppCredentials) delete process.env[name];

afterAll(() => {
  for (const [name, value] of githubAppCredentials) {
    if (value !== undefined) process.env[name] = value;
  }
});

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/**
 * What a call refused with, as a string to compare against.
 *
 * The literal `"accepted"` is what comes back when the call did *not* refuse, which is what makes a
 * missing guard a visible failure rather than a passing test.
 */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/**
 * The marker every row this run creates carries, for the last group to look for afterwards.
 *
 * A unique suffix because the development Supabase project is shared, and a fixed title could
 * collide with an assignment somebody actually authored.
 */
const suffix = crypto.randomUUID().slice(0, 8);
const MARKER = `Integration Authoring ${suffix}`;

/** Every submission this run hands in, so the last group can say none of them survived. */
const submissionsMade: string[] = [];

/**
 * The columns of a repository-backed assignment, written straight to the table.
 *
 * **This is the row the `create` check diffs against, and writing it directly is the point of it.**
 * A row authored through `create` and then compared against another row `create` produced would
 * prove only that `create` is deterministic. The reference has to come from a second, independent
 * path, and writing the columns out is the one available to a suite that seeds nothing.
 *
 * Its sections are graded by hand rather than by the model. That keeps `validateAssignmentDraft`
 * away from the answer key folder — which it reads over the network for an AI-graded section — so
 * every group below depends on the database alone. The one group that needs an AI section builds
 * the draft itself.
 */
function referenceColumns(courseUnitId: string, title: string) {
  return {
    kind: "REPO" as const,
    title,
    courseUnitId,
    pointValue: 30,
    completionThreshold: 0.75,
    dueAt: null,
    templateRepo: "marcy-lms/swe-1-4-loops",
    answerKeyRepo: "The-Marcy-Lab-School/swe-assignment-grading-guides",
    answerKeyDir: "answer-keys/mod-1-js-fundamentals/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: "marcy-lms",
    templateRef: null,
    runnerPreset: "node-jest",
    templateDriveUrl: null,
    studentMayMarkDone: null,
    submissionInstructions: null,
    sections: [{ grading: "manual", label: "Overall", pointValue: 30 }] as Prisma.InputJsonValue,
  };
}

/** The columns the `create` and `update` checks compare, in one list so both compare the same set. */
const comparedColumns = {
  kind: true,
  title: true,
  answerKeyRepo: true,
  answerKeyDir: true,
  pointValue: true,
  completionThreshold: true,
  templateRepo: true,
  githubOrg: true,
  templateRef: true,
  runnerPreset: true,
  runnerConfig: true,
  sections: true,
  templateDriveUrl: true,
  submissionInstructions: true,
} as const;

/** What a group works with: a course, the people in it, and one assignment already in the table. */
type Authoring = {
  world: World;
  assignmentId: string;
  title: string;
  /** The draft an instructor would submit for that assignment, as the form would send it. */
  draft: Record<string, unknown>;
};

/**
 * A program with a course, an instructor, a fellow, and one repository-backed assignment.
 *
 * Built per group rather than once for the file, because each group holds its own transaction and a
 * row written in one is invisible to the next.
 */
async function makeAuthoring(tx: Tx, options: { published?: boolean } = {}): Promise<Authoring> {
  const world = await makeWorld(tx, { students: 1 });
  const title = `${MARKER} reference`;

  const assignment = await tx.assignment.create({
    data: {
      courseId: world.courseId,
      distributedAt: options.published === false ? null : new Date("2026-01-02T09:00:00Z"),
      ...referenceColumns(world.unitId, title),
    },
    select: { id: true },
  });

  const columns = referenceColumns(world.unitId, title);

  return {
    world,
    assignmentId: assignment.id,
    title,
    draft: {
      kind: columns.kind,
      title: columns.title,
      courseUnitId: columns.courseUnitId,
      answerKeyRepo: columns.answerKeyRepo,
      answerKeyDir: columns.answerKeyDir,
      completionThreshold: columns.completionThreshold,
      dueAt: null,
      templateRepo: columns.templateRepo,
      assignmentRepoName: columns.assignmentRepoName,
      githubOrg: columns.githubOrg,
      templateRef: columns.templateRef,
      runnerPreset: columns.runnerPreset,
      runnerConfig: null,
      sections: columns.sections,
    },
  };
}

/** One fellow's work on an assignment, recorded so the last group can say it did not survive. */
async function handIn(tx: Tx, assignmentId: string, studentId: string, repoFullName?: string) {
  const submission = await makeSubmission(tx, { assignmentId, studentId, status: "SUBMITTED" });
  if (repoFullName) {
    await tx.submission.update({ where: { id: submission.id }, data: { repoFullName } });
  }
  submissionsMade.push(submission.id);
  return submission;
}

describe("validating a draft", () => {
  const tx = withRollback();

  let fixture: Authoring;
  /** A module of a second course of the same program, which no draft in this course may name. */
  let elsewhereModule: { id: string };
  /** The rubric a short response is graded against, which a coding section may not be given. */
  let shortResponseRubric: { id: string };

  const asInstructor = () => createCaller(tx(), fixture.world.instructorId);
  const validate = (draft: unknown, assignmentId?: string) =>
    asInstructor().assignments.validateDraft({
      courseId: fixture.world.courseId,
      assignmentId,
      draft,
    });

  beforeAll(async () => {
    fixture = await makeAuthoring(tx());

    const otherCourse = await makeCourse(tx(), { programId: fixture.world.programId });
    elsewhereModule = await makeUnit(tx(), {
      courseId: otherCourse.id,
      name: `${MARKER} elsewhere`,
    });

    /*
      Looked up before it is created, because `Rubric.name` is unique across the whole database:
      the disposable local database holds none, and the development Supabase project holds all
      four.
    */
    shortResponseRubric =
      (await tx().rubric.findUnique({ where: { name: "SHORT_RESPONSE" }, select: { id: true } })) ??
      (await tx().rubric.create({
        data: { name: "SHORT_RESPONSE", scaleType: "SHORT_RESPONSE", maxScore: 4 },
        select: { id: true },
      }));
  });

  it("the reference assignment validates as a draft", async () => {
    const valid = await validate(fixture.draft, fixture.assignmentId);

    expect({
      canSave: valid.canSave,
      points: valid.pointValue,
      errors: valid.findings.filter((finding) => finding.severity === "error"),
    }).toEqual({ canSave: true, points: 30, errors: [] });
  });

  // Without excluding itself, its own repository name is a collision.
  it("a colliding repository name is refused", async () => {
    const collides = await validate(fixture.draft);

    expect(
      collides.findings.some(
        (finding) => finding.path === "assignmentRepoName" && finding.severity === "error",
      ),
    ).toBe(true);
  });

  /*
    A module that does not exist at all, which the foreign key would also refuse — but as a
    constraint violation reaching an instructor as an error rather than as a finding on the field.
  */
  it("a module that does not exist is refused", async () => {
    const missing = await validate(
      { ...fixture.draft, courseUnitId: "e7c1a1d0-0000-4000-8000-0000000000ff" },
      fixture.assignmentId,
    );

    expect(
      missing.findings.some(
        (finding) => finding.path === "courseUnitId" && finding.severity === "error",
      ),
    ).toBe(true);
  });

  /*
    And a module of a *different* course, which is the failure nothing at the database level
    catches: the foreign key says the module exists, not that it belongs here. Without this an
    assignment could be filed under another course's module and appear in neither one.

    The second course belongs to the same program and the same instructor teaches it, so the
    refusal is demonstrably about the course the module belongs to rather than about what the
    instructor is allowed to touch.
  */
  it("a module belonging to another course is refused", async () => {
    const crossCourse = await validate(
      { ...fixture.draft, courseUnitId: elsewhereModule.id },
      fixture.assignmentId,
    );

    expect(
      crossCourse.findings.some(
        (finding) => finding.path === "courseUnitId" && finding.severity === "error",
      ),
    ).toBe(true);
  });

  /*
    A pasted URL and a typed owner/repo are the same field.

    Checked through the procedure rather than only against the parser, because the normalization has
    to happen before validation reads the value — a draft carrying a URL must pass exactly as one
    carrying owner/repo does, or the form would have to normalize it first and the server's rule
    would be the second implementation.
  */
  it("both repositories may be given as pasted URLs", async () => {
    const pastedUrls = await validate(
      {
        ...fixture.draft,
        templateRepo: `https://github.com/${fixture.draft.templateRepo}`,
        answerKeyRepo: `https://github.com/${fixture.draft.answerKeyRepo}.git`,
      },
      fixture.assignmentId,
    );

    expect(pastedUrls.canSave).toBe(true);
  });

  // The rubric pairing, which nothing else would catch: a plausible report against criteria that do
  // not apply to the work.
  it("a coding section graded against the short response rubric is refused", async () => {
    const mismatched = await validate(
      {
        ...fixture.draft,
        sections: [
          {
            grading: "ai",
            type: "coding_algorithm",
            pointValue: 30,
            rubricId: shortResponseRubric.id,
          },
        ],
      },
      fixture.assignmentId,
    );

    expect(
      mismatched.findings.some(
        (finding) => finding.path.endsWith("rubricId") && finding.severity === "error",
      ),
    ).toBe(true);
  });
});

/*
  The round trip the edit screen depends on.

  `getDraft` is what fills the form and `update` is what it submits, so those two shapes have to
  agree exactly. If they do not, editing an assignment to change one field would fail — or worse,
  silently rewrite the section mapping — and nothing in the pure checks would notice, because the
  shapes only meet at this seam. Loading a draft and saving it back with no changes must be valid
  and must not alter the row.
*/
describe("loading a draft and saving it back unchanged", () => {
  const tx = withRollback();

  let fixture: Authoring;
  /** What `getDraft` returned, in the shape `update` takes. */
  let roundTrip: Record<string, unknown>;
  let loaded: { submissionCount: number };

  const asInstructor = () => createCaller(tx(), fixture.world.instructorId);

  beforeAll(async () => {
    fixture = await makeAuthoring(tx());
    await handIn(tx(), fixture.assignmentId, fixture.world.student.studentId);

    loaded = await asInstructor().assignments.getDraft({ assignmentId: fixture.assignmentId });
    const draft = loaded as Record<string, unknown>;

    roundTrip = {
      kind: draft.kind,
      title: draft.title,
      courseUnitId: draft.courseUnitId,
      answerKeyRepo: draft.answerKeyRepo,
      answerKeyDir: draft.answerKeyDir,
      completionThreshold: draft.completionThreshold,
      dueAt: draft.dueAt,
      templateRepo: draft.templateRepo,
      assignmentRepoName: draft.assignmentRepoName,
      githubOrg: draft.githubOrg,
      templateRef: draft.templateRef,
      runnerPreset: draft.runnerPreset,
      runnerConfig: draft.runnerConfig,
      templateDriveUrl: draft.templateDriveUrl,
      submissionInstructions: draft.submissionInstructions,
      sections: draft.sections,
    };
  });

  it("what getDraft returns is a draft that validateDraft accepts", async () => {
    const valid = await asInstructor().assignments.validateDraft({
      courseId: fixture.world.courseId,
      assignmentId: fixture.assignmentId,
      draft: roundTrip,
    });

    expect({ canSave: valid.canSave, points: valid.pointValue }).toEqual({
      canSave: true,
      points: 30,
    });
  });

  it("getDraft reports how many students have accepted", () => {
    expect(loaded.submissionCount).toBe(1);
  });

  it("saving a loaded draft unchanged leaves every column as it was", async () => {
    const before = await tx().assignment.findUnique({
      where: { id: fixture.assignmentId },
      select: comparedColumns,
    });

    await asInstructor().assignments.update({
      assignmentId: fixture.assignmentId,
      draft: roundTrip,
    });

    const after = await tx().assignment.findUnique({
      where: { id: fixture.assignmentId },
      select: comparedColumns,
    });

    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

describe("who may author", () => {
  const tx = withRollback();

  let fixture: Authoring;
  /** Somebody holding the INSTRUCTOR role who teaches no course of this program. */
  let outsiderId: string;

  const asStudent = () => createCaller(tx(), fixture.world.student.studentId);

  beforeAll(async () => {
    fixture = await makeAuthoring(tx());

    /*
      Built here rather than looked for. The script asked the database for an INSTRUCTOR teaching no
      course of this program, found none on a seeded database, and printed a line saying so — so the
      last check in this group had not been running at all.
    */
    const otherProgram = await makeProgram(tx(), { name: `${MARKER} elsewhere` });
    outsiderId = await makeAccount(tx(), { role: "INSTRUCTOR" });
    await addInstructor(tx(), { programId: otherProgram.id, userId: outsiderId });
  });

  it("a student cannot validate a draft", async () => {
    const code = await refusal(() =>
      asStudent().assignments.validateDraft({
        courseId: fixture.world.courseId,
        draft: fixture.draft,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("a student cannot create an assignment", async () => {
    const code = await refusal(() =>
      asStudent().assignments.create({
        courseId: fixture.world.courseId,
        draft: fixture.draft,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("a student cannot remove an assignment", async () => {
    const code = await refusal(() =>
      asStudent().assignments.remove({
        assignmentId: fixture.assignmentId,
        confirmTitle: fixture.title,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  /*
    The INSTRUCTOR role says nothing about *which* programs, so without this one term's instructor
    could author in another term's course.
  */
  it("an instructor who does not teach the course cannot author in it", async () => {
    const code = await refusal(() =>
      createCaller(tx(), outsiderId).assignments.create({
        courseId: fixture.world.courseId,
        draft: fixture.draft,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

describe("creating one through the procedure", () => {
  const tx = withRollback();

  let fixture: Authoring;
  /** The row `create` wrote, in the columns the reference row is compared against. */
  let authored: Record<string, unknown> | null;
  let distributedAt: Date | null = null;

  beforeAll(async () => {
    fixture = await makeAuthoring(tx());

    const { assignment } = await createCaller(tx(), fixture.world.instructorId).assignments.create({
      courseId: fixture.world.courseId,
      draft: { ...fixture.draft, assignmentRepoName: "swe-1-4-loops-authored" },
    });

    const row = await tx().assignment.findUnique({
      where: { id: assignment.id },
      select: { ...comparedColumns, distributedAt: true },
    });

    const { distributedAt: published, ...rest } = row!;
    authored = rest;
    distributedAt = published;
  });

  /*
    Every column the reference row holds, except the two that are deliberately different: the
    repository name was changed to avoid the collision, and an authored assignment starts
    unpublished where the reference row is published.
  */
  it("an authored row matches the reference one field for field", async () => {
    const reference = await tx().assignment.findUnique({
      where: { id: fixture.assignmentId },
      select: comparedColumns,
    });

    expect(JSON.stringify(authored)).toBe(JSON.stringify(reference));
  });

  it("an authored assignment starts unpublished", () => {
    expect(distributedAt).toBeNull();
  });
});

describe("publishing, and what a student can see", () => {
  const tx = withRollback();

  let fixture: Authoring;
  let assignmentId: string;

  const asInstructor = () => createCaller(tx(), fixture.world.instructorId);
  const asStudent = () => createCaller(tx(), fixture.world.student.studentId);
  const studentSees = async () =>
    (await asStudent().assignments.listForCourse({ courseId: fixture.world.courseId })).some(
      (row) => row.id === assignmentId,
    );

  beforeAll(async () => {
    fixture = await makeAuthoring(tx());
    const { assignment } = await asInstructor().assignments.create({
      courseId: fixture.world.courseId,
      draft: { ...fixture.draft, assignmentRepoName: "swe-1-4-loops-authored" },
    });
    assignmentId = assignment.id;
  });

  it("an unpublished assignment is invisible to a student", async () => {
    expect(await studentSees()).toBe(false);
  });

  it("...and visible to an instructor", async () => {
    const listed = await asInstructor().assignments.listForCourse({
      courseId: fixture.world.courseId,
    });
    expect(listed.some((row) => row.id === assignmentId)).toBe(true);
  });

  it("publishing makes it visible to a student", async () => {
    await asInstructor().assignments.publish({ assignmentId });
    expect(await studentSees()).toBe(true);
  });

  it("unpublishing hides it again", async () => {
    await asInstructor().assignments.unpublish({ assignmentId });
    expect(await studentSees()).toBe(false);
  });
});

describe("editing one", () => {
  const tx = withRollback();

  let fixture: Authoring;
  /** A second assignment nobody has accepted, so a rename is only refused where it should be. */
  let untouchedId: string;

  const asInstructor = () => createCaller(tx(), fixture.world.instructorId);

  beforeAll(async () => {
    fixture = await makeAuthoring(tx());
    await handIn(tx(), fixture.assignmentId, fixture.world.student.studentId);

    const { assignment } = await asInstructor().assignments.create({
      courseId: fixture.world.courseId,
      draft: { ...fixture.draft, assignmentRepoName: "swe-1-4-loops-authored" },
    });
    untouchedId = assignment.id;
  });

  it("update writes the new title", async () => {
    const updated = await asInstructor().assignments.update({
      assignmentId: untouchedId,
      draft: {
        ...fixture.draft,
        assignmentRepoName: "swe-1-4-loops-authored",
        title: `${MARKER} renamed`,
      },
    });

    expect(updated.assignment.title).toBe(`${MARKER} renamed`);
  });

  /*
    Renaming the repository is refused once anybody holds a repository under the old name, because
    renaming it here would not rename theirs and every later lookup would miss. The reference
    assignment is the one somebody has accepted.
  */
  it("renaming an assignment students have accepted is refused", async () => {
    const code = await refusal(() =>
      asInstructor().assignments.update({
        assignmentId: fixture.assignmentId,
        draft: { ...fixture.draft, assignmentRepoName: "renamed-out-from-under-students" },
      }),
    );

    expect(code).toBe("PRECONDITION_FAILED");
  });
});

/*
  A copy beside the original, with no name given.

  The interface used to supply one built out of the assignment's human title, which is not a legal
  repository name the moment a title contains a space — so the one menu item that needed a name was
  the one that could not produce one. Derived in the procedure now, and checked twice because the
  second copy is where a fixed `-copy` suffix would collide with the first.
*/
describe("copying one beside the original", () => {
  const tx = withRollback();

  let fixture: Authoring;

  const asInstructor = () => createCaller(tx(), fixture.world.instructorId);
  const copy = (assignmentRepoName?: string) =>
    asInstructor().assignments.duplicate({
      assignmentId: fixture.assignmentId,
      targetCourseId: fixture.world.courseId,
      assignmentRepoName,
    });

  beforeAll(async () => {
    fixture = await makeAuthoring(tx());
  });

  it("a copy beside the original is given a repository name of its own", async () => {
    expect((await copy()).assignment.assignmentRepoName).toBe("swe-1-4-loops-copy");
  });

  it("...and a second one does not collide with the first", async () => {
    expect((await copy()).assignment.assignmentRepoName).toBe("swe-1-4-loops-copy-2");
  });

  /*
    A name given rather than derived, which is still allowed: the derivation above is the default,
    not the only way in. Deliberately not `-copy`, which the two copies above have taken — a check
    that collides with the fixture beside it is measuring the fixture.
  */
  it("a duplicate carries the same sections", async () => {
    const named = await copy("swe-1-4-loops-named-by-hand");
    const sections = await tx().assignment.findUnique({
      where: { id: named.assignment.id },
      select: { sections: true },
    });

    // Structural rather than textual, because the copy goes through the schema and comes back with
    // its keys in the schema's order rather than in the order the reference row was written in.
    expect(sections?.sections).toEqual(
      referenceColumns(fixture.world.unitId, fixture.title).sections,
    );
  });

  it("a duplicate starts unpublished", async () => {
    const named = await copy("swe-1-4-loops-named-again");
    expect(named.assignment.distributedAt).toBeNull();
  });

  it("a duplicate colliding with an existing repository name is refused", async () => {
    expect(await refusal(() => copy("swe-1-4-loops"))).toBe("BAD_REQUEST");
  });
});

/*
  Copying into another course, which is what `duplicate` was actually written for.

  What these checks are really about is the **module**, because that is the part two courses cannot
  agree on by construction: a module belongs to one course, so a copy has to be told or has to
  guess, and guessing wrong looks exactly like guessing right.
*/
describe("copying one into another course", () => {
  const tx = withRollback();

  let fixture: Authoring;
  /** A course whose modules are named nothing like the source's. */
  let targetCourseId: string;
  /** The module in it that a copy has to be told about, because no name matches. */
  let differentlyNamed: { id: string };

  const asInstructor = () => createCaller(tx(), fixture.world.instructorId);
  const copyInto = (targetCourseId: string, targetCourseUnitId?: string) =>
    asInstructor().assignments.duplicate({
      assignmentId: fixture.assignmentId,
      targetCourseId,
      targetCourseUnitId,
    });

  beforeAll(async () => {
    fixture = await makeAuthoring(tx());

    const target = await asInstructor().courses.create({
      programId: fixture.world.programId,
      name: `${MARKER} copy target`,
      slug: `copy-a-${suffix}`,
    });
    targetCourseId = target.course.id;
  });

  it("copying into a course with no module of that name is refused", async () => {
    expect(await refusal(() => copyInto(targetCourseId))).toBe("BAD_REQUEST");
  });

  it("...and nothing was written there", async () => {
    expect(await tx().assignment.count({ where: { courseId: targetCourseId } })).toBe(0);
  });

  /*
    Named explicitly, which is the case the name match cannot serve: two courses whose module
    sequences have diverged. Without it, copying into such a course fails on every assignment and
    the only way through is renaming a module to match.
  */
  it("naming the module copies it into a course whose modules are named differently", async () => {
    differentlyNamed = await asInstructor().courseUnits.create({
      category: "MODULE",
      courseId: targetCourseId,
      name: "Week One",
    });

    const named = await copyInto(targetCourseId, differentlyNamed.id);
    expect(named.assignment.courseUnitId).toBe(differentlyNamed.id);
  });

  /*
    The repository name comes across unchanged, which is the half worth checking rather than
    assuming. `@@unique([courseId, assignmentRepoName])` is per course, and the generated
    repositories still differ because the course's short name prefixes every one of them — so
    renaming here would break the correspondence between two years of one course for no reason.
  */
  it("...keeping the repository name, because the course's short name tells them apart", async () => {
    const copied = await tx().assignment.findFirst({
      where: { courseId: targetCourseId },
      select: { assignmentRepoName: true, distributedAt: true },
    });

    expect(copied?.assignmentRepoName).toBe("swe-1-4-loops");
  });

  it("...and arriving unpublished", async () => {
    const copied = await tx().assignment.findFirst({
      where: { courseId: targetCourseId },
      select: { distributedAt: true },
    });

    expect(copied?.distributedAt).toBeNull();
  });

  /*
    A module id is a parameter anybody can pass, so it is checked against the target course rather
    than merely looked up. Without that, a copy could be filed under a third course's module — which
    no screen would show and no constraint would catch, since `courseUnitId` is a foreign key to
    modules rather than to modules *of this course*.
  */
  it("a module from another course is refused", async () => {
    expect(await refusal(() => copyInto(targetCourseId, fixture.world.unitId))).toBe("BAD_REQUEST");
  });

  /*
    The same assignment cannot land in one course twice, because the copy keeps its repository name
    and two assignments in a course cannot share one. Worth checking rather than discovering: it is
    the reason the check below needs a second course.
  */
  it("copying the same assignment into that course again is refused", async () => {
    expect(await refusal(() => copyInto(targetCourseId, differentlyNamed.id))).toBe("BAD_REQUEST");
  });

  /*
    Matched by name when nobody says otherwise, which is the ordinary case: a course copied from
    last year's has last year's module names.
  */
  it("a module of the same name is matched without being asked for", async () => {
    const secondTarget = await asInstructor().courses.create({
      programId: fixture.world.programId,
      name: `${MARKER} copy target two`,
      slug: `copy-b-${suffix}`,
    });
    const sourceModule = await tx().courseUnit.findUnique({
      where: { id: fixture.world.unitId },
      select: { name: true },
    });
    const sameName = await asInstructor().courseUnits.create({
      category: "MODULE",
      courseId: secondTarget.course.id,
      name: sourceModule!.name,
    });

    const matched = await copyInto(secondTarget.course.id);
    expect(matched.assignment.courseUnitId).toBe(sameName.id);
  });

  // An archived course takes nothing new, the same rule as a fellow joining a program. It matters
  // because archived courses are in the course list now, so one is a thing somebody can be looking
  // at when they reach for a copy.
  it("copying into an archived course is refused", async () => {
    await asInstructor().courses.setArchived({ courseId: targetCourseId, archived: true });

    expect(await refusal(() => copyInto(targetCourseId, differentlyNamed.id))).toBe(
      "PRECONDITION_FAILED",
    );
  });
});

describe("what removing one destroys", () => {
  const tx = withRollback();

  let fixture: Authoring;
  let impact: Awaited<ReturnType<ReturnType<typeof createCaller>["assignments"]["removalImpact"]>>;
  let removed: Awaited<ReturnType<ReturnType<typeof createCaller>["assignments"]["remove"]>>;

  const asInstructor = () => createCaller(tx(), fixture.world.instructorId);

  beforeAll(async () => {
    fixture = await makeAuthoring(tx());
    /*
      A repository name on the submission, so the check that student repositories are reported
      rather than deleted compares two non-empty lists. The script's own submission carried none, so
      both sides of that comparison were empty and the check held whatever `remove` reported.
    */
    await handIn(
      tx(),
      fixture.assignmentId,
      fixture.world.student.studentId,
      "marcy-lms/swe-1-4-loops-somebody",
    );

    impact = await asInstructor().assignments.removalImpact({
      assignmentId: fixture.assignmentId,
    });
  });

  it("removalImpact counts the submissions that exist", () => {
    expect({ submissions: impact.submissions, title: impact.title }).toEqual({
      submissions: 1,
      title: fixture.title,
    });
  });

  // Called directly rather than through a dialog, which is the whole point of the check living in
  // the procedure.
  it("remove refuses when the typed title does not match", async () => {
    const code = await refusal(() =>
      asInstructor().assignments.remove({
        assignmentId: fixture.assignmentId,
        confirmTitle: "not the title",
      }),
    );

    expect(code).toBe("BAD_REQUEST");
  });

  it("what remove reports matches what removalImpact predicted", async () => {
    removed = await asInstructor().assignments.remove({
      assignmentId: fixture.assignmentId,
      confirmTitle: fixture.title,
    });

    expect({
      submissions: removed.submissions,
      drafts: removed.drafts,
      testRuns: removed.testRuns,
    }).toEqual({
      submissions: impact.submissions,
      drafts: impact.drafts,
      testRuns: impact.testRuns,
    });
  });

  /*
    Reported so they can be cleaned up deliberately, never deleted: losing a student's work because
    an instructor tidied a course would be a worse failure than an orphaned repository.
  */
  it("student repositories are reported rather than deleted", () => {
    expect(removed.orphanedRepositories).toEqual(["marcy-lms/swe-1-4-loops-somebody"]);
    expect(impact.orphanedRepositories).toEqual(removed.orphanedRepositories);
  });

  it("the assignment is gone", async () => {
    expect(
      await tx().assignment.findUnique({
        where: { id: fixture.assignmentId },
        select: { id: true },
      }),
    ).toBeNull();
  });
});

/*
  Every group above rolled its transaction back, and this is the group that says so. It reads the
  committed database, outside any transaction, after all of them have ended — which is what makes it
  safe to point this suite at a database somebody is using.

  The courses are a separate claim from the assignments, and worth its own check: the copy group
  copies *into* new courses, so a rollback that left the courses behind would leave assignments
  duplicated into courses nobody made — and a course is the one thing here whose leftovers are
  visible to every instructor rather than only to a query.
*/
describe("the rollback really rolled back", () => {
  it("no assignment this run created survived", async () => {
    expect(await db.assignment.count({ where: { title: { startsWith: MARKER } } })).toBe(0);
  });

  it("...nor the courses the copy checks created", async () => {
    expect(await db.course.count({ where: { name: { startsWith: MARKER } } })).toBe(0);
  });

  it("...nor the work the fellows handed in", async () => {
    expect(await db.submission.count({ where: { id: { in: submissionsMade } } })).toBe(0);
  });
});
