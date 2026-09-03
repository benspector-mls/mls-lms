/**
 * Test students: who may make one, who may look through one, and the two ways this could have been
 * a hole.
 *
 * Run with `npm run test:integration`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, so the guards are the
 * ones an admin actually meets. **The rows a test student needs are made by marking a fixture
 * student inside that transaction** rather than by creating an account — a `testStudentNumber` is
 * the whole of what makes a profile one, and creating a Supabase auth user is not something a
 * transaction can undo.
 *
 * **Two groups matter more than the rest.** `enroll` and `remove` refusing a profile that is not a
 * test student is the entire difference between this feature and a mutation that puts anybody in any
 * course and deletes anybody's account with every grade they were ever given. And the view-as group
 * asserts the rule from both ends: that a non-admin holding a valid cookie value is answered as
 * themselves, and that an admin holding a real one is answered as the test student — because a
 * substitution that works is worth nothing if the check permitting it does not.
 *
 * Carries the 31 assertions of `verify:test-student` that need a database, and eight more. Ten of
 * that script's checks needed nothing at all and are now `tests/lib/students/test-student.test.ts`
 * and `tests/lib/auth/view-as.test.ts`, which run on every save.
 *
 * **What stays a script is what cannot be done without a real account or a real repository.** Its
 * `--live` group creates a Supabase auth user, enrols it, previews its removal and deletes it again,
 * and its `--live --github` group generates a repository from a template and reads its collaborators
 * back — which is the only way to know that a test student's own handle is never sent to GitHub.
 * Neither can be asked of a rolled-back transaction, so both are still in
 * `scripts/verify-test-student.ts` along with the check that the run left no test student behind.
 *
 * **Every row here is made rather than found, and that repairs three things the script could not
 * do.**
 *
 *   - The instructor refused at all five procedures is a plain INSTRUCTOR, made for the purpose. The
 *     script looked for one and stood down when a deployment's only instructor was also the admin —
 *     which is the group that says `adminProcedure` was used rather than `instructorProcedure`, so a
 *     run without it had not checked the thing most worth checking. The first test of that group
 *     reads the role back, because a fixture that quietly became an admin would make the other five
 *     assert that the one person who is allowed is allowed.
 *   - The refusing half of the view-as rule is always checked. It needed a non-admin who was not the
 *     marked profile, and the script skipped it when the database held nobody else; there is a
 *     second fellow on the roster here.
 *   - "an admin may list them" asserted only that an array came back, which is what an empty answer
 *     is too. The list is now read after a profile has been marked, and is asserted to hold that
 *     profile as already on this roster and to hold no unmarked fellow at all.
 *
 * Two further checks are new because a marked stand-in can hold work where a freshly created test
 * student cannot: `removalPreview` names the repository that deleting one would destroy, and counts
 * the submission. That is the text of the confirmation an admin reads before pressing Delete, and
 * the script could only ever see it empty.
 */
import { acceptableAssignmentSelect, acceptRepoAssignment } from "@/lib/assignments/accept";
import { resolveViewAs } from "@/lib/auth/view-as";
import { db } from "@/lib/prisma";
import { testStudentHandle } from "@/lib/students/test-student";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAccount, makeAssignment, makeSubmission, makeWorld, type World } from "./fixtures";
import { required, withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);

/** The procedures as one user would reach them, bound to this group's transaction. */
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/** What a call refused with, as a string to compare against. */
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
 * A number no real deployment will reach, so a marked row is obvious if one ever escapes.
 *
 * `Profile.testStudentNumber` is unique across the deployment, and three groups below mark a profile
 * with this one. They hold separate transactions and run one after another, so no two markings are
 * ever live at the same moment.
 */
const FAKE_NUMBER = 999_001;

/**
 * Every account this file makes, so the last group can ask whether any of them survived.
 *
 * The script asked the same question of the deployment it ran against; here the answer is a fact
 * about the transactions rather than about a database somebody else is using.
 */
const createdHere: string[] = [];

/** An account made inside a group's transaction, recorded so the last group can look for it. */
async function account(tx: Tx, options: Parameters<typeof makeAccount>[1] = {}) {
  const id = await makeAccount(tx, options);
  createdHere.push(id);
  return id;
}

/*
  ---- Who may call these at all ------------------------------------------------

  One transaction for the three refusal groups and the accept refusals, because none of them writes
  anything: what they establish is which callers are turned away, and every one of them is turned
  away before a procedure reaches the database. The groups that mark a profile hold transactions of
  their own further down, so that one group's marking cannot be another group's starting state.
*/
describe("who may make and delete a test student", () => {
  const tx = withRollback();

  let world: World;
  let adminId: string;
  /** The fixture fellow, whose profile stands in for a test student where one is needed. */
  let fellowId: string;

  const asAdmin = () => createCaller(tx(), adminId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 1 });
    createdHere.push(world.instructorId, ...world.students.map((row) => row.studentId));
    adminId = await account(tx(), { role: "ADMIN" });
    fellowId = world.student.studentId;
  });

  describe("a fellow reaches none of them", () => {
    it("a fellow cannot list test students", async () => {
      const asStudent = createCaller(tx(), fellowId);
      expect(await refusal(() => asStudent.testStudents.list({ programId: world.programId }))).toBe(
        "FORBIDDEN",
      );
    });

    it("a fellow cannot create one", async () => {
      const asStudent = createCaller(tx(), fellowId);
      expect(
        await refusal(() => asStudent.testStudents.create({ programId: world.programId })),
      ).toBe("FORBIDDEN");
    });

    it("a fellow cannot enrol one", async () => {
      const asStudent = createCaller(tx(), fellowId);
      const code = await refusal(() =>
        asStudent.testStudents.enroll({ programId: world.programId, profileId: fellowId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a fellow cannot delete one", async () => {
      const asStudent = createCaller(tx(), fellowId);
      expect(await refusal(() => asStudent.testStudents.remove({ profileId: fellowId }))).toBe(
        "FORBIDDEN",
      );
    });

    // An admin is admitted at the read, so the refusals are about the role rather than about the
    // procedures being broken for everybody.
    it("an admin may list them", async () => {
      const listed = await asAdmin().testStudents.list({ programId: world.programId });
      expect(Array.isArray(listed)).toBe(true);
    });
  });

  /*
    An instructor is refused at every one of the five, which is the check that says `adminProcedure`
    was used rather than `instructorProcedure`. All five rather than one: the guard is per procedure,
    so four correct ones say nothing about the fifth.

    The instructor is made here and is a plain INSTRUCTOR. `role: { in: ["INSTRUCTOR", "ADMIN"] }` is
    the obvious way to write "an instructor of this program" and it is wrong here: on a deployment
    whose only instructor is the admin it selects the admin, and every check below then asserts that
    the one person who is allowed is allowed — and passes. It did, three times, which is what a
    fixture chosen through a proxy for the property it needs eventually does.
  */
  describe("an instructor reaches none of them either", () => {
    const asInstructor = () => createCaller(tx(), world.instructorId);

    // Read back rather than assumed, because every refusal below would pass for the wrong reason if
    // this account were an admin.
    it("the instructor these five refuse is not an admin", async () => {
      const row = await tx().profile.findUniqueOrThrow({
        where: { id: world.instructorId },
        select: { role: true },
      });
      expect(row.role).toBe("INSTRUCTOR");
    });

    it("an instructor cannot list test students", async () => {
      const code = await refusal(() =>
        asInstructor().testStudents.list({ programId: world.programId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("an instructor cannot create one", async () => {
      const code = await refusal(() =>
        asInstructor().testStudents.create({ programId: world.programId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("an instructor cannot enrol one", async () => {
      const code = await refusal(() =>
        asInstructor().testStudents.enroll({ programId: world.programId, profileId: fellowId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("an instructor cannot delete one", async () => {
      const code = await refusal(() => asInstructor().testStudents.remove({ profileId: fellowId }));
      expect(code).toBe("FORBIDDEN");
    });

    it("an instructor cannot read what deleting one would destroy", async () => {
      const code = await refusal(() =>
        asInstructor().testStudents.removalPreview({ profileId: fellowId }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  /*
    The guard that keeps this from being an escalation. An admin is admitted to these procedures and
    is still refused every real person, which is what makes `remove` a way to delete a preview rather
    than a way to delete a student and every grade they were ever given.
  */
  describe("not even an admin, against a real person", () => {
    it("an admin cannot enrol a real person this way", async () => {
      const code = await refusal(() =>
        asAdmin().testStudents.enroll({ programId: world.programId, profileId: fellowId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("an admin cannot delete a real person's account this way", async () => {
      expect(await refusal(() => asAdmin().testStudents.remove({ profileId: fellowId }))).toBe(
        "FORBIDDEN",
      );
    });

    it("nor read what deleting one would destroy", async () => {
      const code = await refusal(() => asAdmin().testStudents.removalPreview({ profileId: fellowId }));
      expect(code).toBe("FORBIDDEN");
    });

    // The admin's own account is a real person's too, and is the one somebody would reach for by
    // accident.
    it("an admin cannot delete their own account this way", async () => {
      expect(await refusal(() => asAdmin().testStudents.remove({ profileId: adminId }))).toBe(
        "FORBIDDEN",
      );
    });
  });

  /*
    ---- Accepting: the two refusals, before anything is created ----------------

    All three are made before `acceptRepoAssignment` asks whether the GitHub App is configured, so
    nothing here reaches GitHub. The acceptance itself is the `--github` group of the script, because
    the only way to know that a test student's own handle is never sent to GitHub is to accept for
    real and read the repository's collaborators back.

    The assignment is made here. The script had to order its search by repository name, because an
    unordered `findFirst` picked a different seeded assignment on different runs and a check whose
    fixture moves is a check whose result cannot be compared with its last result.
  */
  describe("what a test student is refused when it accepts", () => {
    let assignment: Awaited<ReturnType<typeof loadAssignment>>;

    /** The assignment with the columns accepting reads, which is a different select from the row. */
    async function loadAssignment(id: string) {
      return required(
        "the repository assignment this group just created, read back with the columns " +
          "acceptRepoAssignment selects",
        await tx().assignment.findUnique({ where: { id }, select: acceptableAssignmentSelect }),
      );
    }

    beforeAll(async () => {
      const created = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        kind: "REPO",
        title: "Integration Repo Assignment",
      });
      assignment = await loadAssignment(created.id);
    });

    /** A test student as accepting sees one: a number, and a handle naming no GitHub account. */
    const testStudent = () => ({
      id: fellowId,
      githubUsername: testStudentHandle(FAKE_NUMBER),
      testStudentNumber: FAKE_NUMBER,
    });

    it("a test student cannot accept with no admin behind it", async () => {
      const code = await refusal(() =>
        acceptRepoAssignment(tx(), { assignment, student: testStudent(), actingAdmin: null }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("nor with an admin who has not linked GitHub", async () => {
      const code = await refusal(() =>
        acceptRepoAssignment(tx(), {
          assignment,
          student: testStudent(),
          actingAdmin: { githubUsername: null, email: "someone@example.com" },
        }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    /*
      The refusal for a *real* student is unchanged and is checked here beside the new ones, because
      the branch above sits in the same function and a mistake in it would most likely show up as
      this one no longer firing.
    */
    it("a real student with no GitHub account is still refused", async () => {
      const code = await refusal(() =>
        acceptRepoAssignment(tx(), {
          assignment,
          student: { id: fellowId, githubUsername: null, testStudentNumber: null },
          actingAdmin: null,
        }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });
  });
});

/*
  ---- Looking through one: the rule from both ends -----------------------------

  Its own transaction, because it marks a profile and the groups above are about a roster with no
  test student on it.
*/
describe("looking through a test student", () => {
  const tx = withRollback();

  /** The admin's name is asserted rather than merely present, so the banner has something to say. */
  const ADMIN_NAME = "Integration Admin";

  let world: World;
  let adminId: string;
  /** The fellow this group marks, which makes it a test student for the length of the transaction. */
  let markedId: string;
  /**
   * Somebody who is neither an admin nor the profile this group marks.
   *
   * Wanted for one check — a non-admin holding a valid cookie value is refused — which cannot use
   * the marked profile, since a caller and a target that are the same id are refused by a different
   * rule and would pass without testing this one.
   */
  let otherFellowId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    createdHere.push(world.instructorId, ...world.students.map((row) => row.studentId));
    adminId = await account(tx(), { role: "ADMIN", displayName: ADMIN_NAME });

    markedId = world.students[0]!.studentId;
    otherFellowId = world.students[1]!.studentId;

    await tx().profile.update({
      where: { id: markedId },
      data: { testStudentNumber: FAKE_NUMBER },
    });
  });

  const permitted = () =>
    resolveViewAs(tx(), { realUserId: adminId, cookieValue: markedId });

  it("an admin may look through a test student", async () => {
    expect(await permitted()).not.toBeNull();
  });

  it("...and the substitution names it", async () => {
    expect((await permitted())?.testStudent.number).toBe(FAKE_NUMBER);
  });

  it("...while keeping the real admin", async () => {
    expect((await permitted())?.admin.id).toBe(adminId);
  });

  /*
    A non-admin holding exactly the value that works for an admin. The pair is the check: the same
    cookie, two callers, one refused — which is what says the entitlement is the caller's role and
    not the cookie's contents.
  */
  it("a fellow may not, holding the same value", async () => {
    const resolved = await resolveViewAs(tx(), {
      realUserId: otherFellowId,
      cookieValue: markedId,
    });
    expect(resolved).toBeNull();
  });

  it("nor may the test student itself", async () => {
    const resolved = await resolveViewAs(tx(), { realUserId: markedId, cookieValue: markedId });
    expect(resolved).toBeNull();
  });

  it("an admin may not look through a real person", async () => {
    const resolved = await resolveViewAs(tx(), { realUserId: adminId, cookieValue: otherFellowId });
    expect(resolved).toBeNull();
  });

  it("a value that is not a uuid is refused without a query", async () => {
    const resolved = await resolveViewAs(tx(), { realUserId: adminId, cookieValue: "not-a-uuid" });
    expect(resolved).toBeNull();
  });

  /*
    What the substitution actually produces, through the caller.

    This is the whole feature in one assertion: a context whose user id is the test student's answers
    `me` as the test student, which is what makes every screen and every guard behave.
  */
  describe("what the caller answers under the substitution", () => {
    const asTestStudent = async () =>
      factory({ db: tx(), user: { id: markedId }, viewingAs: await permitted() } as never);

    it("me answers as the test student", async () => {
      expect((await (await asTestStudent()).me())?.id).toBe(markedId);
    });

    it("...and reports the number, so the banner can name it", async () => {
      expect((await (await asTestStudent()).me())?.testStudentNumber).toBe(FAKE_NUMBER);
    });

    it("viewingAs names the admin behind it", async () => {
      const viewingAs = await (await asTestStudent()).viewingAs();
      expect(viewingAs?.admin.displayName).toBe(ADMIN_NAME);
    });

    // And the ordinary case reports nothing, which is what the banner renders nothing for.
    it("viewingAs is null when nobody is looking through anybody", async () => {
      const asAdmin = factory({ db: tx(), user: { id: adminId }, viewingAs: null } as never);
      expect(await asAdmin.viewingAs()).toBeNull();
    });
  });
});

/*
  ---- The one count a test student must stay out of, and the list it must stay in ----

  Its own transaction, for the reason the group above has one: it marks a profile, and it reads a
  count before doing so.
*/
describe("what a roster says about a test student", () => {
  const tx = withRollback();

  let world: World;
  let adminId: string;
  let markedId: string;
  let plainFellowId: string;

  /*
    The admin, because this group is about the count rather than about who may read it — and an admin
    can read every program's, so it does not depend on a plain instructor existing.
  */
  const asStaff = () => createCaller(tx(), adminId);

  let countBefore: number | undefined;
  let countAfter: number | undefined;
  let rosterBefore: number;
  let rosterAfter: number;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    createdHere.push(world.instructorId, ...world.students.map((row) => row.studentId));
    adminId = await account(tx(), { role: "ADMIN" });

    markedId = world.students[0]!.studentId;
    plainFellowId = world.students[1]!.studentId;

    const listedBefore = await asStaff().programs.listMine();
    countBefore = listedBefore.find((row) => row.id === world.programId)?._count.enrollments;
    rosterBefore = (await asStaff().programs.roster({ programId: world.programId })).enrollments
      .length;

    await tx().profile.update({
      where: { id: markedId },
      data: { testStudentNumber: FAKE_NUMBER },
    });

    const listedAfter = await asStaff().programs.listMine();
    countAfter = listedAfter.find((row) => row.id === world.programId)?._count.enrollments;
    rosterAfter = (await asStaff().programs.roster({ programId: world.programId })).enrollments
      .length;
  });

  it("the program card counted both fellows to begin with", () => {
    expect(countBefore).toBe(2);
  });

  it("the program card stops counting a fellow that becomes a test student", () => {
    expect(countAfter).toBe(1);
  });

  it("and the roster goes on listing them", () => {
    expect(rosterAfter).toBe(rosterBefore);
  });

  it("the roster says which one is a test student", async () => {
    const roster = await asStaff().programs.roster({ programId: world.programId });
    const marked = roster.enrollments.find((row) => row.student.id === markedId);
    expect(marked?.student.testStudentNumber).toBe(FAKE_NUMBER);
  });

  /*
    The list the dialog on the roster reads. Asserted by contents rather than by being an array: an
    empty answer is an array too, which is all the script could establish about a database it had not
    written to.
  */
  it("the marked profile is offered as already on this roster", async () => {
    const listed = await asStaff().testStudents.list({ programId: world.programId });
    expect(listed.find((row) => row.id === markedId)?.enrollmentStatus).toBe("ACTIVE");
  });

  it("...and an ordinary fellow of the same roster is not on the list at all", async () => {
    const listed = await asStaff().testStudents.list({ programId: world.programId });
    expect(listed.some((row) => row.id === plainFellowId)).toBe(false);
  });
});

/*
  ---- What deleting one would destroy ------------------------------------------

  The text of the confirmation an admin reads before pressing Delete. Its own transaction, because it
  marks a profile and hangs work on it.

  A marked stand-in is what makes this checkable at all: a test student created for real has accepted
  nothing, so the script could only ever see this answer empty.
*/
describe("what deleting a test student would destroy", () => {
  const tx = withRollback();

  let world: World;
  let adminId: string;
  let markedId: string;
  let repoFullName: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 1 });
    createdHere.push(world.instructorId, ...world.students.map((row) => row.studentId));
    adminId = await account(tx(), { role: "ADMIN" });
    markedId = world.student.studentId;

    await tx().profile.update({
      where: { id: markedId },
      data: { testStudentNumber: FAKE_NUMBER },
    });

    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      kind: "REPO",
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: assignment.id,
      studentId: markedId,
      status: "ACCEPTED",
    });

    /*
      The repository name is written straight to the row rather than by accepting, because accepting
      generates a real repository. `Submission.repoFullName` is unique across the deployment, so the
      name carries this run's own uuid.
    */
    repoFullName = `marcy-lms/integration-${crypto.randomUUID().slice(0, 8)}`;
    await tx().submission.update({
      where: { id: submission.id },
      data: { repoFullName, repoUrl: `https://github.com/${repoFullName}` },
    });
  });

  it("the preview counts the work that would go with the account", async () => {
    const preview = await createCaller(tx(), adminId).testStudents.removalPreview({
      profileId: markedId,
    });
    expect(preview.submissionCount).toBe(1);
  });

  /*
    Named rather than counted, which is the point of the confirmation: "1 repository" is a number to
    agree with, and a name is something to recognise.
  */
  it("...and names the repository it would delete", async () => {
    const preview = await createCaller(tx(), adminId).testStudents.removalPreview({
      profileId: markedId,
    });
    expect(preview.repositories).toEqual([repoFullName]);
  });
});

/*
  Nothing survived. Every account above was made inside a transaction that has since been rolled
  back, and every marking with it — which is the same claim the script's last check makes about the
  deployment it ran against.
*/
describe("nothing survived the rollback", () => {
  it("this run did create accounts to begin with", () => {
    expect(createdHere.length).toBeGreaterThan(0);
  });

  it("...and none of them exists", async () => {
    expect(await db.profile.count({ where: { id: { in: createdHere } } })).toBe(0);
  });

  // The number this file marks with, asked of the whole table: a marking that escaped its
  // transaction would be a profile carrying it and belonging to nobody.
  it("no profile is left carrying the number this file marks with", async () => {
    expect(await db.profile.count({ where: { testStudentNumber: FAKE_NUMBER } })).toBe(0);
  });
});
