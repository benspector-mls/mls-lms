/**
 * Creating a cohort, getting students into it, and taking them out again.
 *
 * Run with `npm run verify:enrollment`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. Authorization is
 * most of what these procedures are — any instructor may create a course, but only one who
 * teaches a course may archive it, replace its join link, or remove somebody from it — and a
 * check that only holds when the function is called some other way is not a check on what an
 * instructor uses.
 *
 * **The group worth reading is the last one.** A removed student keeps reading the feedback they
 * were given and cannot hand anything else in, and those two facts are one `where` clause apart
 * in code that otherwise reads identically. Every check there asserts both halves, because
 * getting one right and the other wrong is the failure this design can actually produce.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else console.log(`ok   ${label}`);
}

/** The tRPC error code a call refused with, or "accepted". */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/** What a call refused with, message included, for the checks that are about the wording. */
async function refusalMessage(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function report() {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { studentRepoName, slugifyCohort } = await import("../lib/courses/cohort-slug");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  /*
    A course with work already in it, which several checks below depend on rather than assume.

    `submissions: { some: {} }` is the load-bearing part. The short name is frozen once anybody
    has accepted, and a removed student keeping access is only meaningful against an assignment
    they actually submitted — so a course with assignments and no submissions would make both
    checks pass vacuously. It did: with two courses matching, `findFirst` returned the copied one
    and the freeze check reported that renaming was allowed.
  */
  const course = await db.course.findFirst({
    where: { archivedAt: null, assignments: { some: { submissions: { some: {} } } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  const instructor = course
    ? await db.courseInstructor.findFirst({
        where: { courseId: course.id },
        select: { userId: true },
      })
    : null;
  const enrollment = course
    ? await db.enrollment.findFirst({
        where: { courseId: course.id, status: "ACTIVE" },
        select: { id: true, studentId: true },
      })
    : null;

  if (!course || !instructor || !enrollment) {
    console.log(
      "skip — needs a course with an instructor, an active student, and at least one submission",
    );
    return report();
  }

  const studentId = enrollment.studentId;
  const createCaller = createCallerFactory(appRouter);

  try {
    await db.$transaction(async (tx) => {
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
      const asStudent = createCaller({ db: tx, user: { id: studentId } } as never);

      // ---- Deriving a short name from a term ---------------------------------
      //
      // Pure, and checked before anything else, because every repository name a cohort generates
      // starts with the result.
      const derivations: [string, string][] = [
        ["Fall 2026", "fall-2026"],
        ["Spring 2027", "spring-2027"],
        ["Cohort 12 (evening)", "cohort-12-evening"],
        ["  Fall   2026  ", "fall-2026"],
        ["FALL/2026", "fall-2026"],
        // Nothing usable, which the caller has to notice rather than have a name invented.
        ["!!!", ""],
        ["", ""],
      ];
      for (const [term, expected] of derivations) {
        check(`"${term}" suggests "${expected}"`, slugifyCohort(term), expected);
      }

      // ---- Creating a cohort ------------------------------------------------
      // Distinct terms, because a slug is unique across every course and the term is what
      // suggests it. Two cohorts called the same thing is a real situation and a real refusal —
      // checked below deliberately rather than tripped over here.
      const empty = await asInstructor.courses.create({
        name: "Verify Empty",
        cohortTerm: "Cohort Verify A",
      });
      check("a course is created", empty.course.name, "Verify Empty");
      check("...with nothing copied into it", { copied: empty.copied, failed: empty.failed },
        { copied: 0, failed: [] });

      /*
        The creator is the primary instructor, and can immediately author in the course.

        The second half is the real check. A `CourseInstructor` row that was not written looks
        entirely normal until somebody tries to add an assignment, because every authoring
        procedure checks that table rather than the role.
      */
      const created = await tx.course.findUnique({
        where: { id: empty.course.id },
        select: {
          joinToken: true,
          instructors: { select: { userId: true, isPrimary: true } },
        },
      });
      check("the creator is the primary instructor",
        created?.instructors, [{ userId: instructor.userId, isPrimary: true }]);
      check("a join token is generated", (created?.joinToken ?? "").length >= 32, true);

      const context = await asInstructor.assignments.authoringContext({
        courseId: empty.course.id,
      });
      check("...and can author in the course immediately", context.course.name, "Verify Empty");

      // ---- Copying ----------------------------------------------------------
      const sourceModules = await tx.module.findMany({
        where: { courseId: course.id },
        select: { name: true, position: true },
        orderBy: { position: "asc" },
      });
      const sourceAssignments = await tx.assignment.count({ where: { courseId: course.id } });

      const copy = await asInstructor.courses.create({
        name: "Verify Copy",
        cohortTerm: "Cohort Verify B",
        copyFromCourseId: course.id,
      });

      const copiedModules = await tx.module.findMany({
        where: { courseId: copy.course.id },
        select: { name: true, position: true },
        orderBy: { position: "asc" },
      });
      check("copying reproduces every module, name and position",
        copiedModules, sourceModules);

      /*
        Every assignment, or a named reason for each that did not arrive.

        Reported rather than asserted to be all of them, because a copy legitimately fails when
        a template repository was made private since last term — and this script runs against
        whatever the sandbox organization currently holds.
      */
      check("copying reproduces every assignment",
        copy.copied + copy.failed.length, sourceAssignments);
      if (copy.failed.length > 0) {
        console.log(`     ${copy.failed.length} could not be copied:`);
        for (const entry of copy.failed) console.log(`       ${entry.title}: ${entry.reason}`);
      }

      const copiedAssignments = await tx.assignment.findMany({
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
      check("copies arrive unpublished",
        copiedAssignments.every((row) => row.distributedAt === null), true);
      check("...with due dates cleared",
        copiedAssignments.every((row) => row.dueAt === null), true);

      /*
        The repository columns, on the kinds that have them.

        Narrowed to REPO deliberately: a Google Doc or file-upload assignment has no template and
        no answer keys, and the schema requires them to be null. A check over every kind would
        fail on a correctly copied document — which is exactly how it did fail first time.
      */
      const copiedRepos = copiedAssignments.filter((row) => row.kind === 'REPO');
      check("a copied repository assignment keeps both repositories and its answer key folder",
        copiedRepos.length > 0 &&
          copiedRepos.every((row) =>
            row.templateRepo !== null && row.answerKeyRepo !== null && row.answerKeyDir !== null),
        true);
      check("...and the kinds with no repository keep none",
        copiedAssignments
          .filter((row) => row.kind !== 'REPO')
          .every((row) => row.templateRepo === null && row.answerKeyRepo === null),
        true);

      check("a student cannot create a course",
        await refusal(() =>
          asStudent.courses.create({ name: "Nope", cohortTerm: "Nope" })), "FORBIDDEN");

      /*
        ---- The cohort is in every repository name -----------------------------

        A student's repository is `{cohortSlug}-{assignmentRepoName}-{github login}`, which is
        what keeps two cohorts of the same program apart on GitHub. Before the prefix existed,
        copying a course produced assignments whose generated names collided with the original's
        for anybody in both — a student repeating a module, or an instructor testing a copy.

        Checked here because copying is exactly how that arises, and because the slug is only
        editable until the first Accept.
      */
      const twinInCopy = await tx.assignment.findFirst({
        where: {
          courseId: copy.course.id,
          kind: 'REPO',
          assignmentRepoName: { not: null },
          githubOrg: { not: null },
        },
        select: { id: true, assignmentRepoName: true, githubOrg: true },
      });

      check("a copied course gets its own short name",
        copy.course.cohortSlug !== empty.course.cohortSlug &&
          copy.course.cohortSlug.length > 0,
        true);

      if (twinInCopy) {
        /*
          The names the two cohorts generate for the same assignment and the same student differ.

          Built through `studentRepoName` rather than by string concatenation here, so this
          checks the function `accept` actually calls. Asserting the shape by rebuilding it a
          second way would pass while both were wrong together.
        */
        const original = await tx.assignment.findFirst({
          where: { courseId: course.id, assignmentRepoName: twinInCopy.assignmentRepoName },
          select: { assignmentRepoName: true, course: { select: { cohortSlug: true } } },
        });

        if (original) {
          const inOriginal = studentRepoName({
            cohortSlug: original.course.cohortSlug,
            assignmentRepoName: original.assignmentRepoName!,
            githubLogin: 'somebody',
          });
          const inCopy = studentRepoName({
            cohortSlug: copy.course.cohortSlug,
            assignmentRepoName: twinInCopy.assignmentRepoName!,
            githubLogin: 'somebody',
          });
          check("the same assignment in two cohorts generates two different repository names",
            inOriginal !== inCopy, true);
          check("...and each starts with its own cohort",
            inCopy.startsWith(`${copy.course.cohortSlug}-`), true);
        }
      }

      // ---- The short name, and its window -----------------------------------
      check("a duplicate short name is refused",
        await refusal(() =>
          asInstructor.courses.create({
            name: "Verify Duplicate",
            cohortTerm: "Cohort Verify D",
            cohortSlug: empty.course.cohortSlug,
          })),
        "CONFLICT");

      check("an illegal short name is refused",
        await refusal(() =>
          asInstructor.courses.create({
            name: "Verify Illegal",
            cohortTerm: "Cohort Verify E",
            cohortSlug: "Fall 2026!",
          })),
        "BAD_REQUEST");

      check("a term with nothing usable in it is refused rather than guessed at",
        await refusal(() =>
          asInstructor.courses.create({ name: "Verify Blank", cohortTerm: "!!!" })),
        "BAD_REQUEST");

      check("the short name can be changed before anybody accepts",
        (await asInstructor.courses.setCohortSlug({
          courseId: empty.course.id,
          cohortSlug: "verify-renamed",
        })).cohortSlug,
        "verify-renamed");

      check("a student cannot change it",
        await refusal(() =>
          asStudent.courses.setCohortSlug({ courseId: empty.course.id, cohortSlug: "nope" })),
        "FORBIDDEN");

      /*
        And it is frozen once anything has been accepted, because those repositories are already
        named after it and renaming here would not rename theirs. The seeded course has real
        submissions, which is what makes this checkable without creating any.
      */
      check("the short name is frozen once a student has accepted",
        await refusal(() =>
          asInstructor.courses.setCohortSlug({
            courseId: course.id,
            cohortSlug: "verify-too-late",
          })),
        "PRECONDITION_FAILED");

      // ---- The join link ----------------------------------------------------
      const token = created!.joinToken;

      const preview = await asStudent.enrollments.preview({ token });
      check("the link says which course it is", preview?.name, "Verify Empty");
      check("...and that the caller is not in it yet", preview?.alreadyIn, null);

      check("an unknown token previews as nothing",
        await asStudent.enrollments.preview({ token: "not-a-real-token" }), null);

      const joined = await asStudent.enrollments.join({ token });
      check("redeeming the link enrolls the student", joined.joined, true);
      check("...as ACTIVE",
        (await tx.enrollment.findFirst({
          where: { courseId: empty.course.id, studentId },
          select: { status: true },
        }))?.status,
        "ACTIVE");

      /*
        Idempotent, which is what makes a reusable link safe. A student who opens it twice, or
        bookmarks it, must not produce a second enrollment — `@@unique([courseId, studentId])`
        is the constraint, and this is the procedure agreeing with it rather than provoking it.
      */
      const again = await asStudent.enrollments.join({ token });
      check("redeeming it twice does not enroll them twice", again.joined, false);
      check("...and there is one enrollment",
        await tx.enrollment.count({ where: { courseId: empty.course.id, studentId } }), 1);

      // An instructor of the course is refused: an enrollment would put them in their own
      // roster and gradebook, and accepting would file a submission in their own queue.
      check("an instructor of the course cannot join it as a student",
        await refusal(() => asInstructor.enrollments.join({ token })), "PRECONDITION_FAILED");

      // Rotating the link invalidates the old one, which is the only control over who can use
      // it. Students already in are unaffected — the token is how you join, not how you stay.
      const rotated = await asInstructor.courses.regenerateJoinToken({ courseId: empty.course.id });
      check("regenerating changes the token", rotated.joinToken !== token, true);
      check("the old link no longer works",
        await refusal(() => asStudent.enrollments.join({ token })), "NOT_FOUND");
      check("...and the student who already joined is still enrolled",
        (await tx.enrollment.findFirst({
          where: { courseId: empty.course.id, studentId },
          select: { status: true },
        }))?.status,
        "ACTIVE");

      check("a student cannot regenerate a join link",
        await refusal(() =>
          asStudent.courses.regenerateJoinToken({ courseId: empty.course.id })), "FORBIDDEN");

      // An archived cohort takes no new students, which is the same "readable, accepts nothing"
      // pair a removed student gets.
      await asInstructor.courses.setArchived({ courseId: copy.course.id, archived: true });
      const archivedToken = (await tx.course.findUnique({
        where: { id: copy.course.id },
        select: { joinToken: true },
      }))!.joinToken;
      check("an archived cohort refuses new students",
        await refusal(() => asStudent.enrollments.join({ token: archivedToken })),
        "PRECONDITION_FAILED");
      check("...and leaves the active course list",
        (await asInstructor.courses.listMine()).some((row) => row.id === copy.course.id), false);
      await asInstructor.courses.setArchived({ courseId: copy.course.id, archived: false });
      check("reopening puts it back",
        (await asInstructor.courses.listMine()).some((row) => row.id === copy.course.id), true);

      check("a student cannot archive a course",
        await refusal(() =>
          asStudent.courses.setArchived({ courseId: empty.course.id, archived: true })),
        "FORBIDDEN");

      // ---- Removing, and the pair that must not come apart ------------------
      //
      // Every check below asserts both halves. A removed student who can still submit, and one
      // who can no longer read what they were given, are both defects, and each is one enum
      // value away from the other in code that reads the same.
      const seededAssignment = await tx.assignment.findFirst({
        where: { courseId: course.id, distributedAt: { not: null } },
        select: { id: true },
      });

      const removed = await asInstructor.enrollments.remove({ enrollmentId: enrollment.id });
      check("removing sets the status", removed.status, "REMOVED");

      check("a removed student can still read the course",
        (await asStudent.courses.get({ courseId: course.id })).id, course.id);
      check("...and its modules, which order their own assignment list",
        Array.isArray(await asStudent.modules.listForCourse({ courseId: course.id })), true);
      check("...and the course stays in their list",
        (await asStudent.courses.listMine()).find((row) => row.id === course.id)?.enrolledAs,
        "REMOVED");

      if (seededAssignment) {
        check("...and can still read an assignment in it",
          (await asStudent.assignments.get({ assignmentId: seededAssignment.id })).courseId,
          course.id);

        /*
          And cannot hand anything in. The message is checked, not only the refusal: "you are no
          longer enrolled" is a fact the student can act on, and the generic "you are not
          enrolled" would read as the application having lost them.
        */
        const refused = await refusalMessage(() =>
          asStudent.assignments.accept({ assignmentId: seededAssignment.id }));
        check("...and cannot accept anything new",
          refused.includes("no longer enrolled"), true);
      }

      check("a removed student is not counted as a student of the cohort",
        (await asInstructor.courses.gradebook({ courseId: course.id }))
          .activeEnrollments.some((row) => row.student.id === studentId),
        false);
      check("...and is still on the roster, so they can be put back",
        (await asInstructor.courses.gradebook({ courseId: course.id }))
          .enrollments.some((row) => row.student.id === studentId),
        true);

      // A removed student redeeming the link again is refused: if it let them back in, removal
      // would not stick while they still held the link.
      const rejoinToken = (await tx.course.findUnique({
        where: { id: course.id },
        select: { joinToken: true },
      }))!.joinToken;
      check("a removed student cannot rejoin with the link",
        await refusal(() => asStudent.enrollments.join({ token: rejoinToken })), "FORBIDDEN");

      const restored = await asInstructor.enrollments.restore({ enrollmentId: enrollment.id });
      check("the instructor can put them back", restored.status, "ACTIVE");
      check("...and they are counted again",
        (await asInstructor.courses.gradebook({ courseId: course.id }))
          .activeEnrollments.some((row) => row.student.id === studentId),
        true);

      check("a student cannot remove anybody",
        await refusal(() =>
          asStudent.enrollments.remove({ enrollmentId: enrollment.id })), "FORBIDDEN");

      // An enrollment id says nothing about which course it is in until the row is read, which
      // is why the procedure loads it before checking who is asking.
      const elsewhere = await asInstructor.courses.create({
        name: "Verify Elsewhere",
        cohortTerm: "Cohort Verify C",
      });
      const elsewhereToken = (await tx.course.findUnique({
        where: { id: elsewhere.course.id },
        select: { joinToken: true },
      }))!.joinToken;
      await asStudent.enrollments.join({ token: elsewhereToken });
      const foreignEnrollment = await tx.enrollment.findFirst({
        where: { courseId: elsewhere.course.id },
        select: { id: true },
      });

      // Removing the student from a course this instructor does teach is allowed; the check is
      // that teaching is what decides it, so a second instructor is needed to prove the
      // refusal. `asStudent` above already covers the role; this covers the course.
      check("an enrollment in a course you teach can be removed",
        (await asInstructor.enrollments.remove({ enrollmentId: foreignEnrollment!.id })).status,
        "REMOVED");

      throw new Error("ROLLBACK");
    }, { timeout: 120_000 });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  // ---- Nothing survived --------------------------------------------------
  check("the seeded student is still active",
    (await db.enrollment.findUnique({
      where: { id: enrollment.id },
      select: { status: true },
    }))?.status,
    "ACTIVE");
  check("no courses this script created survived the rollback",
    await db.course.count({ where: { cohortTerm: { startsWith: "Cohort Verify" } } }), 0);

  return report();
}

main().catch((err) => { console.error("\n", err); process.exit(1); });
