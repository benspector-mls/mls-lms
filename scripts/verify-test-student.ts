/**
 * Test students: making one, looking through one, and the two ways this could have been a hole.
 *
 * Run with `npm run verify:test-student`. Two gates widen it: `-- --live` creates and deletes a real
 * Supabase account, and `-- --live --github` also generates and deletes a real repository.
 *
 * Nearly all of it runs inside a transaction that is rolled back, driven through the tRPC callers
 * so the guards are the ones an admin actually meets. **The rows a test student needs are made by
 * marking a real student inside that transaction** rather than by creating an account — a
 * `testStudentNumber` is the whole of what makes a profile one, and creating an auth user is not
 * something a transaction can undo. `verify-enrollment.ts` reaches for the same technique when it
 * clears `isPrimary` to reach a state no procedure produces.
 *
 * **Two groups matter more than the rest.** `enroll` and `remove` refusing a profile that is not a
 * test student is the entire difference between this feature and a mutation that puts anybody in any
 * course and deletes anybody's account with every grade they were ever given. And the view-as group
 * asserts the rule from both ends: that a non-admin holding a valid cookie value is answered as
 * themselves, and that an admin holding a real one is answered as the test student — because a
 * substitution that works is worth nothing if the check permitting it does not.
 *
 * The transactional accept group asserts the refusals; the acceptance itself is under `--github`,
 * because the only way to know that a test student's own handle is never sent to GitHub is to accept
 * for real and read the repository's collaborators back. Both gated groups are self-cleaning — each
 * deletes what it made, through the same `remove` an admin presses — but each is a real account, a
 * real row, and in the second case a real repository while it runs. Without a flag its group is
 * reported as not run, and the rest still passes.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

/** A number no real deployment will reach, so a marked row is obvious if one ever escapes. */
const FAKE_NUMBER = 999_001;

async function main() {
  const live = process.argv.includes("--live");
  const github = process.argv.includes("--github");

  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { isUuid, resolveViewAs } = await import("../lib/auth/view-as");
  const { acceptRepoAssignment, acceptableAssignmentSelect } =
    await import("../lib/assignments/accept");
  const { testStudentEmail, testStudentHandle, testStudentName, isTestStudent } =
    await import("../lib/students/test-student");
  const { createAuthUser, deleteAuthUser } = await import("../lib/supabase/admin");

  const createCaller = createCallerFactory(appRouter);

  /*
    The test students that existed before this run, so the last check can prove none were added.

    The gated groups create real accounts and real repositories and delete them again, and the way
    that fails is silent: a run whose cleanup did not finish prints every `ok` it earned and leaves
    an account holding a number, a submission, and a repository. That happened, and it was found by
    hand days later rather than by the script that caused it.

    Compared as a set rather than a count, and against the set that was here rather than against
    zero — a deployment may legitimately hold test students an admin is using, and a run must not
    report those as its own litter.
  */
  const testStudentsBefore = (
    await db.profile.findMany({
      where: { testStudentNumber: { not: null } },
      select: { id: true },
    })
  ).map((row) => row.id);

  // ---------------------------------------------------------------------------
  // The derived strings, which are pure and need no database at all.
  // ---------------------------------------------------------------------------
  check("the display name is the number", testStudentName(3), "Test Student 3");
  check("the handle is the number", testStudentHandle(3), "test-student-3");
  check("the address is unreachable by design", testStudentEmail(3), "test-student-3@test.invalid");
  check("a null number is not a test student", isTestStudent({ testStudentNumber: null }), false);
  check("a number is", isTestStudent({ testStudentNumber: 1 }), true);

  /*
    The shape check that guards a redirect path.

    Leaving a test student's view builds `/instructor/courses/{id}/settings` from a cookie, and a
    cookie is a value somebody can set. Each string below is one somebody would try.
  */
  check("a uuid is a uuid", isUuid("b549d23b-76ac-41a8-ba40-13f3249d3c63"), true);
  check("a traversal is not", isUuid("../../../evil"), false);
  check("nor is a protocol-relative host", isUuid("//evil.example"), false);
  check(
    "nor is a uuid with a path stuck to it",
    isUuid("b549d23b-76ac-41a8-ba40-13f3249d3c63/x"),
    false,
  );
  check("nor is the empty string", isUuid(""), false);

  // ---------------------------------------------------------------------------
  // Fixtures. Every group below needs a course with a real student in it, an
  // instructor of that course, and an admin.
  // ---------------------------------------------------------------------------
  const course = await db.course.findFirst({
    where: { archivedAt: null, enrollments: { some: { status: "ACTIVE" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  const admin = await db.profile.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, githubUsername: true, email: true },
  });

  /*
    An instructor who is **not** an admin, and the reason the role is named exactly.

    `role: { in: ["INSTRUCTOR", "ADMIN"] }` is the obvious way to write "an instructor of this
    course" and it is wrong here: on a deployment whose only instructor is the admin it selects the
    admin, and every "an instructor is refused" check below then asserts that the one person who is
    allowed is allowed — and passes. It did, three times, which is what the harness means by a
    fixture chosen through a proxy for the property it needs.

    Optional rather than required, because a deployment can legitimately have no plain instructor.
    The group that needs one says so instead of substituting somebody.
  */
  const instructor = course
    ? await db.courseInstructor.findFirst({
        where: { courseId: course.id, user: { role: "INSTRUCTOR" } },
        select: { userId: true },
      })
    : null;

  /*
    A real student of that course, whose row is what the transaction marks.

    Chosen for `testStudentNumber: null` explicitly rather than assumed: running this twice against
    a database where a previous run leaked would otherwise pick a test student to stand in for a
    real one, and every check comparing the two would pass without comparing anything.
  */
  const realStudent = course
    ? await db.enrollment.findFirst({
        where: {
          courseId: course.id,
          status: "ACTIVE",
          student: { role: "STUDENT", testStudentNumber: null },
        },
        select: { id: true, studentId: true },
      })
    : null;

  /**
   * Somebody who is neither an admin nor the profile the transaction marks.
   *
   * Wanted for one check — a non-admin holding a valid cookie value is refused — which cannot use
   * the marked profile, since a caller and a target that are the same id are refused by a different
   * rule and would pass without testing this one.
   */
  const otherNonAdmin = realStudent
    ? await db.profile.findFirst({
        where: { role: { not: "ADMIN" }, id: { not: realStudent.studentId } },
        select: { id: true, role: true },
      })
    : null;

  if (!course || !admin || !realStudent) {
    skip(
      "needs an unarchived course with an active student, plus an admin account. " +
        `Found course=${Boolean(course)} admin=${Boolean(admin)} student=${Boolean(realStudent)}. ` +
        "Seed with npm run db:seed and grant an admin with npm run grant:admin.",
    );
    finish();
    await db.$disconnect();
    return;
  }

  // ---------------------------------------------------------------------------
  // Who may call these at all.
  // ---------------------------------------------------------------------------
  await inOwnTransaction(db, async (tx) => {
    const asStudent = createCaller({ db: tx, user: { id: realStudent.studentId } } as never);
    const asAdmin = createCaller({ db: tx, user: { id: admin.id } } as never);

    const courseId = course.id;

    check(
      "a student cannot list test students",
      await refusal(() => asStudent.testStudents.list({ courseId })),
      "FORBIDDEN",
    );
    check(
      "a student cannot create one",
      await refusal(() => asStudent.testStudents.create({ courseId })),
      "FORBIDDEN",
    );
    check(
      "a student cannot enrol one",
      await refusal(() =>
        asStudent.testStudents.enroll({ courseId, profileId: realStudent.studentId }),
      ),
      "FORBIDDEN",
    );
    check(
      "a student cannot delete one",
      await refusal(() => asStudent.testStudents.remove({ profileId: realStudent.studentId })),
      "FORBIDDEN",
    );

    // An admin is admitted at the read, so the refusals are about the role rather than about the
    // procedures being broken for everybody.
    check(
      "an admin may list them",
      Array.isArray(await asAdmin.testStudents.list({ courseId })),
      true,
    );
  });

  /*
    An instructor is refused at every one of the five, which is the check that says
    `adminProcedure` was used rather than `instructorProcedure`. All five rather than one: the guard
    is per procedure, so four correct ones say nothing about the fifth.

    Skipped rather than approximated when the deployment's only instructor is the admin. A skip
    fails the run, which is the harness's design and is right here — this is the group that would
    catch the wrong builder being used, so a run without it has not checked the thing most worth
    checking.
  */
  if (!instructor) {
    skip(
      `${course.name} has no instructor who is not also an admin, so the checks that an ` +
        "instructor is refused cannot be made. Redeem a staff invitation for a second account, or " +
        "add a plain INSTRUCTOR to this course.",
    );
  } else {
    await inOwnTransaction(db, async (tx) => {
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
      const courseId = course.id;

      check(
        "an instructor cannot list test students",
        await refusal(() => asInstructor.testStudents.list({ courseId })),
        "FORBIDDEN",
      );
      check(
        "an instructor cannot create one",
        await refusal(() => asInstructor.testStudents.create({ courseId })),
        "FORBIDDEN",
      );
      check(
        "an instructor cannot enrol one",
        await refusal(() =>
          asInstructor.testStudents.enroll({ courseId, profileId: realStudent.studentId }),
        ),
        "FORBIDDEN",
      );
      check(
        "an instructor cannot delete one",
        await refusal(() => asInstructor.testStudents.remove({ profileId: realStudent.studentId })),
        "FORBIDDEN",
      );
      check(
        "an instructor cannot read what deleting one would destroy",
        await refusal(() =>
          asInstructor.testStudents.removalPreview({ profileId: realStudent.studentId }),
        ),
        "FORBIDDEN",
      );
    });
  }

  // ---------------------------------------------------------------------------
  // The guard that keeps this from being an escalation.
  // ---------------------------------------------------------------------------
  await inOwnTransaction(db, async (tx) => {
    const asAdmin = createCaller({ db: tx, user: { id: admin.id } } as never);

    check(
      "an admin cannot enrol a real person this way",
      await refusal(() =>
        asAdmin.testStudents.enroll({
          courseId: course.id,
          profileId: realStudent.studentId,
        }),
      ),
      "FORBIDDEN",
    );
    check(
      "an admin cannot delete a real person's account this way",
      await refusal(() => asAdmin.testStudents.remove({ profileId: realStudent.studentId })),
      "FORBIDDEN",
    );
    check(
      "nor read what deleting one would destroy",
      await refusal(() =>
        asAdmin.testStudents.removalPreview({ profileId: realStudent.studentId }),
      ),
      "FORBIDDEN",
    );

    // The admin's own account is a real person's too, and is the one somebody would reach for by
    // accident.
    check(
      "an admin cannot delete their own account this way",
      await refusal(() => asAdmin.testStudents.remove({ profileId: admin.id })),
      "FORBIDDEN",
    );
  });

  // ---------------------------------------------------------------------------
  // Looking through one: the rule from both ends.
  // ---------------------------------------------------------------------------
  await inOwnTransaction(db, async (tx) => {
    // The stand-in. Rolled back, so this student is a test student for the length of this block
    // and nothing outside it ever sees the row.
    await tx.profile.update({
      where: { id: realStudent.studentId },
      data: { testStudentNumber: FAKE_NUMBER },
    });

    const permitted = await resolveViewAs(tx, {
      realUserId: admin.id,
      cookieValue: realStudent.studentId,
    });
    checkThat("an admin may look through a test student", permitted !== null);
    check("and the substitution names it", permitted?.testStudent.number, FAKE_NUMBER);
    check("while keeping the real admin", permitted?.admin.id, admin.id);

    /*
      A non-admin holding exactly the value that works for an admin. The pair is the check: the same
      cookie, two callers, one refused — which is what says the entitlement is the caller's role and
      not the cookie's contents.
    */
    if (otherNonAdmin) {
      check(
        `a ${otherNonAdmin.role} may not, holding the same value`,
        await resolveViewAs(tx, {
          realUserId: otherNonAdmin.id,
          cookieValue: realStudent.studentId,
        }),
        null,
      );
    } else {
      skip("no non-admin account other than the marked one, so the refusing half is unchecked.");
    }

    check(
      "nor may the test student itself",
      await resolveViewAs(tx, {
        realUserId: realStudent.studentId,
        cookieValue: realStudent.studentId,
      }),
      null,
    );
    check(
      "an admin may not look through a real person",
      await resolveViewAs(tx, { realUserId: admin.id, cookieValue: admin.id }),
      null,
    );
    check(
      "a value that is not a uuid is refused without a query",
      await resolveViewAs(tx, { realUserId: admin.id, cookieValue: "not-a-uuid" }),
      null,
    );

    /*
      What the substitution actually produces, through the caller.

      This is the whole feature in one assertion: a context whose user id is the test student's
      answers `me` as the test student, which is what makes every screen and every guard behave.
    */
    const asTestStudent = createCaller({
      db: tx,
      user: { id: realStudent.studentId },
      viewingAs: permitted,
    } as never);
    const me = await asTestStudent.me();
    check("me answers as the test student", me?.id, realStudent.studentId);
    check("and reports the number, so the banner can name it", me?.testStudentNumber, FAKE_NUMBER);

    const viewingAs = await asTestStudent.viewingAs();
    check("viewingAs names the admin behind it", viewingAs?.admin.displayName !== undefined, true);

    // And the ordinary case reports nothing, which is what the banner renders nothing for.
    const asAdmin = createCaller({ db: tx, user: { id: admin.id }, viewingAs: null } as never);
    check(
      "viewingAs is null when nobody is looking through anybody",
      await asAdmin.viewingAs(),
      null,
    );
  });

  // ---------------------------------------------------------------------------
  // Accepting: the two refusals, before anything is created.
  // ---------------------------------------------------------------------------
  /*
    Ordered, and not as a tidy. An unordered `findFirst` picked a different assignment on different
    runs — `swe-1-5-arrays` one time and `swe-1-3-node-modules` the next — which makes the `--github`
    group generate a repository from whichever template came back and a leak hard to attribute to
    the run that caused it. A check whose fixture moves is a check whose result cannot be compared
    with its last result.
  */
  const repoAssignment = await db.assignment.findFirst({
    where: { courseId: course.id, kind: "REPO" },
    orderBy: { assignmentRepoName: "asc" },
    select: acceptableAssignmentSelect,
  });

  if (!repoAssignment) {
    skip(`${course.name} has no repository assignment, so the accept refusals cannot be checked.`);
  } else {
    await inOwnTransaction(db, async (tx) => {
      const student = {
        id: realStudent.studentId,
        githubUsername: testStudentHandle(FAKE_NUMBER),
        testStudentNumber: FAKE_NUMBER,
      };

      check(
        "a test student cannot accept with no admin behind it",
        await refusal(() =>
          acceptRepoAssignment(tx, { assignment: repoAssignment, student, actingAdmin: null }),
        ),
        "PRECONDITION_FAILED",
      );

      check(
        "nor with an admin who has not linked GitHub",
        await refusal(() =>
          acceptRepoAssignment(tx, {
            assignment: repoAssignment,
            student,
            actingAdmin: { githubUsername: null, email: "someone@example.com" },
          }),
        ),
        "PRECONDITION_FAILED",
      );

      /*
        The refusal for a *real* student is unchanged and is checked here beside the new ones,
        because the branch above sits in the same function and a mistake in it would most likely
        show up as this one no longer firing.
      */
      check(
        "a real student with no GitHub account is still refused",
        await refusal(() =>
          acceptRepoAssignment(tx, {
            assignment: repoAssignment,
            student: { id: realStudent.studentId, githubUsername: null, testStudentNumber: null },
            actingAdmin: null,
          }),
        ),
        "PRECONDITION_FAILED",
      );
    });
  }

  // ---------------------------------------------------------------------------
  // The one count a test student must stay out of, and the list it must stay in.
  // ---------------------------------------------------------------------------
  await inOwnTransaction(db, async (tx) => {
    // The admin, because this group is about the count rather than about who may read it — and an
    // admin can read every course's, so it does not depend on a plain instructor existing.
    const asStaff = createCaller({ db: tx, user: { id: admin.id } } as never);

    const before = (await asStaff.courses.listMine()).find((row) => row.id === course.id);
    const rosterBefore = await asStaff.courses.roster({ courseId: course.id });

    await tx.profile.update({
      where: { id: realStudent.studentId },
      data: { testStudentNumber: FAKE_NUMBER },
    });

    const after = (await asStaff.courses.listMine()).find((row) => row.id === course.id);
    const rosterAfter = await asStaff.courses.roster({ courseId: course.id });

    check(
      "the course card stops counting a student that becomes a test student",
      after?._count.enrollments,
      (before?._count.enrollments ?? 0) - 1,
    );
    check(
      "and the roster goes on listing them",
      rosterAfter.enrollments.length,
      rosterBefore.enrollments.length,
    );
    checkThat(
      "the roster says which one is a test student",
      rosterAfter.enrollments.some(
        (row) => row.student.id === realStudent.studentId && row.student.testStudentNumber !== null,
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // The round trip against Supabase. Gated, because it makes a real account.
  // ---------------------------------------------------------------------------
  if (!live) {
    console.log(
      "\nnot run: the create/enrol/delete round trip against Supabase. Re-run with " +
        "`npm run verify:test-student -- --live` to include it. It creates a real test student " +
        "and deletes it again.",
    );
  } else {
    const asAdmin = createCaller({ db, user: { id: admin.id } } as never);
    const highestBefore = await db.profile.aggregate({ _max: { testStudentNumber: true } });
    const expected = (highestBefore._max.testStudentNumber ?? 0) + 1;

    let createdId: string | null = null;
    try {
      const created = await asAdmin.testStudents.create({ courseId: course.id });
      createdId = created.id;

      check("the new test student takes the next number", created.testStudentNumber, expected);
      check("it is named after it", created.displayName, testStudentName(expected));
      check("its handle is too", created.githubUsername, testStudentHandle(expected));
      check("and it is in the cohort", created.enrollmentStatus, "ACTIVE");

      const listed = await asAdmin.testStudents.list({ courseId: course.id });
      checkThat(
        "it appears on the list as already in this cohort",
        listed.some((row) => row.id === createdId && row.enrollmentStatus === "ACTIVE"),
      );

      // Enrolling one that is already here is the same as enrolling it once, which is what makes
      // pressing the button twice harmless.
      const again = await asAdmin.testStudents.enroll({
        courseId: course.id,
        profileId: createdId,
      });
      check("enrolling it again is idempotent", again.enrollmentStatus, "ACTIVE");

      const preview = await asAdmin.testStudents.removalPreview({ profileId: createdId });
      check("it has accepted nothing yet", preview.submissionCount, 0);
      check("so there are no repositories to delete", preview.repositories, []);
    } finally {
      if (createdId) {
        const removed = await asAdmin.testStudents.remove({ profileId: createdId });
        check("deleting it reports no repository left behind", removed.failedRepositories, []);
        const gone = await db.profile.findUnique({ where: { id: createdId } });
        check("and the profile is gone with the account", gone, null);
      }
    }

    /*
      An account left behind by a create that failed halfway is claimed rather than stepped over.

      Checked because it happened while this was being written, and because the state it leaves is
      invisible in the worst way: the address is registered so the number can never be used again,
      and the profile reads as an ordinary student — a row in a roster with nothing to explain it.
      The wreckage is made here deliberately, by creating the account and not marking it, which is
      exactly what a failure between those two steps leaves.
    */
    const nextNumber =
      ((await db.profile.aggregate({ _max: { testStudentNumber: true } }))._max.testStudentNumber ??
        0) + 1;

    let abandonedId: string | null = null;
    try {
      const abandoned = await createAuthUser({
        email: testStudentEmail(nextNumber),
        displayName: testStudentName(nextNumber),
      });
      abandonedId = abandoned.id;

      const claimed = await asAdmin.testStudents.create({ courseId: course.id });
      check("an abandoned account is claimed rather than skipped", claimed.id, abandonedId);
      check(
        "and it keeps the number whose address it holds",
        claimed.testStudentNumber,
        nextNumber,
      );
      check("so nothing is created beside it", claimed.enrollmentStatus, "ACTIVE");
    } finally {
      if (abandonedId) {
        await asAdmin.testStudents
          .remove({ profileId: abandonedId })
          // If claiming failed, the profile is unmarked and `remove` refuses it — which is correct,
          // and means the account has to go the way it came.
          .catch(() => deleteAuthUser(abandonedId!));
        const gone = await db.profile.findUnique({ where: { id: abandonedId } });
        check("and the claimed account deletes like any other", gone, null);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Accepting for real, which is the only way to know the collaborator substitution works.
  // ---------------------------------------------------------------------------
  if (!github) {
    console.log(
      "\nnot run: accepting a repository assignment for real. Re-run with " +
        "`npm run verify:test-student -- --live --github` to include it. It generates a real " +
        "repository and deletes it again.",
    );
  } else if (!repoAssignment) {
    skip(`${course.name} has no repository assignment, so accepting for real cannot be checked.`);
  } else if (!admin.githubUsername) {
    skip("the admin has no linked GitHub account, so there is nobody to invite to the repository.");
  } else {
    const asAdmin = createCaller({ db, user: { id: admin.id } } as never);
    const { getConfiguredInstallationId, isGithubAppConfigured } =
      await import("../lib/github/app-client");
    const { getRepo } = await import("../lib/github/repos");

    if (!isGithubAppConfigured()) {
      skip("the GitHub App is not configured, so no repository can be generated.");
    } else {
      let studentId: string | null = null;
      try {
        const student = await asAdmin.testStudents.create({ courseId: course.id });
        studentId = student.id;

        const accepted = await acceptRepoAssignment(db, {
          assignment: repoAssignment,
          student: {
            id: student.id,
            githubUsername: student.githubUsername,
            testStudentNumber: student.testStudentNumber,
          },
          actingAdmin: { githubUsername: admin.githubUsername, email: admin.email },
        });

        const fullName = accepted.submission.repoFullName;
        checkThat("accepting generates a repository", fullName !== null, String(fullName));
        checkThat(
          "named for the cohort and the test student",
          fullName?.endsWith(`-${student.githubUsername}`) === true,
          String(fullName),
        );

        const [owner, repo] = (fullName ?? "/").split("/");
        const installationId = getConfiguredInstallationId();
        const onGithub = owner && repo ? await getRepo(installationId, { owner, repo }) : null;

        checkThat("it exists on GitHub", onGithub !== null);
        check("and is private, like every student repository", onGithub?.private, true);

        /*
          The whole point of the branch. The test student's own handle is never sent to GitHub —
          `PUT /collaborators/test-student-N` would answer 404 and fail an accept that had already
          created the repository — and the admin is invited in its place.
        */
        const octokit = await (
          await import("../lib/github/app-client")
        ).getInstallationOctokit(installationId);
        const collaborators = await octokit.request("GET /repos/{owner}/{repo}/collaborators", {
          owner,
          repo,
        });
        const logins = collaborators.data.map((c: { login: string }) => c.login.toLowerCase());
        checkThat(
          "the admin can push to it",
          logins.includes(admin.githubUsername.toLowerCase()),
          logins.join(", "),
        );
        checkThat(
          "and the test student's handle was never sent to GitHub",
          !logins.includes(String(student.githubUsername).toLowerCase()),
          logins.join(", "),
        );
      } finally {
        if (studentId) {
          const removed = await asAdmin.testStudents.remove({ profileId: studentId });
          check("deleting it takes the repository with it", removed.failedRepositories, []);
          checkThat(
            "and the repository is gone from GitHub",
            removed.deletedRepositories.length === 1,
            removed.deletedRepositories.join(", "),
          );
        }
      }
    }
  }

  /*
    Nothing this run made is still here.

    Last, and unconditional, so it also covers the transactional groups: a rolled-back transaction
    that somehow committed would show up here as a marked profile nobody asked for.
  */
  const testStudentsAfter = (
    await db.profile.findMany({
      where: { testStudentNumber: { not: null } },
      select: { id: true, displayName: true },
    })
  ).filter((row) => !testStudentsBefore.includes(row.id));

  checkThat(
    "this run left no test student behind",
    testStudentsAfter.length === 0,
    testStudentsAfter.map((row) => `${row.displayName} (${row.id})`).join(", "),
  );

  finish();
  await db.$disconnect();
}

void main();
