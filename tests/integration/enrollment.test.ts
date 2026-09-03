/**
 * Starting a program, getting fellows into it, taking them out again, and the courses inside.
 *
 * Run with `npm run test:integration`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. Authorization is most
 * of what these procedures are — any instructor may create a program, but only one who instructs it
 * may replace its join link or remove somebody from it — and a check that only holds when the
 * function is called some other way is not a check on what an instructor uses.
 *
 * **A fellow joins a program, not a course.** One roster, one join link, and one enrollment admit
 * somebody to every course of the year; the checks that used to be per course are now per program,
 * and the ones about a course are about its curriculum and its short name rather than about who is
 * in it.
 *
 * **Two groups are worth reading.** The roster group is the link and the allowlist together: the
 * link is unguessable and the allowlist is what says who may use it, and neither is enough alone.
 * The removal group asserts both halves of every claim — a removed fellow keeps reading the feedback
 * they were given and cannot hand anything else in, and those two facts are one `where` clause apart
 * in code that otherwise reads identically, so getting one right and the other wrong is the failure
 * this design can actually produce.
 *
 * Who instructs a program, who owns it, and how it is deleted are `tests/integration/programs`.
 *
 * Carries the 127 assertions of `verify:enrollment` that need a database. Its other 49 were checks
 * over pure functions and have moved to the unit suite, which runs on every save with no database
 * at all: 27 of them are the slug tables, now in `tests/lib/courses/course-slug.test.ts`, and the
 * remaining 22 are the two switcher tables and the four address shapes, 20 of which
 * `tests/lib/links.test.ts` already held — it gained the two cases it was missing, a program's
 * roster given to the course switcher and the program list given to the program switcher.
 *
 * **Every row is made here rather than found.** The script looked for a seeded course that happened
 * to hold an assignment, an instructor, and a fellow, and stood down when it found none — which on
 * a database built from the migrations is every run. Four of its checks were also vacuous even
 * where it did run, and the fixture makes each of them real:
 *
 *   - Two of them fell back to a literal when the database held nobody outside the roster, so
 *     "somebody not on the roster is refused rather than shown as empty" compared the string
 *     `"NOT_FOUND"` against itself. Both groups now make an account that is on no roster.
 *   - "no other fellow's submission appears in a fellow's record" was only checked against a real
 *     second fellow's submission when the seeded course happened to hold one. A second fellow hands
 *     work in here, so the check has something to be wrong about.
 *   - "an archived course's submissions stay readable in the assignment's queue" passed on the
 *     string `"no submission to read"` when nothing had been handed in. The submission is created.
 *
 * **Copying is also stronger.** The script reported how many assignments failed to copy rather than
 * asserting that none did, because a copy legitimately fails when a template repository has been
 * made private since last term and the script ran against whatever the sandbox organization held.
 * This suite's assignments name no repository anybody has to have, so the check is that every one
 * of them arrived and none failed.
 */
import { studentRepoName, suggestCourseSlug } from "@/lib/courses/course-slug";
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  makeAccount,
  makeAssignment,
  makeCourse,
  makeProgram,
  makeSubmission,
  makeUnit,
  makeWorld,
  type World,
} from "./fixtures";
import { required, withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);

/** The procedures as one user would reach them, bound to this group's transaction. */
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/** Unique to this run, so the last group can ask whether anything this file made survived. */
const suffix = crypto.randomUUID().slice(0, 8);
const named = (label: string) => `Verify ${label} ${suffix}`;
const termNamed = (label: string) => `Cohort Verify ${label} ${suffix}`;

/**
 * Every account and every program this file made, so the last group can ask whether any survived.
 *
 * Recorded as they are created rather than searched for afterwards, because a search that finds
 * nothing cannot tell a transaction that rolled back from a run that created nothing to begin with.
 */
const accountsMade: string[] = [];
const programsMade: string[] = [];

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

/** What a call refused with, message included, for the one check that is about the wording. */
async function refusalMessage(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * An account, recorded so the rollback group can ask for it back.
 *
 * A fellow's GitHub login and address are written here rather than left to the sign-up trigger,
 * because two groups depend on them: the roster matches an entry to a person by login or by
 * address, and a fellow's record shows both in its header.
 */
async function account(
  tx: Tx,
  options: { role?: "STUDENT" | "INSTRUCTOR" | "ADMIN" } = {},
): Promise<string> {
  const id = await makeAccount(tx, options);
  accountsMade.push(id);

  await tx.profile.update({
    where: { id },
    data: { githubUsername: `integration-${id.slice(0, 8)}` },
  });

  return id;
}

/** {@link makeWorld}, with every account and the program it made recorded for the rollback group. */
async function world(tx: Tx, options: { students?: number } = {}): Promise<World> {
  const built = await makeWorld(tx, options);

  programsMade.push(built.programId);
  accountsMade.push(built.instructorId, ...built.students.map((row) => row.studentId));

  for (const student of built.students) {
    await tx.profile.update({
      where: { id: student.studentId },
      data: { githubUsername: `integration-${student.studentId.slice(0, 8)}` },
    });
  }

  return built;
}

/** A program's join link, which is the program's own column and not something a procedure returns. */
async function joinTokenOf(tx: Tx, programId: string): Promise<string> {
  const program = await tx.program.findUniqueOrThrow({
    where: { id: programId },
    select: { joinToken: true },
  });
  return program.joinToken;
}

/** A fellow's login and address as the roster form would be filled in with them. */
async function rosterKeysOf(tx: Tx, studentId: string) {
  const profile = await tx.profile.findUniqueOrThrow({
    where: { id: studentId },
    select: { githubUsername: true, email: true },
  });
  return { githubUsername: profile.githubUsername, email: profile.email };
}

// ---- Starting a program ---------------------------------------------------------------------
//
// Created empty, which is the decision and not a limitation: carrying a term forward is
// `courses.create` copying a course, once per course, and a program-level copy is that same
// operation called several times.
describe("starting a program", () => {
  const tx = withRollback();

  let instructorId: string;
  let studentId: string;
  let program: { id: string; name: string; term: string };
  let second: { id: string; term: string };

  beforeAll(async () => {
    instructorId = await account(tx(), { role: "INSTRUCTOR" });
    studentId = await account(tx());

    const asInstructor = createCaller(tx(), instructorId);
    program = await asInstructor.programs.create({
      name: named("Program"),
      term: termNamed("A"),
    });
    programsMade.push(program.id);

    second = await asInstructor.programs.create({
      name: named("Program"),
      term: termNamed("A2"),
    });
    programsMade.push(second.id);
  });

  it("a program is created", () => {
    expect(program.name).toBe(named("Program"));
  });

  /*
    The same name in another term is a different program, which is the whole reason the term is
    half of what makes a program unique: a school runs the same program every year, and the name
    alone would make the second year a duplicate of the first.
  */
  it("...while the same name in another term is a different program", () => {
    expect(second.term).toBe(termNamed("A2"));
  });

  /*
    The creator is the primary instructor, and this is the check that would fail quietly.

    A `ProgramInstructor` row that was not written looks entirely normal until somebody tries to add
    a course, because every authoring procedure checks that table rather than the role.
  */
  it("the creator is the primary instructor", async () => {
    const created = await tx().program.findUnique({
      where: { id: program.id },
      select: { instructors: { select: { userId: true, isPrimary: true } } },
    });
    expect(created?.instructors).toEqual([{ userId: instructorId, isPrimary: true }]);
  });

  it("a join token is generated", async () => {
    expect((await joinTokenOf(tx(), program.id)).length).toBeGreaterThanOrEqual(32);
  });

  it("a fellow cannot create a program", async () => {
    const code = await refusal(() =>
      createCaller(tx(), studentId).programs.create({
        name: named("Nope"),
        term: termNamed("Nope"),
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

/*
  In a transaction of its own. The refusal is the unique index on `(name, term)` rather than a line
  of TypeScript — `programs.create` catches P2002 and rethrows it as a sentence — and a failed
  statement aborts whatever transaction it happened in, so every check after it in a shared one
  would fail for a reason that has nothing to do with what it asks.
*/
describe("a program with the same name and term", () => {
  const tx = withRollback();

  it("a program with the same name and term is refused", async () => {
    const instructorId = await account(tx(), { role: "INSTRUCTOR" });
    const asInstructor = createCaller(tx(), instructorId);

    const first = await asInstructor.programs.create({
      name: named("Duplicate"),
      term: termNamed("Duplicate"),
    });
    programsMade.push(first.id);

    const code = await refusal(() =>
      asInstructor.programs.create({ name: named("Duplicate"), term: termNamed("Duplicate") }),
    );
    expect(code).toBe("CONFLICT");
  });
});

// ---- A course inside it ----------------------------------------------------------------------
describe("a course inside a program", () => {
  const tx = withRollback();

  let built: World;
  let empty: { course: { id: string; name: string; programId: string; publishedAt: Date | null } };
  let copied: { copied: number; failed: { title: string; reason: string }[] };

  beforeAll(async () => {
    built = await world(tx());
    const created = await createCaller(tx(), built.instructorId).courses.create({
      programId: built.programId,
      name: named("Empty"),
    });
    empty = created;
    copied = created;
  });

  it("a course is created", () => {
    expect(empty.course.name).toBe(named("Empty"));
  });

  it("...with nothing copied into it", () => {
    expect({ copied: copied.copied, failed: copied.failed }).toEqual({ copied: 0, failed: [] });
  });

  it("...in the program it was asked for", () => {
    expect(empty.course.programId).toBe(built.programId);
  });

  /*
    Unpublished, which is what replaced "do not enrol anybody yet" as the way to keep a course that
    begins in March off a fellow's screen in September. Being on the roster now makes somebody a
    student of every course of the term, so publication is the only lever left — and a course
    arriving visible would put an empty shell in front of the roster the moment it was created.
  */
  it("...and not published yet", () => {
    expect(empty.course.publishedAt).toBeNull();
  });

  it("...and can be authored in immediately", async () => {
    const context = await createCaller(tx(), built.instructorId).assignments.authoringContext({
      courseId: empty.course.id,
    });
    expect(context.course.name).toBe(named("Empty"));
  });

  it("a fellow cannot create a course", async () => {
    const code = await refusal(() =>
      createCaller(tx(), built.student.studentId).courses.create({
        programId: built.programId,
        name: named("Nope"),
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

/**
 * The four variables that decide whether an assignment's repositories are read over the network.
 *
 * `validateAssignmentDraft` fetches both repositories a REPO assignment names, to check they are
 * still readable by the installation that will generate from them — and `copyAssignmentInto` runs
 * it against the course the copy is going into. With no GitHub App configured it records a warning
 * saying the repositories were not checked, which is the state of a machine that has never set one
 * up, and the copy proceeds.
 *
 * The group below removes them for its own length. What it asks is which columns survive a copy,
 * and the answer must not depend on whether the machine running the tests happens to hold
 * credentials for an organization whose repositories this suite never created.
 */
const GITHUB_APP_VARIABLES = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_APP_INSTALLATION_ID",
];

// ---- Copying ---------------------------------------------------------------------------------
describe("copying a course", () => {
  const tx = withRollback();

  const withoutGithubApp: Record<string, string | undefined> = {};

  let built: World;
  let sourceSlug: string;
  let sourceModules: { name: string; position: number }[];
  let sourceAssignments: number;
  let copy: { course: { id: string; slug: string }; copied: number; failed: { title: string }[] };
  let copiedAssignments: {
    kind: string;
    dueAt: Date | null;
    distributedAt: Date | null;
    answerKeyRepo: string | null;
    answerKeyDir: string | null;
    templateRepo: string | null;
  }[];

  beforeAll(async () => {
    for (const variable of GITHUB_APP_VARIABLES) {
      withoutGithubApp[variable] = process.env[variable];
      delete process.env[variable];
    }

    built = await world(tx());
    sourceSlug = (
      await tx().course.findUniqueOrThrow({
        where: { id: built.courseId },
        select: { slug: true },
      })
    ).slug;

    // A second module, so "every module, name and position" is a claim about a sequence rather
    // than about one row that could be reproduced by accident.
    const second = await makeUnit(tx(), { courseId: built.courseId, name: named("Module Two") });

    await makeAssignment(tx(), {
      courseId: built.courseId,
      courseUnitId: built.unitId,
      title: named("Self Directed Work"),
    });

    /*
      A repository assignment, written straight to the table because `makeAssignment` builds the
      kind that needs no repository at all. Both repository columns and the answer key folder are
      filled in, because the check below is that a copy keeps all three — and a source assignment
      missing any of them would make it pass for the wrong reason.
    */
    await tx().assignment.create({
      data: {
        courseId: built.courseId,
        courseUnitId: second.id,
        title: named("Repository Work"),
        kind: "REPO",
        handInMethods: [],
        pointValue: 10,
        completionThreshold: 0.75,
        dueAt: new Date("2026-10-01T00:00:00Z"),
        distributedAt: new Date("2026-01-02T09:00:00Z"),
        sections: [{ grading: "manual", label: "Overall", pointValue: 10 }],
        templateRepo: "marcy-lab-school/verify-enrollment-template",
        answerKeyRepo: "marcy-lab-school/verify-enrollment-answer-keys",
        answerKeyDir: "solutions",
        assignmentRepoName: `verify-enrollment-${suffix}`,
        githubOrg: "marcy-lab-school",
        runnerPreset: "none",
      },
    });

    sourceModules = await tx().courseUnit.findMany({
      where: { courseId: built.courseId },
      select: { name: true, position: true },
      orderBy: { position: "asc" },
    });
    sourceAssignments = await tx().assignment.count({ where: { courseId: built.courseId } });

    copy = await createCaller(tx(), built.instructorId).courses.create({
      programId: built.programId,
      name: named("Copy"),
      copyFromCourseId: built.courseId,
    });

    copiedAssignments = await tx().assignment.findMany({
      where: { courseId: copy.course.id },
      select: {
        kind: true,
        dueAt: true,
        distributedAt: true,
        answerKeyRepo: true,
        answerKeyDir: true,
        templateRepo: true,
      },
    });
  });

  afterAll(() => {
    for (const variable of GITHUB_APP_VARIABLES) {
      const value = withoutGithubApp[variable];
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
  });

  it("copying reproduces every module, name and position", async () => {
    const copiedModules = await tx().courseUnit.findMany({
      where: { courseId: copy.course.id },
      select: { name: true, position: true },
      orderBy: { position: "asc" },
    });
    expect(copiedModules).toEqual(sourceModules);
  });

  /*
    Every assignment, and none of them reported as a failure.

    The script reported the failures rather than asserting there were none, because it copied a
    seeded course whose templates live in a real GitHub organization and a template made private
    since last term is a legitimate reason for one copy to fail. Nothing here names a repository
    anybody has to have, so the stronger claim is available.
  */
  it("copying reproduces every assignment", () => {
    expect({ arrived: copy.copied, failed: copy.failed }).toEqual({
      arrived: sourceAssignments,
      failed: [],
    });
  });

  it("copies arrive unpublished", () => {
    expect(copiedAssignments.every((row) => row.distributedAt === null)).toBe(true);
  });

  it("...with due dates cleared", () => {
    expect(copiedAssignments.every((row) => row.dueAt === null)).toBe(true);
  });

  /*
    The repository columns, on the kinds that have them.

    Narrowed to REPO deliberately: a Drive or file-upload assignment has no template and no answer
    keys, and the schema requires them to be null. A check over every kind would fail on a correctly
    copied document.
  */
  it("a copied repository assignment keeps both repositories and its answer key folder", () => {
    const repos = copiedAssignments.filter((row) => row.kind === "REPO");
    expect([
      repos.length,
      repos.every(
        (row) =>
          row.templateRepo !== null && row.answerKeyRepo !== null && row.answerKeyDir !== null,
      ),
    ]).toEqual([1, true]);
  });

  it("...and the kinds with no repository keep none", () => {
    expect(
      copiedAssignments
        .filter((row) => row.kind !== "REPO")
        .every((row) => row.templateRepo === null && row.answerKeyRepo === null),
    ).toBe(true);
  });

  /*
    ---- The course is in every repository name ------------------------------------------------

    A fellow's repository is `{courseSlug}-{assignmentRepoName}-{github login}`, which is what keeps
    two years of the same course apart on GitHub — and what lets two courses of one term both hold
    an assignment called `project-1`. It is why the short name stayed on the course rather than
    moving up to the program with everything else.

    Checked here because copying is exactly how a collision arises, and because the slug is only
    editable until the first Accept.
  */
  it("a copied course gets its own short name", () => {
    expect([copy.course.slug !== sourceSlug, copy.course.slug.length > 0]).toEqual([true, true]);
  });

  /*
    The names the two courses generate for the same assignment and the same fellow differ.

    Built through `studentRepoName` rather than by string concatenation here, so this checks the
    function `accept` actually calls. Asserting the shape by rebuilding it a second way would pass
    while both were wrong together.
  */
  it("the same assignment in two courses generates two different repository names", async () => {
    const [inOriginal, inCopy] = await twoRepositoryNames();
    expect(inOriginal === inCopy).toBe(false);
  });

  it("...and each starts with its own course", async () => {
    const [, inCopy] = await twoRepositoryNames();
    expect(inCopy.startsWith(`${copy.course.slug}-`)).toBe(true);
  });

  /** The repository one fellow would be given for the same assignment in each of the two courses. */
  async function twoRepositoryNames(): Promise<[string, string]> {
    const twin = required(
      "a repository assignment in the copy, which the copy above is supposed to have made",
      await tx().assignment.findFirst({
        where: {
          courseId: copy.course.id,
          kind: "REPO",
          assignmentRepoName: { not: null },
          githubOrg: { not: null },
        },
        select: { assignmentRepoName: true },
      }),
    );

    const original = required(
      "the assignment in the source course the copy was made from",
      await tx().assignment.findFirst({
        where: { courseId: built.courseId, assignmentRepoName: twin.assignmentRepoName },
        select: { assignmentRepoName: true, course: { select: { slug: true } } },
      }),
    );

    return [
      studentRepoName({
        courseSlug: original.course.slug,
        assignmentRepoName: original.assignmentRepoName!,
        githubLogin: "somebody",
      }),
      studentRepoName({
        courseSlug: copy.course.slug,
        assignmentRepoName: twin.assignmentRepoName!,
        githubLogin: "somebody",
      }),
    ];
  }
});

// ---- The short name, and its window ------------------------------------------------------------
describe("the short name a course is created with", () => {
  const tx = withRollback();

  let built: World;
  let term: string;

  beforeAll(async () => {
    built = await world(tx());
    term = (
      await tx().program.findUniqueOrThrow({
        where: { id: built.programId },
        select: { term: true },
      })
    ).term;
  });

  it("an illegal short name is refused", async () => {
    const code = await refusal(() =>
      createCaller(tx(), built.instructorId).courses.create({
        programId: built.programId,
        name: named("Illegal"),
        slug: "Fall 2026!",
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  /*
    Nothing usable in the course name at all leaves the term carrying the short name on its own,
    which is the point of the suggestion naming both halves. Nothing is invented — it is still
    derived from what somebody typed — so this is a fallback rather than a refusal.
  */
  it("a course name with nothing usable in it leaves the term carrying it", async () => {
    const created = await createCaller(tx(), built.instructorId).courses.create({
      programId: built.programId,
      name: "!!!",
    });
    expect(created.course.slug).toBe(suggestCourseSlug({ courseName: "", term }));
  });

  /*
    And once set it cannot be changed, by anybody, ever — there is no procedure that changes it.
    Asserted against the router rather than against a screen, because "the button is not rendered"
    is a different claim: the check that matters is that no caller can reach it.

    `courses.rename` sits beside it and reaches only the name, which the group below checks.
  */
  it("nothing can change a short name after creation", () => {
    expect("setSlug" in createCaller(tx(), built.instructorId).courses).toBe(false);
  });
});

/*
  In a transaction of its own, for the reason the duplicate program is: the collision is the unique
  index on the slug, `courses.create` catches P2002 and rethrows it as a sentence, and the failed
  statement aborts the transaction it happened in.
*/
describe("a duplicate short name", () => {
  const tx = withRollback();

  it("a duplicate short name is refused", async () => {
    const built = await world(tx());
    const asInstructor = createCaller(tx(), built.instructorId);

    const first = await asInstructor.courses.create({
      programId: built.programId,
      name: named("Taken"),
    });

    const code = await refusal(() =>
      asInstructor.courses.create({
        programId: built.programId,
        name: named("Duplicate Slug"),
        slug: first.course.slug,
      }),
    );
    expect(code).toBe("CONFLICT");
  });
});

/*
  ---- The join link, and the roster it is only half of ------------------------------------------

  The link is unguessable; the roster is an allowlist. Neither is enough alone, and the order of
  these checks is the order somebody meets them: refused first, added, then in.

  The fellow here is on no roster to begin with, which is what the whole group turns on — the one
  `makeWorld` enrols is already in the program and would be admitted by the branch that answers
  before the roster is consulted at all.
*/
describe("the join link and the roster", () => {
  const tx = withRollback();

  let built: World;
  let joinerId: string;
  let token: string;

  const asJoiner = () => createCaller(tx(), joinerId);
  const asInstructor = () => createCaller(tx(), built.instructorId);

  beforeAll(async () => {
    built = await world(tx());
    joinerId = await account(tx());
    token = await joinTokenOf(tx(), built.programId);
  });

  it("the link says which program it is", async () => {
    const preview = await asJoiner().enrollments.preview({ token });
    const program = await tx().program.findUniqueOrThrow({
      where: { id: built.programId },
      select: { name: true },
    });
    expect(preview?.name).toBe(program.name);
  });

  it("...and its term", async () => {
    const preview = await asJoiner().enrollments.preview({ token });
    const program = await tx().program.findUniqueOrThrow({
      where: { id: built.programId },
      select: { term: true },
    });
    expect(preview?.term).toBe(program.term);
  });

  it("...and that the caller is not in it yet", async () => {
    expect((await asJoiner().enrollments.preview({ token }))?.alreadyIn).toBeNull();
  });

  it("an unknown token previews as nothing", async () => {
    expect(await asJoiner().enrollments.preview({ token: "not-a-real-token" })).toBeNull();
  });

  it("a fellow who was never expected cannot use the link", async () => {
    expect(await refusal(() => asJoiner().enrollments.join({ token }))).toBe("FORBIDDEN");
  });

  it("...and the screen says so before the button", async () => {
    expect((await asJoiner().enrollments.preview({ token }))?.onRoster).toBe(false);
  });

  describe("once they are written down as expected", () => {
    let added: { added: number };

    beforeAll(async () => {
      added = await asInstructor().enrollments.addToRoster({
        programId: built.programId,
        entries: [
          { ...(await rosterKeysOf(tx(), joinerId)), note: "Expected by the integration suite" },
        ],
      });
    });

    it("an instructor can write down who is expected", () => {
      expect(added.added).toBe(1);
    });

    it("...and the screen now offers the button", async () => {
      expect((await asJoiner().enrollments.preview({ token }))?.onRoster).toBe(true);
    });

    // Pasting the same list twice is something people do. The second paste adds nothing and says
    // so rather than failing on the unique constraint.
    it("adding the same person again is skipped rather than refused", async () => {
      const again = await asInstructor().enrollments.addToRoster({
        programId: built.programId,
        entries: [{ ...(await rosterKeysOf(tx(), joinerId)), note: null }],
      });
      expect(again.alreadyPresent).toBe(1);
    });

    describe("and they redeem the link", () => {
      let joined: { joined: boolean };

      beforeAll(async () => {
        joined = await asJoiner().enrollments.join({ token });
      });

      it("redeeming the link enrolls the fellow", () => {
        expect(joined.joined).toBe(true);
      });

      /*
        One entry admits one person, and the claim is what says so. Written in the same transaction
        as the enrollment, so an entry marked used always has a member behind it.
      */
      it("joining claims the entry that expected them", async () => {
        const claimed = await tx().rosterEntry.findFirst({
          where: { programId: built.programId, claimedById: joinerId },
          select: { claimedAt: true },
        });
        expect(claimed?.claimedAt).not.toBeUndefined();
      });

      // A claimed entry cannot be tidied away: it is the record of how somebody got in, and
      // removing it would not remove them.
      it("a claimed entry cannot be removed from the list", async () => {
        const entry = await tx().rosterEntry.findFirstOrThrow({
          where: { programId: built.programId, claimedById: joinerId },
          select: { id: true },
        });
        const code = await refusal(() =>
          asInstructor().enrollments.removeFromRoster({
            programId: built.programId,
            entryId: entry.id,
          }),
        );
        expect(code).toBe("PRECONDITION_FAILED");
      });

      it("...as ACTIVE", async () => {
        const enrollment = await tx().enrollment.findFirst({
          where: { programId: built.programId, studentId: joinerId },
          select: { status: true },
        });
        expect(enrollment?.status).toBe("ACTIVE");
      });
    });
  });
});

/*
  ---- Renaming, and the half that cannot be renamed ---------------------------------------------

  The pair is the point. A course's name is display and only display — nothing looks one up by it
  and no constraint holds it — so it is editable. Its short name is in the name of every repository
  the course has generated, so it is not.
*/
describe("renaming a course", () => {
  const tx = withRollback();

  let built: World;
  let slugBefore: string;

  beforeAll(async () => {
    built = await world(tx());
    slugBefore = (
      await tx().course.findUniqueOrThrow({
        where: { id: built.courseId },
        select: { slug: true },
      })
    ).slug;
  });

  it("a course can be renamed, and the name is trimmed", async () => {
    const renamed = await createCaller(tx(), built.instructorId).courses.rename({
      courseId: built.courseId,
      name: `  ${named("Renamed")}  `,
    });
    expect(renamed.name).toBe(named("Renamed"));
  });

  it("...and its short name is untouched", async () => {
    const after = await tx().course.findUniqueOrThrow({
      where: { id: built.courseId },
      select: { slug: true },
    });
    expect(after.slug).toBe(slugBefore);
  });

  it("a blank name is refused", async () => {
    const code = await refusal(() =>
      createCaller(tx(), built.instructorId).courses.rename({
        courseId: built.courseId,
        name: "  ",
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  it("a fellow cannot rename a course", async () => {
    const code = await refusal(() =>
      createCaller(tx(), built.student.studentId).courses.rename({
        courseId: built.courseId,
        name: named("Nope"),
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

/*
  ---- Publishing --------------------------------------------------------------------------------

  The three readers of `publishedAt` have to agree, and this is the pair that says so: a fellow's
  own course list and the course itself. `tests/integration/dashboard` covers the assignment feed,
  which is the third.

  Placed after the fellow is on the roster, because "an unpublished course is absent from their
  list" is a claim about somebody in the program and would be vacuous about somebody in nothing.
*/
describe("publishing a course", () => {
  const tx = withRollback();

  let built: World;
  let draftId: string;

  const asInstructor = () => createCaller(tx(), built.instructorId);
  const asStudent = () => createCaller(tx(), built.student.studentId);

  beforeAll(async () => {
    built = await world(tx());
    draftId = (
      await asInstructor().courses.create({ programId: built.programId, name: named("Draft") })
    ).course.id;
  });

  it("an unpublished course is absent from a fellow's list", async () => {
    const mine = await asStudent().courses.listMine();
    expect(mine.some((row) => row.id === draftId)).toBe(false);
  });

  it("...and refused if they name its address directly", async () => {
    expect(await refusal(() => asStudent().courses.get({ courseId: draftId }))).toBe("NOT_FOUND");
  });

  it("...while its instructor sees it", async () => {
    const mine = await asInstructor().courses.listMine();
    expect(mine.some((row) => row.id === draftId)).toBe(true);
  });

  it("publishing records when it happened", async () => {
    const published = await asInstructor().courses.setPublished({
      courseId: draftId,
      published: true,
    });
    expect(published.publishedAt).not.toBeNull();
  });

  it("a fellow cannot publish a course", async () => {
    const code = await refusal(() =>
      asStudent().courses.setPublished({ courseId: draftId, published: false }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  /*
    **One enrollment admits them to every published course of the program**, which is the
    duplication this whole change removed. Before it, one fellow taking four courses meant four
    rosters, four links, and four rows saying the same thing.

    Opened one at a time rather than asserted over the list, because the claim is that each call
    succeeds — a predicate over an array would be satisfied by an array of promises and measure
    nothing.
  */
  it("...and it admits them to every published course of the program", async () => {
    const theirs = (await asStudent().courses.listMine())
      .filter((row) => row.program.id === built.programId)
      .map((row) => row.id);

    const opened: string[] = [];
    for (const courseId of theirs) {
      opened.push((await asStudent().courses.get({ courseId })).id);
    }

    expect([opened.length >= 2, opened.every((id) => theirs.includes(id))]).toEqual([true, true]);
  });
});

/*
  Idempotent, which is what makes a reusable link safe. A fellow who opens it twice, or bookmarks
  it, must not produce a second enrollment — `@@unique([programId, studentId])` is the constraint,
  and this is the procedure agreeing with it rather than provoking it.
*/
describe("redeeming the link more than once", () => {
  const tx = withRollback();

  let built: World;
  let joinerId: string;
  let token: string;

  const asJoiner = () => createCaller(tx(), joinerId);

  beforeAll(async () => {
    built = await world(tx());
    joinerId = await account(tx());
    token = await joinTokenOf(tx(), built.programId);

    await createCaller(tx(), built.instructorId).enrollments.addToRoster({
      programId: built.programId,
      entries: [{ ...(await rosterKeysOf(tx(), joinerId)), note: null }],
    });
    await asJoiner().enrollments.join({ token });
  });

  it("redeeming it twice does not enroll them twice", async () => {
    expect((await asJoiner().enrollments.join({ token })).joined).toBe(false);
  });

  it("...and there is one enrollment", async () => {
    const count = await tx().enrollment.count({
      where: { programId: built.programId, studentId: joinerId },
    });
    expect(count).toBe(1);
  });

  /*
    **An enrollment that already exists outranks the roster, and this is the check that says so.**
    Every fellow enrolled before the roster table existed has no entry, so a roster check placed
    before the already-in branch tells somebody sitting in a program that the link to it is not for
    their account. It did, until the order in `join` and `preview` was corrected — which is a
    mistake with no symptom until a real roster meets it.

    Tested by taking the entry away underneath them: the enrollment stays, and so must the answer.
  */
  describe("with their roster entry taken away underneath them", () => {
    beforeAll(async () => {
      await tx().rosterEntry.deleteMany({
        where: { programId: built.programId, claimedById: joinerId },
      });
    });

    it("a fellow already in the program is unaffected by having no entry", async () => {
      expect((await asJoiner().enrollments.join({ token })).joined).toBe(false);
    });

    it("...and their screen still says they are in it, not that the link is not theirs", async () => {
      expect((await asJoiner().enrollments.preview({ token }))?.onRoster).toBe(true);
    });
  });

  // An instructor of the program is refused: an enrollment would put them in their own roster and
  // gradebook, and accepting would file a submission in their own queue.
  it("an instructor of the program cannot join it as a fellow", async () => {
    const code = await refusal(() =>
      createCaller(tx(), built.instructorId).enrollments.join({ token }),
    );
    expect(code).toBe("PRECONDITION_FAILED");
  });
});

// Rotating the link invalidates the old one, which is the only control over who can use it. Fellows
// already in are unaffected — the token is how you join, not how you stay.
describe("rotating the join link", () => {
  const tx = withRollback();

  let built: World;
  let before: string;
  let rotated: { joinToken: string };

  beforeAll(async () => {
    built = await world(tx());
    before = await joinTokenOf(tx(), built.programId);
    rotated = await createCaller(tx(), built.instructorId).programs.regenerateJoinToken({
      programId: built.programId,
    });
  });

  it("regenerating changes the token", () => {
    expect(rotated.joinToken === before).toBe(false);
  });

  it("the old link no longer works", async () => {
    const outsiderId = await account(tx());
    const code = await refusal(() =>
      createCaller(tx(), outsiderId).enrollments.join({ token: before }),
    );
    expect(code).toBe("NOT_FOUND");
  });

  it("...and the fellow who already joined is still enrolled", async () => {
    const enrollment = await tx().enrollment.findFirst({
      where: { programId: built.programId, studentId: built.student.studentId },
      select: { status: true },
    });
    expect(enrollment?.status).toBe("ACTIVE");
  });

  it("a fellow cannot regenerate a join link", async () => {
    const code = await refusal(() =>
      createCaller(tx(), built.student.studentId).programs.regenerateJoinToken({
        programId: built.programId,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

/*
  An archived term takes no new fellows, which is the same "readable, accepts nothing" pair a
  removed fellow gets.
*/
describe("an archived program", () => {
  const tx = withRollback();

  it("an archived program refuses new fellows", async () => {
    const built = await world(tx());
    const token = await joinTokenOf(tx(), built.programId);
    const joinerId = await account(tx());

    await createCaller(tx(), built.instructorId).enrollments.addToRoster({
      programId: built.programId,
      entries: [{ ...(await rosterKeysOf(tx(), joinerId)), note: null }],
    });
    await createCaller(tx(), built.instructorId).programs.setArchived({
      programId: built.programId,
      archived: true,
    });

    const code = await refusal(() => createCaller(tx(), joinerId).enrollments.join({ token }));
    expect(code).toBe("PRECONDITION_FAILED");
  });
});

/*
  ---- An archived course stays reachable, labelled ----------------------------------------------

  `listMine` used to filter `archivedAt: null`, which meant archiving a course was also the only way
  to make one unreachable: every procedure still admitted its members, so the work was all there and
  openable by a URL somebody happened to have kept and by nothing else. The pair below is the whole
  fix — it is in the list, and the list says which it is.

  Both halves matter. Returning the row without the label would put a finished course in among the
  running ones with nothing to tell them apart, which is the same mistake as an unlabelled course a
  fellow was removed from.
*/
describe("an archived course", () => {
  const tx = withRollback();

  let built: World;
  let archivedRow: { archivedAt: Date | null } | undefined;

  const asInstructor = () => createCaller(tx(), built.instructorId);

  beforeAll(async () => {
    built = await world(tx());
    await asInstructor().courses.setArchived({ courseId: built.courseId, archived: true });
    archivedRow = (await asInstructor().courses.listMine()).find(
      (row) => row.id === built.courseId,
    );
  });

  it("an archived course stays in the course list", () => {
    expect(archivedRow).not.toBeUndefined();
  });

  it("...labelled as archived", () => {
    expect(archivedRow?.archivedAt).not.toBeNull();
  });

  it("reopening clears the label", async () => {
    await asInstructor().courses.setArchived({ courseId: built.courseId, archived: false });
    const reopened = (await asInstructor().courses.listMine()).find(
      (row) => row.id === built.courseId,
    );
    expect(reopened?.archivedAt).toBeNull();
  });

  it("a fellow cannot archive a course", async () => {
    const code = await refusal(() =>
      createCaller(tx(), built.student.studentId).courses.setArchived({
        courseId: built.courseId,
        archived: true,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

/*
  ---- Triage is one course's, and an archived course's is nobody's ------------------------------

  Both halves were claimed in the ROADMAP and neither was true. `triage` filtered `archivedAt: null`
  in its admin branch only, so the reader it held for was the one who teaches nothing; and the
  screen called it with no course at all, so an instructor teaching two courses got both piles
  interleaved.

  The first check is the one everything else rests on. Every assertion below is that some pile is
  empty, and a course with nothing outstanding would make all of them pass while measuring nothing
  — so the pile is asserted to be non-empty before anything empties it.
*/
describe("grading triage is one course's", () => {
  const tx = withRollback();

  let built: World;
  let quietCourseId: string;
  let assignmentId: string;
  let outstanding: number;

  const asInstructor = () => createCaller(tx(), built.instructorId);
  const asStudent = () => createCaller(tx(), built.student.studentId);
  const triage = async (courseId: string) =>
    (await asInstructor().submissions.triage({ courseId })).submissions;

  beforeAll(async () => {
    built = await world(tx());

    const assignment = await makeAssignment(tx(), {
      courseId: built.courseId,
      courseUnitId: built.unitId,
      title: named("Triage Work"),
    });
    assignmentId = assignment.id;
    await makeSubmission(tx(), {
      assignmentId: assignment.id,
      studentId: built.student.studentId,
      status: "SUBMITTED",
    });

    /*
      A second course of the same program, which nobody has handed anything in to. A triage that
      crossed courses would show the first course's work here.

      No `CourseInstructor` row for it, deliberately: `triage` gates on instructing the *program*,
      so the same instructor reads both piles, and writing the course row as well would say the
      access came from somewhere narrower than it does.
    */
    quietCourseId = (await makeCourse(tx(), { programId: built.programId })).id;

    outstanding = (await triage(built.courseId)).length;
  });

  it("the course has work in triage", () => {
    expect(outstanding).toBeGreaterThan(0);
  });

  it("triage is scoped to the course asked for", async () => {
    expect((await triage(quietCourseId)).length).toBe(0);
  });

  describe("and an archived course's is nobody's", () => {
    beforeAll(async () => {
      await asInstructor().courses.setArchived({ courseId: built.courseId, archived: true });
    });

    it("an archived course's submissions leave triage", async () => {
      expect((await triage(built.courseId)).length).toBe(0);
    });

    /*
      The fellow's own list, while the course they are in is archived. Off the list of work and not
      off the list of courses — this is the half a reader is most likely to get wrong, because
      "archived" reads as "gone" and the whole point is that it is not.
    */
    it("...while the fellows in it keep the course on their own list", async () => {
      const mine = await asStudent().courses.listMine();
      expect(mine.find((row) => row.id === built.courseId)?.archivedAt).not.toBeNull();
    });

    // Readable, though: archiving stops the course appearing in a list of work to do, and takes
    // nothing back. The assignment's own queue is how its submissions are read.
    it("...while its submissions stay readable in the assignment's queue", async () => {
      const queue = await asInstructor().submissions.listForAssignment({ assignmentId });
      expect(queue.submissions.length).toBeGreaterThan(0);
    });

    it("...and come back when it is reopened", async () => {
      await asInstructor().courses.setArchived({ courseId: built.courseId, archived: false });
      expect((await triage(built.courseId)).length).toBe(outstanding);
    });
  });

  it("a fellow cannot read a course's triage", async () => {
    const code = await refusal(() => asStudent().submissions.triage({ courseId: built.courseId }));
    expect(code).toBe("FORBIDDEN");
  });
});

/*
  ---- One fellow's work, which is the grading queue's other axis --------------------------------

  `listForAssignment` is one assignment across many fellows; `listForStudent` is one fellow across
  many assignments. They share the select and the row decoration, so the checks worth making here
  are the ones about the *difference*: what the rows cover, and who may read them.
*/
describe("one fellow's record in a course", () => {
  const tx = withRollback();

  let built: World;
  let outsiderId: string;
  let foreignSubmissionId: string;
  let assignmentCount: number;
  let record: Awaited<ReturnType<ReturnType<typeof createCaller>["submissions"]["listForStudent"]>>;

  const asInstructor = () => createCaller(tx(), built.instructorId);
  const theirId = () => built.student.studentId;

  beforeAll(async () => {
    built = await world(tx(), { students: 2 });
    outsiderId = await account(tx());

    /*
      Two assignments, one of which this fellow has begun and one of which they have not. The
      second is what makes "there is a row for work nobody has started" a claim about a row that
      exists rather than about an empty list.
    */
    const begun = await makeAssignment(tx(), {
      courseId: built.courseId,
      courseUnitId: built.unitId,
      title: named("Record Begun"),
    });
    await makeAssignment(tx(), {
      courseId: built.courseId,
      courseUnitId: built.unitId,
      title: named("Record Untouched"),
    });

    await makeSubmission(tx(), { assignmentId: begun.id, studentId: theirId() });

    /*
      A second fellow's submission on the same assignment. The relation in `listForStudent` is
      filtered by `studentId`, and a mistake there would quietly show one fellow another's work on
      a screen titled with their name — which is the worst failure this procedure has available.
      Without a real second fellow's row the check runs over nothing.
    */
    foreignSubmissionId = (
      await makeSubmission(tx(), {
        assignmentId: begun.id,
        studentId: built.students[1]!.studentId,
      })
    ).id;

    assignmentCount = await tx().assignment.count({ where: { courseId: built.courseId } });
    record = await asInstructor().submissions.listForStudent({
      courseId: built.courseId,
      studentId: theirId(),
    });
  });

  it("a fellow's record names them, with the fields the header shows", () => {
    expect({
      id: record.student.id,
      hasEmail: record.student.email !== null,
      hasGithub: record.student.githubUsername !== null,
    }).toEqual({ id: theirId(), hasEmail: true, hasGithub: true });
  });

  it("...and the course it is scoped to", () => {
    expect(record.course.id).toBe(built.courseId);
  });

  it("...and the program above it", () => {
    expect(record.program.id).toBe(built.programId);
  });

  /*
    **A row per assignment, not per submission.** "Has not begun this" is a fact about a fellow that
    a list of only their submissions cannot state, and it is the difference from the queue — where a
    fellow who never accepted is deliberately absent, because that screen asks what is left to grade
    rather than how somebody is doing.
  */
  it("there is a row for every assignment in the course", () => {
    expect(record.rows.length).toBe(assignmentCount);
  });

  it("...including ones with nothing handed in", () => {
    expect(record.rows.some((row) => row.submission === null)).toBe(true);
  });

  it("...and at least one with something", () => {
    expect(record.rows.some((row) => row.submission !== null)).toBe(true);
  });

  // Every row carries what the review pane needs, which is per-assignment here where the queue
  // reads it once for the page. A missing threshold would silently mark work incomplete.
  it("every row carries its own assignment's grading settings", () => {
    expect(
      record.rows.every(
        (row) =>
          typeof row.assignment.completionThreshold === "number" &&
          typeof row.assignment.manualOnly === "boolean" &&
          row.assignment.courseUnit !== null,
      ),
    ).toBe(true);
  });

  it("no other fellow's submission appears in it", () => {
    expect(
      record.rows.every(
        (row) => row.submission === null || row.submission.student.id === theirId(),
      ),
    ).toBe(true);
  });

  it("...checked against a submission that really belongs to somebody else", () => {
    expect(record.rows.some((row) => row.submission?.id === foreignSubmissionId)).toBe(false);
  });

  it("the courses offered include the one being read", () => {
    expect(record.courses.some((row) => row.id === built.courseId)).toBe(true);
  });

  it("a fellow cannot read their own record through this", async () => {
    const code = await refusal(() =>
      createCaller(tx(), theirId()).submissions.listForStudent({
        courseId: built.courseId,
        studentId: theirId(),
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  /*
    A fellow who is not on this roster is NOT_FOUND rather than an empty list. An empty list reads
    as "this person has done nothing", which is a different and false statement.
  */
  it("a fellow who is not on the roster is refused rather than shown as idle", async () => {
    const code = await refusal(() =>
      asInstructor().submissions.listForStudent({
        courseId: built.courseId,
        studentId: outsiderId,
      }),
    );
    expect(code).toBe("NOT_FOUND");
  });
});

/*
  ---- One fellow across the whole program -------------------------------------------------------

  The other student page, and it is a different question: who they are rather than what they handed
  in. The check that earns its place is the second one — a row per course of the term, which is what
  makes it the way into the per-course record above.
*/
describe("one fellow across the whole program", () => {
  const tx = withRollback();

  let built: World;
  let outsiderId: string;
  let courseCount: number;
  let person: Awaited<ReturnType<ReturnType<typeof createCaller>["programs"]["student"]>>;

  const asInstructor = () => createCaller(tx(), built.instructorId);

  beforeAll(async () => {
    built = await world(tx());
    outsiderId = await account(tx());

    // A second course of the term, so "a row per course" is a claim about a list rather than about
    // a single row that any answer of length one would satisfy.
    await makeCourse(tx(), { programId: built.programId });

    courseCount = await tx().course.count({ where: { programId: built.programId } });
    person = await asInstructor().programs.student({
      programId: built.programId,
      studentId: built.student.studentId,
    });
  });

  it("the fellow's record names them", () => {
    expect(person.student.id).toBe(built.student.studentId);
  });

  it("...and carries a row per course of the program", () => {
    expect(person.courses.length).toBe(courseCount);
  });

  it("...and their arrival averages", () => {
    expect([typeof person.arrivals.overall.count, person.arrivals.byWeekday.length]).toEqual([
      "number",
      7,
    ]);
  });

  it("a fellow cannot read another's record", async () => {
    const code = await refusal(() =>
      createCaller(tx(), built.student.studentId).programs.student({
        programId: built.programId,
        studentId: built.student.studentId,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("somebody not on the roster is refused rather than shown as empty", async () => {
    const code = await refusal(() =>
      asInstructor().programs.student({ programId: built.programId, studentId: outsiderId }),
    );
    expect(code).toBe("NOT_FOUND");
  });
});

/*
  ---- Removing, and the pair that must not come apart -------------------------------------------

  Every check below asserts both halves. A removed fellow who can still submit, and one who can no
  longer read what they were given, are both defects, and each is one enum value away from the other
  in code that reads the same.
*/
describe("removing a fellow from a program", () => {
  const tx = withRollback();

  let built: World;
  let leaverId: string;
  let stayerId: string;
  let leftBehindId: string;
  let untouchedId: string;

  /** What this fellow had waiting before they were removed, and what everybody else had. */
  let theirsBefore: number;
  let othersBefore: number;

  const asInstructor = () => createCaller(tx(), built.instructorId);
  const asLeaver = () => createCaller(tx(), leaverId);
  const enrollmentId = () => built.students[0]!.id;

  beforeAll(async () => {
    built = await world(tx(), { students: 2 });
    leaverId = built.students[0]!.studentId;
    stayerId = built.students[1]!.studentId;

    /*
      Two assignments and three submissions, so that removing one fellow leaves work behind. A pile
      holding only the departing fellow's work would satisfy "nobody else's left" while a filter
      that emptied the whole pile was in place.
    */
    const shared = await makeAssignment(tx(), {
      courseId: built.courseId,
      courseUnitId: built.unitId,
      title: named("Removal Shared"),
    });
    const untouched = await makeAssignment(tx(), {
      courseId: built.courseId,
      courseUnitId: built.unitId,
      title: named("Removal Untouched"),
    });
    leftBehindId = shared.id;
    untouchedId = untouched.id;

    await makeSubmission(tx(), { assignmentId: shared.id, studentId: leaverId });
    await makeSubmission(tx(), { assignmentId: shared.id, studentId: stayerId });
    await makeSubmission(tx(), { assignmentId: untouched.id, studentId: stayerId });

    const outstanding = await asInstructor().submissions.triage({ courseId: built.courseId });
    theirsBefore = outstanding.submissions.filter((row) => row.student.id === leaverId).length;
    othersBefore = outstanding.submissions.filter((row) => row.student.id !== leaverId).length;
  });

  /*
    Measured rather than assumed. Every check below asserts that something is *absent* from a list,
    and a fellow with nothing outstanding would satisfy all of them while measuring nothing at all.
  */
  it("this fellow has work in triage before being removed", () => {
    expect(theirsBefore).toBeGreaterThan(0);
  });

  describe("once they are removed", () => {
    let removed: { status: string };

    beforeAll(async () => {
      removed = await asInstructor().enrollments.remove({ enrollmentId: enrollmentId() });
    });

    it("removing sets the status", () => {
      expect(removed.status).toBe("REMOVED");
    });

    it("a removed fellow can still read the course", async () => {
      expect((await asLeaver().courses.get({ courseId: built.courseId })).id).toBe(built.courseId);
    });

    it("...and its modules, which order their own assignment list", async () => {
      const units = await asLeaver().courseUnits.listForCourse({ courseId: built.courseId });
      expect(Array.isArray(units)).toBe(true);
    });

    it("...and the course stays in their list", async () => {
      const mine = await asLeaver().courses.listMine();
      expect(mine.find((row) => row.id === built.courseId)?.enrolledAs).toBe("REMOVED");
    });

    it("...and can still read an assignment in it", async () => {
      const assignment = await asLeaver().assignments.get({ assignmentId: untouchedId });
      expect(assignment.courseId).toBe(built.courseId);
    });

    /*
      And cannot hand anything in. The message is checked, not only the refusal: "you are no longer
      enrolled" is a fact the fellow can act on, and the generic "you are not enrolled" would read
      as the application having lost them.
    */
    it("...and cannot accept anything new", async () => {
      const message = await refusalMessage(() =>
        asLeaver().assignments.accept({ assignmentId: untouchedId }),
      );
      expect(message).toContain("no longer enrolled");
    });

    it("a removed fellow is not counted as a student of the course", async () => {
      const book = await asInstructor().courses.gradebook({ courseId: built.courseId });
      expect(book.activeEnrollments.some((row) => row.student.id === leaverId)).toBe(false);
    });

    // Through `programs.roster`, which is the screen that shows them. The gradebook stopped
    // returning the whole enrollment list when the roster became its own read, and it is that
    // read's job to keep a departed fellow visible.
    it("...and is still on the roster, so they can be put back", async () => {
      const roster = await asInstructor().programs.roster({ programId: built.programId });
      expect(roster.enrollments.some((row) => row.student.id === leaverId)).toBe(true);
    });

    // A removed fellow redeeming the link again is refused: if it let them back in, removal would
    // not stick while they still held the link.
    it("a removed fellow cannot rejoin with the link", async () => {
      const token = await joinTokenOf(tx(), built.programId);
      expect(await refusal(() => asLeaver().enrollments.join({ token }))).toBe("FORBIDDEN");
    });

    it("a fellow cannot remove anybody", async () => {
      const code = await refusal(() =>
        createCaller(tx(), stayerId).enrollments.remove({ enrollmentId: enrollmentId() }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  /*
    ---- Out of the work lists, into the record --------------------------------------------------

    The pair that is the whole point of removing rather than deleting. Nobody is going to grade a
    submission from somebody who has left the program, so it must not sit in a list of work
    outstanding — and it must not vanish either, because how a fellow did before they left is the
    reason for keeping the row.

    Both halves in the same group, because each is one filter away from the other.
  */
  describe("out of the work lists, into the record", () => {
    let afterRemoval: number;

    beforeAll(async () => {
      afterRemoval = (await asInstructor().submissions.triage({ courseId: built.courseId }))
        .submissions.length;
    });

    it("a removed fellow's work leaves triage", async () => {
      const pile = await asInstructor().submissions.triage({ courseId: built.courseId });
      expect(pile.submissions.some((row) => row.student.id === leaverId)).toBe(false);
    });

    // And only theirs. A filter that emptied the whole pile would pass the check above.
    it("...and nobody else's does", () => {
      expect(afterRemoval).toBe(othersBefore);
    });

    it("...and leaves the assignment's queue", async () => {
      const queue = await asInstructor().submissions.listForAssignment({
        assignmentId: leftBehindId,
      });
      expect(queue.submissions.some((row) => row.student.id === leaverId)).toBe(false);
    });

    it("...while staying openable from the gradebook", async () => {
      const queue = await asInstructor().submissions.listForAssignment({
        assignmentId: leftBehindId,
      });
      expect(
        queue.asideSubmissions.some(
          (row) => row.student.id === leaverId && row.asideReason === "removed",
        ),
      ).toBe(true);
    });

    /*
      The two arrays are the whole of it. Written as one query partitioned in two rather than as a
      filter and its complement, because two queries can each miss a row and nothing says so — a
      submission in neither list is unreachable and unreported.
    */
    it("...and the two lists together are every submission", async () => {
      const queue = await asInstructor().submissions.listForAssignment({
        assignmentId: leftBehindId,
      });
      const held = await tx().submission.count({ where: { assignmentId: leftBehindId } });
      expect(queue.submissions.length + queue.asideSubmissions.length).toBe(held);
    });

    it("their grades move to the removed table", async () => {
      const book = await asInstructor().courses.gradebook({ courseId: built.courseId });
      expect(book.removedCells.some((cell) => cell.studentId === leaverId)).toBe(true);
    });

    it("...and out of the course's own", async () => {
      const book = await asInstructor().courses.gradebook({ courseId: built.courseId });
      expect(book.cells.some((cell) => cell.studentId === leaverId)).toBe(false);
    });

    it("...and they are listed as removed", async () => {
      const book = await asInstructor().courses.gradebook({ courseId: built.courseId });
      expect(book.removedEnrollments.some((row) => row.student.id === leaverId)).toBe(true);
    });

    /*
      Three readers, one claim, and they have to agree.

      "How much is outstanding in this course" is answered by grading triage, by the gradebook's own
      cells, and by the per-assignment "to grade" column — and the third is the one that can now
      drift, because its counts are computed in `assignmentsOverview` rather than derived in the
      browser from the gradebook's payload. Two counts kept in step by hand is exactly how the
      heading and triage disagreed before, with nothing on either screen to reconcile them.

      A removed fellow is what makes this worth asserting rather than tautological: every one of the
      three has to leave their work out, and each does it in a different place.
    */
    it("...so the gradebook's outstanding count matches triage", async () => {
      const book = await asInstructor().courses.gradebook({ courseId: built.courseId });
      const counted = book.cells.filter(
        (cell) => cell.bucket !== null && cell.bucket !== "generating",
      ).length;
      expect(counted).toBe(afterRemoval);
    });

    it("...and so does the assignments list, which counts them server-side", async () => {
      const overview = await asInstructor().courses.assignmentsOverview({
        courseId: built.courseId,
      });
      const counted = overview.assignments.reduce(
        (total, row) => total + row.counts.outstanding,
        0,
      );
      expect(counted).toBe(afterRemoval);
    });
  });

  /*
    And their work comes back with them, unchanged. Nothing was closed or rewritten on removal,
    which is what makes this reversible: the filter reads live enrollment status, so restoring
    somebody is the whole of putting their unfinished work back on the pile.
  */
  describe("and put back again", () => {
    let restored: { status: string };

    beforeAll(async () => {
      restored = await asInstructor().enrollments.restore({ enrollmentId: enrollmentId() });
    });

    it("the instructor can put them back", () => {
      expect(restored.status).toBe("ACTIVE");
    });

    it("...and they are counted again", async () => {
      const book = await asInstructor().courses.gradebook({ courseId: built.courseId });
      expect(book.activeEnrollments.some((row) => row.student.id === leaverId)).toBe(true);
    });

    it("...and their outstanding work is back in triage", async () => {
      const pile = await asInstructor().submissions.triage({ courseId: built.courseId });
      expect(pile.submissions.filter((row) => row.student.id === leaverId).length).toBe(
        theirsBefore,
      );
    });
  });
});

/*
  A roster belongs to one term, so being expected on one says nothing about another. That is the
  point of the allowlist being the program's rather than the school's, and it is what makes a fellow
  repeating a year join the new term rather than inherit the old one's admission.
*/
describe("a roster belongs to one program", () => {
  const tx = withRollback();

  let elsewhereId: string;
  let joinerId: string;

  beforeAll(async () => {
    const built = await world(tx());
    joinerId = await account(tx());

    const elsewhere = await makeProgram(tx());
    programsMade.push(elsewhere.id);
    elsewhereId = elsewhere.id;

    // Expected on the first program's roster, and admitted by it, so the check below is about a
    // fellow who really has been written down somewhere rather than about somebody unknown to
    // every roster in the database.
    await createCaller(tx(), built.instructorId).enrollments.addToRoster({
      programId: built.programId,
      entries: [{ ...(await rosterKeysOf(tx(), joinerId)), note: null }],
    });
    await createCaller(tx(), joinerId).enrollments.join({
      token: await joinTokenOf(tx(), built.programId),
    });
  });

  it("being expected on one roster is not being expected on another", async () => {
    const held = await tx().rosterEntry.count({
      where: { programId: elsewhereId, claimedById: joinerId },
    });
    expect(held).toBe(0);
  });
});

/*
  An enrollment id says nothing about which program it is in until the row is read, which is why the
  procedure loads it before checking who is asking. Removing a fellow from a term this instructor
  does instruct is allowed; the refusal for a fellow asking covers the role, and this covers the
  program.
*/
describe("an enrollment in a program you instruct", () => {
  const tx = withRollback();

  it("an enrollment in a program you instruct can be removed", async () => {
    const built = await world(tx());
    const removed = await createCaller(tx(), built.instructorId).enrollments.remove({
      enrollmentId: built.student.id,
    });
    expect(removed.status).toBe("REMOVED");
  });
});

/*
  ---- Deleting a course -------------------------------------------------------------------------

  The course, not the program: deleting one of those is `tests/integration/programs`. What earns its
  place here is the pair the program above the course created — deleting one course of several
  leaves the roster, the cohorts and the attendance exactly where they were.
*/
describe("deleting a course", () => {
  const tx = withRollback();

  let built: World;
  let doomedId: string;
  let doomedSlug: string;
  let doomedModuleId: string;
  let enrolledBefore: number;

  const asInstructor = () => createCaller(tx(), built.instructorId);

  beforeAll(async () => {
    built = await world(tx());

    const doomed = await asInstructor().courses.create({
      programId: built.programId,
      name: named("Deletion"),
    });
    doomedId = doomed.course.id;
    doomedSlug = doomed.course.slug;

    doomedModuleId = (
      await asInstructor().courseUnits.create({
        category: "MODULE",
        courseId: doomedId,
        name: named("Doomed Module"),
      })
    ).id;

    enrolledBefore = await tx().enrollment.count({ where: { programId: built.programId } });
  });

  it("a course that is still running cannot be deleted", async () => {
    const code = await refusal(() =>
      asInstructor().courses.remove({ courseId: doomedId, confirmSlug: doomedSlug }),
    );
    expect(code).toBe("PRECONDITION_FAILED");
  });

  it("...and its impact cannot even be read", async () => {
    const code = await refusal(() => asInstructor().courses.removalImpact({ courseId: doomedId }));
    expect(code).toBe("PRECONDITION_FAILED");
  });

  describe("once it is archived", () => {
    let impact: { courseUnits: number; slug: string; enrollments: number };

    beforeAll(async () => {
      await asInstructor().courses.setArchived({ courseId: doomedId, archived: true });
      impact = await asInstructor().courses.removalImpact({ courseId: doomedId });
    });

    it("...its course units", () => {
      expect(impact.courseUnits).toBe(1);
    });

    it("...and asks for the short name rather than the course name", () => {
      expect(impact.slug).toBe(doomedSlug);
    });

    /*
      The roster is named and not counted as a loss, which is the whole difference between this and
      deleting the term. A reader weighing the numbers above needs to know the roster is their
      denominator rather than one of them.
    */
    it("...and reports the roster as something that stays", () => {
      expect(impact.enrollments).toBe(enrolledBefore);
    });

    it("the wrong confirmation is refused", async () => {
      const code = await refusal(() =>
        asInstructor().courses.remove({ courseId: doomedId, confirmSlug: named("Deletion") }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("...and the course is still there", async () => {
      expect(await tx().course.count({ where: { id: doomedId } })).toBe(1);
    });
  });

  describe("and then deleted", () => {
    let deleted: { name: string };

    beforeAll(async () => {
      deleted = await asInstructor().courses.remove({
        courseId: doomedId,
        confirmSlug: doomedSlug,
      });
    });

    it("the owner can delete an archived course", () => {
      expect(deleted.name).toBe(named("Deletion"));
    });

    it("...and it is gone", async () => {
      expect(await tx().course.count({ where: { id: doomedId } })).toBe(0);
    });

    it("...taking its modules with it", async () => {
      expect(await tx().courseUnit.count({ where: { id: doomedModuleId } })).toBe(0);
    });

    /*
      And leaving the roster alone, which is the check the program above the course made possible
      and the one worth reading. Enrollments belong to the term now: deleting one course of several
      must not remove a single fellow from it.
    */
    it("...and leaving every fellow on the roster", async () => {
      const held = await tx().enrollment.count({ where: { programId: built.programId } });
      expect(held).toBe(enrolledBefore);
    });

    it("...and it leaves the course list", async () => {
      const mine = await asInstructor().courses.listMine();
      expect(mine.some((row) => row.id === doomedId)).toBe(false);
    });

    it("...while a course deleted twice is simply not found", async () => {
      const code = await refusal(() =>
        asInstructor().courses.remove({ courseId: doomedId, confirmSlug: doomedSlug }),
      );
      expect(code).toBe("NOT_FOUND");
    });
  });
});

/*
  Nothing survived. Every account and every program above was made inside a transaction, so once all
  of them have rolled back none of it exists. Read outside any transaction, after every group has
  ended.

  Each check asserts that this run created some to begin with as well as that none is left, because
  a count of zero on its own cannot tell a transaction that rolled back from a run that made nothing
  at all.
*/
describe("nothing survived the rollback", () => {
  it("no account this suite created survived", async () => {
    const left = await db.profile.count({ where: { id: { in: accountsMade } } });
    expect([accountsMade.length > 0, left]).toEqual([true, 0]);
  });

  it("...and no program it created did either", async () => {
    const left = await db.program.count({ where: { id: { in: programsMade } } });
    expect([programsMade.length > 0, left]).toEqual([true, 0]);
  });
});
