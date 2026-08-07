/**
 * Creating a cohort, getting students into it, taking them out again, and moving between them.
 *
 * Run with `npm run verify:enrollment`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. Authorization is
 * most of what these procedures are — any instructor may create a course, but only one who
 * teaches a course may archive it, replace its join link, or remove somebody from it — and a
 * check that only holds when the function is called some other way is not a check on what an
 * instructor uses.
 *
 * **Two groups are worth reading.** A removed student keeps reading the feedback they were given
 * and cannot hand anything else in, and those two facts are one `where` clause apart in code that
 * otherwise reads identically — every check there asserts both halves, because getting one right
 * and the other wrong is the failure that design can actually produce. And the co-teaching group
 * at the end takes one account, has it refused while it is a student, promotes it, and has it
 * admitted: the link grants a course and never a role, and one account doing both halves is what
 * makes that a comparison rather than two unrelated facts about two people.
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

/**
 * A run that checked nothing is not a run that passed.
 *
 * This script needs a seeded course to work against, and it used to print "All checks passed"
 * when it could not find one — so the day the seed changed shape, every check here would have
 * stopped running and the output would have said everything was fine. Exiting non-zero on a skip
 * is the only version of this that cannot be read as a green result.
 */
function report(skipped?: string) {
  if (skipped) {
    console.log(`\nNOTHING CHECKED — ${skipped}`);
    process.exit(1);
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { studentRepoName, slugifyCohort } = await import("../lib/courses/cohort-slug");
  const links = await import("../lib/links");
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
  /*
    Any status, and restored inside the transaction if it is not active.

    `status: "ACTIVE"` here meant the script skipped the moment somebody removed the seeded
    student in the running application — which is a thing instructors do, and the state the removal
    checks below are *about*. Skipping was worse than it looks: it printed a pass. So the enrollment
    is picked regardless of status and put back to ACTIVE as the first thing inside the rollback,
    which makes the starting point the same either way and changes nothing outside it.
  */
  const enrollment = course
    ? await db.enrollment.findFirst({
        where: { courseId: course.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, studentId: true, status: true },
      })
    : null;

  if (!course || !instructor || !enrollment) {
    return report(
      "needs a seeded course with an instructor, a student, and at least one submission",
    );
  }

  const studentId = enrollment.studentId;
  const createCaller = createCallerFactory(appRouter);

  try {
    await db.$transaction(async (tx) => {
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
      const asStudent = createCaller({ db: tx, user: { id: studentId } } as never);

      // Inside the transaction, so it is undone with everything else.
      if (enrollment.status !== "ACTIVE") {
        await asInstructor.enrollments.restore({ enrollmentId: enrollment.id });
      }

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

      /*
        ---- Moving between cohorts -------------------------------------------

        Pure too, and checked because it is the arithmetic the sidebar does. Switching cohort
        keeps the view where the view exists in every course, and lands on settings where it does
        not — an assignment belongs to one cohort, so its queue cannot travel. Getting that
        backwards sends an instructor to another cohort's assignment id.

        Every one of the six sidebar items is here, and that is the point of the table rather
        than a completeness gesture: a view missing from `sameViewInCourse` does not fail, it
        silently falls through to settings, so switching cohort from the roster would land on
        settings and read as the switcher losing your place.
      */
      const [alpha, beta, someAssignment] = [
        "aaaaaaaa-0000-0000-0000-000000000001",
        "bbbbbbbb-0000-0000-0000-000000000002",
        "cccccccc-0000-0000-0000-000000000003",
      ];
      const switches: [string, string, string][] = [
        ["triage", links.triageHref(alpha), links.triageHref(beta)],
        ["the assignments list",
          links.courseAssignmentsHref(alpha), links.courseAssignmentsHref(beta)],
        ["the gradebook", links.gradebookHref(alpha), links.gradebookHref(beta)],
        ["the roster", links.rosterHref(alpha), links.rosterHref(beta)],
        ["modules", links.modulesHref(alpha), links.modulesHref(beta)],
        ["settings", links.courseSettingsHref(alpha), links.courseSettingsHref(beta)],
        // The four that cannot carry across, each landing on settings rather than on another
        // cohort's copy of an id it does not have.
        ["an assignment's queue",
          links.gradingQueueHref(alpha, someAssignment), links.courseSettingsHref(beta)],
        ["an assignment's edit form",
          links.editAssignmentHref(alpha, someAssignment), links.courseSettingsHref(beta)],
        ["the new-assignment form",
          links.newAssignmentHref(alpha), links.courseSettingsHref(beta)],
        ["a student's record",
          links.studentHref(alpha, "stu-1"), links.courseSettingsHref(beta)],
        // The bare course address, which is itself a redirect to settings.
        ["the course address", links.courseHref(alpha), links.courseSettingsHref(beta)],
        // No course in the address at all, which is the course list.
        ["the course list", "/courses", links.courseSettingsHref(beta)],
      ];
      for (const [what, from, expected] of switches) {
        check(`switching cohort from ${what}`, links.sameViewInCourse(from, beta), expected);
      }

      check("a queue link can still open one submission",
        links.gradingQueueHref(alpha, someAssignment, "sub-1"),
        `/instructor/courses/${alpha}/assignments/${someAssignment}?submission=sub-1`);

      /*
        A student's record is course-scoped for the same reason everything else is: the same person
        repeating a module has two sets of submissions, and an address naming only the student would
        have to pick one. The optional submission carries over so the gradebook and the review
        header can open a particular piece of work rather than the top of the list.
      */
      check("a student's record names its cohort",
        links.studentHref(alpha, "stu-1"),
        `/instructor/courses/${alpha}/students/stu-1`);
      check("...and can open one of their submissions",
        links.studentHref(alpha, "stu-1", "sub-1"),
        `/instructor/courses/${alpha}/students/stu-1?submission=sub-1`);

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

      /*
        And once set it cannot be changed, by anybody, ever — there is no procedure that changes
        it. Asserted against the router rather than against a screen, because "the button is not
        rendered" is a different claim: the check that matters is that no caller can reach it.
      */
      check("nothing can change a short name after creation",
        "setCohortSlug" in asInstructor.courses, false);

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

      /*
        ---- Triage is one cohort's, and an archived cohort's is nobody's ----------

        Both halves were claimed in the ROADMAP and neither was true. `triage` filtered
        `archivedAt: null` in its admin branch only, so the reader it held for was the one who
        teaches nothing; and the screen called it with no course at all, so an instructor
        teaching two cohorts got both piles interleaved.

        The first check is the load-bearing one. Every assertion below is that some pile is
        empty, and a seeded course with nothing outstanding would make all of them pass while
        measuring nothing — so the pile is asserted to be non-empty before anything empties it.
      */
      const outstanding = await asInstructor.submissions.triage({ courseId: course.id });
      check("the seeded cohort has work in triage",
        outstanding.submissions.length > 0, true);

      // The copy is unpublished and nobody has submitted to it, so a triage that crossed
      // courses would show the seeded cohort's work here.
      check("triage is scoped to the cohort asked for",
        (await asInstructor.submissions.triage({ courseId: copy.course.id })).submissions.length,
        0);

      await asInstructor.courses.setArchived({ courseId: course.id, archived: true });
      check("an archived cohort's submissions leave triage",
        (await asInstructor.submissions.triage({ courseId: course.id })).submissions.length, 0);
      await asInstructor.courses.setArchived({ courseId: course.id, archived: false });
      check("...and come back when it is reopened",
        (await asInstructor.submissions.triage({ courseId: course.id })).submissions.length,
        outstanding.submissions.length);

      // Readable, though: archiving stops the cohort appearing in a list of work to do, and
      // takes nothing back. The assignment's own queue is how its submissions are read.
      await asInstructor.courses.setArchived({ courseId: course.id, archived: true });
      const archivedAssignmentId = outstanding.submissions[0]?.assignment.id;
      check("...while its submissions stay readable in the assignment's queue",
        archivedAssignmentId
          ? (await asInstructor.submissions.listForAssignment({
              assignmentId: archivedAssignmentId,
            })).submissions.length > 0
          : "no submission to read",
        true);
      await asInstructor.courses.setArchived({ courseId: course.id, archived: false });

      check("a student cannot read a cohort's triage",
        await refusal(() => asStudent.submissions.triage({ courseId: course.id })),
        "FORBIDDEN");

      /*
        ---- One student's record, which is the grading queue's other axis -----------

        `listForAssignment` is one assignment across many students; `listForStudent` is one student
        across many assignments. They share the select and the row decoration, so the checks worth
        making here are the ones about the *difference*: what the rows cover, and who may read them.
      */
      const record = await asInstructor.submissions.listForStudent({
        courseId: course.id,
        studentId,
      });
      check("a student's record names them, with the fields the header shows",
        {
          id: record.student.id,
          hasEmail: record.student.email !== null,
          hasGithub: record.student.githubUsername !== null,
        },
        { id: studentId, hasEmail: true, hasGithub: true });
      check("...and the cohort it is scoped to", record.course.id, course.id);

      /*
        **A row per assignment, not per submission.** "Has not begun this" is a fact about a student
        that a list of only their submissions cannot state, and it is the difference from the queue —
        where a student who never accepted is deliberately absent, because that screen asks what is
        left to grade rather than how somebody is doing.
      */
      const courseAssignments = await tx.assignment.count({ where: { courseId: course.id } });
      check("there is a row for every assignment in the cohort",
        record.rows.length, courseAssignments);
      check("...including ones with nothing handed in",
        record.rows.some((row) => row.submission === null), true);
      check("...and at least one with something",
        record.rows.some((row) => row.submission !== null), true);

      // Every row carries what the review pane needs, which is per-assignment here where the queue
      // reads it once for the page. A missing threshold would silently mark work incomplete.
      check("every row carries its own assignment's grading settings",
        record.rows.every((row) =>
          typeof row.assignment.completionThreshold === "number" &&
          typeof row.assignment.manualOnly === "boolean" &&
          row.assignment.module !== null),
        true);

      // Scoped to this student and nobody else. The relation is filtered by `studentId`, and a
      // mistake there would quietly show one student another's work on a screen titled with their
      // name — which is the worst failure this procedure has available.
      const foreign = await tx.submission.findFirst({
        where: { assignment: { courseId: course.id }, studentId: { not: studentId } },
        select: { id: true },
      });
      check("no other student's submission appears in it",
        record.rows.every((row) => row.submission === null || row.submission.student.id === studentId),
        true);
      if (foreign) {
        check("...checked against a submission that really belongs to somebody else",
          record.rows.some((row) => row.submission?.id === foreign.id), false);
      }

      check("the cohorts offered include the one being read",
        record.courses.some((row) => row.id === course.id), true);

      check("a student cannot read their own record through this",
        await refusal(() =>
          asStudent.submissions.listForStudent({ courseId: course.id, studentId })),
        "FORBIDDEN");

      /*
        A student who is not in this cohort is NOT_FOUND rather than an empty list. An empty list
        reads as "this person has done nothing", which is a different and false statement.
      */
      const outsider = await tx.profile.findFirst({
        where: { id: { not: studentId }, enrollments: { none: { courseId: course.id } } },
        select: { id: true },
      });
      if (outsider) {
        check("a student who is not in the cohort is refused rather than shown as idle",
          await refusal(() =>
            asInstructor.submissions.listForStudent({
              courseId: course.id,
              studentId: outsider.id,
            })),
          "NOT_FOUND");
      } else {
        check("no account outside the cohort to check against", "skipped", "skipped");
      }

      // ---- Removing, and the pair that must not come apart ------------------
      //
      // Every check below asserts both halves. A removed student who can still submit, and one
      // who can no longer read what they were given, are both defects, and each is one enum
      // value away from the other in code that reads the same.
      const seededAssignment = await tx.assignment.findFirst({
        where: { courseId: course.id, distributedAt: { not: null } },
        select: { id: true },
      });

      /*
        What this student had waiting before they were removed, measured rather than assumed.

        Every check below asserts something is *absent* from a list, and a student with nothing
        outstanding would satisfy all of them while measuring nothing at all. So the pile is read
        first, and asserted to contain their work.
      */
      const theirsBefore = outstanding.submissions.filter(
        (row) => row.student.id === studentId,
      );
      const othersBefore = outstanding.submissions.filter(
        (row) => row.student.id !== studentId,
      );
      check("this student has work in triage before being removed",
        theirsBefore.length > 0, true);

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
      // Through `courses.roster`, which is the screen that shows them. The gradebook stopped
      // returning the whole enrollment list when the roster became its own read, and it is that
      // read's job to keep a departed student visible.
      check("...and is still on the roster, so they can be put back",
        (await asInstructor.courses.roster({ courseId: course.id }))
          .enrollments.some((row) => row.student.id === studentId),
        true);

      /*
        ---- Out of the work lists, into the record --------------------------------

        The pair that is the whole point of removing rather than deleting. Nobody is going to grade
        a submission from somebody who has left the program, so it must not sit in a list of work
        outstanding — and it must not vanish either, because how a student did before they left is
        the reason for keeping the row.

        Both halves in the same group, because each is one filter away from the other.
      */
      const afterRemoval = await asInstructor.submissions.triage({ courseId: course.id });
      check("a removed student's work leaves triage",
        afterRemoval.submissions.some((row) => row.student.id === studentId), false);
      // And only theirs. A filter that emptied the whole pile would pass the check above.
      check("...and nobody else's does",
        afterRemoval.submissions.length, othersBefore.length);

      const queue = await asInstructor.submissions.listForAssignment({
        assignmentId: theirsBefore[0]!.assignment.id,
      });
      check("...and leaves the assignment's queue",
        queue.submissions.some((row) => row.student.id === studentId), false);
      check("...while staying openable from the gradebook",
        queue.removedSubmissions.some((row) => row.student.id === studentId), true);
      /*
        The two arrays are the whole of it. Written as one query partitioned in two rather than as
        a filter and its complement, because two queries can each miss a row and nothing says so —
        a submission in neither list is unreachable and unreported.
      */
      check("...and the two lists together are every submission",
        queue.submissions.length + queue.removedSubmissions.length,
        await tx.submission.count({ where: { assignmentId: theirsBefore[0]!.assignment.id } }));

      const book = await asInstructor.courses.gradebook({ courseId: course.id });
      check("their grades move to the removed table",
        book.removedCells.some((cell) => cell.studentId === studentId), true);
      check("...and out of the cohort's own",
        book.cells.some((cell) => cell.studentId === studentId), false);
      check("...and they are listed as removed",
        book.removedEnrollments.some((row) => row.student.id === studentId), true);
      /*
        Which is what makes the course heading's "N submissions waiting on you" agree with triage.
        It counts `cells`, so the two are the same claim rather than two counts that have to be
        kept in step by hand — they disagreed before, and nothing on either screen said so.
      */
      check("...so the course heading's outstanding count matches triage",
        book.cells.filter((cell) => cell.bucket !== null && cell.bucket !== "generating").length,
        afterRemoval.submissions.length);

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
      /*
        And their work comes back with them, unchanged. Nothing was closed or rewritten on removal,
        which is what makes this reversible: the filter reads live enrollment status, so restoring
        somebody is the whole of putting their unfinished work back on the pile.
      */
      check("...and their outstanding work is back in triage",
        (await asInstructor.submissions.triage({ courseId: course.id }))
          .submissions.filter((row) => row.student.id === studentId).length,
        theirsBefore.length);

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

      /*
        ---- Co-teaching a cohort ----------------------------------------------

        The second link, and the one whose refusals matter more than its successes. It admits
        somebody to authoring and to every student's grade in a cohort, so the check that earns
        its place is that it **grants a course and never a role**: the same account is refused
        while it is a student and admitted once an admin has made it staff, which is the whole
        of the design. If that guard were wrong, any instructor could hand out staff access by
        forwarding a course link.

        The promotion happens inside this transaction and is rolled back with everything else.
        Using one account for both halves is deliberate — it is what makes the pair a comparison
        rather than two unrelated facts about two people.
      */
      const coTaught = await asInstructor.courses.create({
        name: "Verify Co-teaching",
        cohortTerm: "Cohort Verify D",
      });
      const coTeachToken = (await tx.course.findUnique({
        where: { id: coTaught.course.id },
        select: { coTeachToken: true },
      }))!.coTeachToken;

      check("a new course gets a co-teach token", coTeachToken.length >= 32, true);
      check("...which is not its join token",
        coTeachToken === (await tx.course.findUnique({
          where: { id: coTaught.course.id },
          select: { joinToken: true },
        }))!.joinToken,
        false);

      check("an unknown co-teach token previews as nothing",
        await asStudent.courses.previewCoTeach({ token: "not-a-real-co-teach-token" }), null);

      // ---- Refused while the account is a student ----
      const asStudentPreview = await asStudent.courses.previewCoTeach({ token: coTeachToken });
      check("a student is told they are not eligible", asStudentPreview?.eligible, false);
      check("...and the preview still names the cohort", asStudentPreview?.name,
        "Verify Co-teaching");

      const studentRefusal = await refusalMessage(() =>
        asStudent.courses.acceptCoTeach({ token: coTeachToken }));
      check("a student cannot take up a co-teach link",
        studentRefusal.includes("instructor invitation"), true);
      check("...and no instructor row was written",
        await tx.courseInstructor.count({
          where: { courseId: coTaught.course.id, userId: studentId },
        }),
        0);

      // ---- Made staff, and now admitted ----
      //
      // The promotion an admin performs, done directly here because `staff.setAdmin` and the
      // invitation flow are `verify:staff`'s subject rather than this script's.
      await tx.profile.update({ where: { id: studentId }, data: { role: "INSTRUCTOR" } });
      const asNewInstructor = createCaller({ db: tx, user: { id: studentId } } as never);

      // Before redeeming, so it is genuinely somebody outside the course. Holding the role says
      // nothing about which cohorts, which is the distinction every teach gate rests on.
      check("an instructor who does not teach it cannot replace its co-teach link",
        await refusal(() =>
          asNewInstructor.courses.regenerateCoTeachToken({ courseId: coTaught.course.id })),
        "FORBIDDEN");
      check("...and cannot read its settings either",
        await refusal(() => asNewInstructor.courses.settings({ courseId: coTaught.course.id })),
        "FORBIDDEN");

      const eligiblePreview = await asNewInstructor.courses.previewCoTeach({
        token: coTeachToken,
      });
      check("an instructor is eligible", eligiblePreview?.eligible, true);
      check("...and does not teach it yet", eligiblePreview?.alreadyTeaches, false);

      check("redeeming adds them",
        (await asNewInstructor.courses.acceptCoTeach({ token: coTeachToken })).added, true);

      /*
        The check the whole feature is for. A `CourseInstructor` row that exists but does not
        actually let somebody work in the cohort would look completely correct in the database —
        every authoring procedure gates on this table, so the proof is calling one.
      */
      const theirSettings = await asNewInstructor.courses.settings({
        courseId: coTaught.course.id,
      });
      check("...and they can now read the cohort they teach", theirSettings.course.id,
        coTaught.course.id);
      check("...and it lists both instructors", theirSettings.course.instructors.length, 2);
      check("...with the creator marked as such",
        theirSettings.course.instructors.filter((row) => row.isPrimary).length, 1);

      /*
        Idempotent, the same way `enrollments.join` is: `@@unique([courseId, userId])` means a
        bookmarked link is not a case to handle. The row count is the half that matters — `added:
        false` alone would pass while a second row was written by something else.
      */
      check("redeeming twice adds nothing",
        (await asNewInstructor.courses.acceptCoTeach({ token: coTeachToken })).added, false);
      check("...and there is still one row for them",
        await tx.courseInstructor.count({
          where: { courseId: coTaught.course.id, userId: studentId },
        }),
        1);

      // ---- The refusals that are about the cohort rather than the account ----
      const archivedCourse = await asInstructor.courses.create({
        name: "Verify Co-teaching Archived",
        cohortTerm: "Cohort Verify E",
      });
      await asInstructor.courses.setArchived({
        courseId: archivedCourse.course.id,
        archived: true,
      });
      const archivedCoTeachToken = (await tx.course.findUnique({
        where: { id: archivedCourse.course.id },
        select: { coTeachToken: true },
      }))!.coTeachToken;
      check("an archived cohort takes no new instructors",
        await refusal(() => asNewInstructor.courses.acceptCoTeach({ token: archivedCoTeachToken })),
        "PRECONDITION_FAILED");

      /*
        Enrolled as a student and teaching are mutually exclusive, the mirror of
        `enrollments.join` refusing an instructor of the course. Being both would put their own
        submissions in the queue they are meant to be working through.
      */
      const bothCourse = await asInstructor.courses.create({
        name: "Verify Co-teaching Enrolled",
        cohortTerm: "Cohort Verify F",
      });
      const bothTokens = (await tx.course.findUnique({
        where: { id: bothCourse.course.id },
        select: { joinToken: true, coTeachToken: true },
      }))!;
      await asNewInstructor.enrollments.join({ token: bothTokens.joinToken });
      check("somebody enrolled as a student cannot also teach the cohort",
        await refusal(() =>
          asNewInstructor.courses.acceptCoTeach({ token: bothTokens.coTeachToken })),
        "PRECONDITION_FAILED");

      // ---- Replacing the link ----
      const rotatedCoTeach = await asInstructor.courses.regenerateCoTeachToken({
        courseId: coTaught.course.id,
      });
      check("replacing the co-teach link changes it", rotatedCoTeach.coTeachToken !== coTeachToken, true);
      check("...and the old one stops working",
        await refusal(() => asNewInstructor.courses.acceptCoTeach({ token: coTeachToken })),
        "NOT_FOUND");
      check("...while instructors already on the course keep it",
        (await asNewInstructor.courses.settings({ courseId: coTaught.course.id }))
          .course.instructors.length,
        2);

      // ---- Removing an instructor ----
      //
      // The last one is refused, the same shape and the same reasoning as revoking the last
      // admin: a course with no instructors cannot be authored in or graded by anybody, and the
      // only way back is a database edit. The count is asserted first, because a spare
      // instructor lying around would make that refusal pass while testing nothing.
      check("removing one of two instructors is allowed",
        (await asInstructor.courses.removeInstructor({
          courseId: coTaught.course.id,
          userId: studentId,
        })).courseId,
        coTaught.course.id);
      check("...and they lose access with it",
        await refusal(() => asNewInstructor.courses.settings({ courseId: coTaught.course.id })),
        "FORBIDDEN");
      check("...leaving exactly one instructor",
        await tx.courseInstructor.count({ where: { courseId: coTaught.course.id } }), 1);
      check("...and the last one cannot be removed",
        await refusal(() => asInstructor.courses.removeInstructor({
          courseId: coTaught.course.id,
          userId: instructor.userId,
        })),
        "PRECONDITION_FAILED");

      check("removing somebody who does not teach the course is refused",
        await refusal(() => asInstructor.courses.removeInstructor({
          courseId: coTaught.course.id,
          userId: studentId,
        })),
        "NOT_FOUND");

      throw new Error("ROLLBACK");
    }, { timeout: 120_000 });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  // ---- Nothing survived --------------------------------------------------
  //
  // Whatever the status was before, not "ACTIVE". The script removes and restores this student and
  // may have had to restore them to begin with, so the claim worth making is that the row came out
  // exactly as it went in — hardcoding a value would report a real removal as a failure.
  check("the seeded student's enrollment is unchanged",
    (await db.enrollment.findUnique({
      where: { id: enrollment.id },
      select: { status: true },
    }))?.status,
    enrollment.status);
  check("no courses this script created survived the rollback",
    await db.course.count({ where: { cohortTerm: { startsWith: "Cohort Verify" } } }), 0);

  return report();
}

main().catch((err) => { console.error("\n", err); process.exit(1); });
