/**
 * Test students: the half that makes a real account and a real repository.
 *
 * Run with `npm run verify:test-student`. Two gates widen it: `-- --live` creates and deletes a
 * real Supabase account, and `-- --live --github` also generates and deletes a real repository.
 * Without a flag its group is reported as not run, and what remains is the final check that this
 * run left nothing behind.
 *
 * **The rest of this script is now `tests/integration/test-student.test.ts`**, along with the pure
 * rules in `tests/lib/students/test-student.test.ts` and `tests/lib/auth/view-as.test.ts`. What
 * moved is everything a rolled-back transaction could establish: who may call these procedures, the
 * refusals that stop `enroll` and `remove` reaching a profile that is not a test student, the
 * view-as substitution asserted from both ends, and the accept refusals. What stays here could not
 * move, because creating an auth user is not something a transaction can undo.
 *
 * **Both gated groups are self-cleaning** — each deletes what it made, through the same `remove` an
 * admin presses — but each is a real account, a real row, and in the second case a real repository
 * while it runs.
 *
 * The `--github` group is the one that earns the cost. The only way to know that a test student's
 * own handle is never sent to GitHub is to accept for real and read the repository's collaborators
 * back: `PUT /collaborators/test-student-N` would answer 404 and fail an accept that had already
 * created the repository, so the admin is invited in its place.
 */
import { createChecker, loadEnvironment } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

async function main() {
  const live = process.argv.includes("--live");
  const github = process.argv.includes("--github");

  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { acceptRepoAssignment, acceptableAssignmentSelect } =
    await import("../lib/assignments/accept");
  const { testStudentEmail, testStudentHandle, testStudentName } =
    await import("../lib/students/test-student");
  const { createAuthUser, deleteAuthUser } = await import("../lib/supabase/admin");

  const createCaller = createCallerFactory(appRouter);

  /*
    The test students that existed before this run, so the last check can prove none were added.

    Both groups below create real accounts and real repositories and delete them again, and the way
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

  /*
    A program with a course, and the admin these procedures are gated on. A test student is enrolled
    on a roster rather than in a course, so the scope is the program.
  */
  const program = await db.program.findFirst({
    where: {
      archivedAt: null,
      enrollments: { some: { status: "ACTIVE" } },
      courses: { some: { archivedAt: null } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  const admin = await db.profile.findFirst({
    where: { role: "ADMIN" },
    // `role` is selected so this row can be passed to `createAuthUser` and `deleteAuthUser`, which
    // refuse a caller who is not an ADMIN. Redundant against the `where` above, and that is the
    // point: the check reads the column rather than trusting how the row was found.
    select: { id: true, githubUsername: true, email: true, role: true },
  });

  if (!program || !admin) {
    skip(
      "needs an unarchived program with an active fellow and a course, plus an admin account. " +
        `Found program=${Boolean(program)} admin=${Boolean(admin)}. ` +
        "Seed with npm run db:seed and grant an admin with npm run grant:admin.",
    );
    finish();
    await db.$disconnect();
    return;
  }

  /*
    Ordered, and not as a tidy. An unordered `findFirst` picked a different assignment on different
    runs — `swe-1-5-arrays` one time and `swe-1-3-node-modules` the next — which makes the `--github`
    group generate a repository from whichever template came back and a leak hard to attribute to
    the run that caused it. A check whose fixture moves is a check whose result cannot be compared
    with its last result.
  */
  const repoAssignment = await db.assignment.findFirst({
    where: { course: { programId: program.id }, kind: "REPO" },
    orderBy: { assignmentRepoName: "asc" },
    select: acceptableAssignmentSelect,
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
      const created = await asAdmin.testStudents.create({ programId: program.id });
      createdId = created.id;

      check("the new test student takes the next number", created.testStudentNumber, expected);
      check("it is named after it", created.displayName, testStudentName(expected));
      check("its handle is too", created.githubUsername, testStudentHandle(expected));
      check("and it is on the roster", created.enrollmentStatus, "ACTIVE");

      const listed = await asAdmin.testStudents.list({ programId: program.id });
      checkThat(
        "it appears on the list as already on this roster",
        listed.some((row) => row.id === createdId && row.enrollmentStatus === "ACTIVE"),
      );

      // Enrolling one that is already here is the same as enrolling it once, which is what makes
      // pressing the button twice harmless.
      const again = await asAdmin.testStudents.enroll({
        programId: program.id,
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
      // The real admin row this script signs in as, rather than a stand-in shape: these two calls
      // now require an ADMIN caller, and a check that passes only because the script asserted its
      // own authorization would be checking nothing.
      const abandoned = await createAuthUser(
        { profile: admin },
        {
          email: testStudentEmail(nextNumber),
          displayName: testStudentName(nextNumber),
        },
      );
      abandonedId = abandoned.id;

      const claimed = await asAdmin.testStudents.create({ programId: program.id });
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
          .catch(() => deleteAuthUser({ profile: admin }, abandonedId!));
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
    skip(`${program.name} has no repository assignment, so accepting for real cannot be checked.`);
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
        const student = await asAdmin.testStudents.create({ programId: program.id });
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
          "named for the course and the test student",
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
