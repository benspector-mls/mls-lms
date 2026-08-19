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
 * **Three groups are worth reading.** A removed student keeps reading the feedback they were given
 * and cannot hand anything else in, and those two facts are one `where` clause apart in code that
 * otherwise reads identically — every check there asserts both halves, because getting one right
 * and the other wrong is the failure that design can actually produce. The co-teaching group
 * takes one account, has it refused while it is a student, promotes it, and has it
 * admitted: the link grants a course and never a role, and one account doing both halves is what
 * makes that a comparison rather than two unrelated facts about two people.
 *
 * And the ownership group after it is written in pairs for the same reason — the owner is allowed
 * and the co-teacher is refused at the same call, because a one-sided check passes against a
 * guard that refuses everybody. It ends by clearing `isPrimary` off a course directly, which is
 * the only way to reach the state a deleted owner's account would leave behind, and by reading
 * the partial unique index out of the catalog, which is the one rule here that lives in the
 * database rather than in a procedure.
 */
import { createChecker, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();

/** What a call refused with, message included, for the checks that are about the wording. */
async function refusalMessage(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { studentRepoName, slugifyCohort, suggestCohortSlug, cohortSlugProblem } =
    await import("../lib/courses/cohort-slug");
  const links = await import("../lib/links");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { ownerOf } = await import("../lib/courses/ownership");

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
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  /*
    The cohort's **owner**, not whichever instructor row comes back first.

    `findFirst` with no ordering was fine while a course had one instructor and stopped being
    fine the day it could have two: archiving is owner-gated, so a script that picked the
    co-teacher would report a working guard as a broken feature — or, worse, pick the owner by
    luck on one run and not the next. Same defect as choosing an outsider by "an instructor who
    is not this one", which two scripts had and which passed by accident.
  */
  const instructor = course
    ? ownerOf(
        await db.courseInstructor.findMany({
          where: { courseId: course.id },
          select: { userId: true, isPrimary: true, createdAt: true },
        }),
      )
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
    skip("needs a seeded course with an instructor, a student, and at least one submission");
    return finish();
  }

  const studentId = enrollment.studentId;
  const createCaller = createCallerFactory(appRouter);

  try {
    await db.$transaction(
      async (tx) => {
        const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
        const asStudent = createCaller({ db: tx, user: { id: studentId } } as never);

        // Inside the transaction, so it is undone with everything else.
        if (enrollment.status !== "ACTIVE") {
          await asInstructor.enrollments.restore({ enrollmentId: enrollment.id });
        }

        // ---- Turning text into a slug ------------------------------------------
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
          check(`"${term}" slugifies to "${expected}"`, slugifyCohort(term), expected);
        }

        /*
        ---- The short name a new course is offered -----------------------------

        **The course and the term, not the term alone.** That is the whole reason this function
        exists: every program a school runs starts in the fall, so a term-only suggestion made
        `fall-2026` the short name of whichever course was created first and a refusal for the
        rest — and the instructor hitting the refusal had done nothing wrong.

        The pair that matters most is the middle one: **one program's short name is the same
        shape in every season**. Measured against the term in hand rather than against the
        longest a term can be, a fellowship would be `software-engineering-f26` in the autumn and
        `software-sp27` in the spring — one character of season costing a word of the course name
        — and two cohorts of the same program would stop looking related.

        Uniqueness is still the database's. Two programs whose names abbreviate the same way
        collide, which this cannot prevent and `create` refuses in words.
      */
        const suggestions: [string, string, string][] = [
          // Short enough whole.
          ["Data Science", "Fall 2026", "data-science-f26"],
          // Too long whole, so the course becomes its initials — and stays that way across seasons.
          ["Software Engineering Fellowship", "Fall 2026", "sef-f26"],
          ["Software Engineering Fellowship", "Spring 2027", "sef-sp27"],
          ["Data Science", "Spring 2027", "data-science-sp27"],
          // A term this cannot compact keeps its full slug, and the course gives way to it.
          ["Software Engineering Fellowship", "Cohort 12 (evening)", "sef-cohort-12-evening"],
          // Seasons that share a first letter are still told apart.
          ["Data Science", "Summer 2026", "data-science-su26"],
          ["Data Science", "Winter 2026", "data-science-w26"],
          // A two-digit year, for the people who write it that way.
          ["Data Science", "Fall '26", "data-science-f26"],
          // Half a form is half a suggestion rather than none.
          ["", "Fall 2026", "f26"],
          ["Data Science", "", "data-science"],
        ];
        for (const [courseName, cohortTerm, expected] of suggestions) {
          check(
            `"${courseName}" + "${cohortTerm}" suggests "${expected}"`,
            suggestCohortSlug({ courseName, cohortTerm }),
            expected,
          );
        }

        // Every one of them has to be a legal repository name, which is the only property that
        // actually matters — a suggestion the form would then reject is worse than no suggestion.
        for (const [courseName, cohortTerm] of suggestions) {
          const slug = suggestCohortSlug({ courseName, cohortTerm });
          if (slug === "") continue;
          check(`..."${slug}" is a usable short name`, cohortSlugProblem(slug), null);
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
          ["the coursework list", links.curriculumHref(alpha), links.curriculumHref(beta)],
          ["resources", links.curriculumHref(alpha), links.curriculumHref(beta)],
          ["the gradebook", links.gradebookHref(alpha), links.gradebookHref(beta)],
          ["the roster", links.rosterHref(alpha), links.rosterHref(beta)],
          ["modules", links.curriculumHref(alpha), links.curriculumHref(beta)],
          ["settings", links.courseSettingsHref(alpha), links.courseSettingsHref(beta)],
          // The four that cannot carry across, each landing on settings rather than on another
          // cohort's copy of an id it does not have.
          [
            "an assignment's queue",
            links.gradingQueueHref(alpha, someAssignment),
            links.courseSettingsHref(beta),
          ],
          [
            "an assignment's edit form",
            links.editAssignmentHref(alpha, someAssignment),
            links.courseSettingsHref(beta),
          ],
          [
            "the new-assignment form",
            links.newAssignmentHref(alpha),
            links.courseSettingsHref(beta),
          ],
          ["a student's record", links.studentHref(alpha, "stu-1"), links.courseSettingsHref(beta)],
          // The bare course address, which is itself a redirect to settings.
          ["the course address", links.courseHref(alpha), links.courseSettingsHref(beta)],
          // No course in the address at all, which is the course list.
          ["the course list", "/courses", links.courseSettingsHref(beta)],
        ];
        for (const [what, from, expected] of switches) {
          check(`switching cohort from ${what}`, links.sameViewInCourse(from, beta), expected);
        }

        check(
          "a queue link can still open one submission",
          links.gradingQueueHref(alpha, someAssignment, "sub-1"),
          `/instructor/courses/${alpha}/curriculum/${someAssignment}?submission=sub-1`,
        );

        /*
        A student's record is course-scoped for the same reason everything else is: the same person
        repeating a module has two sets of submissions, and an address naming only the student would
        have to pick one. The optional submission carries over so the gradebook and the review
        header can open a particular piece of work rather than the top of the list.
      */
        check(
          "a student's record names its cohort",
          links.studentHref(alpha, "stu-1"),
          `/instructor/courses/${alpha}/students/stu-1`,
        );
        check(
          "...and can open one of their submissions",
          links.studentHref(alpha, "stu-1", "sub-1"),
          `/instructor/courses/${alpha}/students/stu-1?submission=sub-1`,
        );

        // ---- Creating a cohort ------------------------------------------------
        // Distinct terms, because a slug is unique across every course and the term is what
        // suggests it. Two cohorts called the same thing is a real situation and a real refusal —
        // checked below deliberately rather than tripped over here.
        const empty = await asInstructor.courses.create({
          name: "Verify Empty",
          cohortTerm: "Cohort Verify A",
        });
        check("a course is created", empty.course.name, "Verify Empty");
        check(
          "...with nothing copied into it",
          { copied: empty.copied, failed: empty.failed },
          { copied: 0, failed: [] },
        );

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
        check("the creator is the primary instructor", created?.instructors, [
          { userId: instructor.userId, isPrimary: true },
        ]);
        check("a join token is generated", (created?.joinToken ?? "").length >= 32, true);

        const context = await asInstructor.assignments.authoringContext({
          courseId: empty.course.id,
        });
        check("...and can author in the course immediately", context.course.name, "Verify Empty");

        // ---- Copying ----------------------------------------------------------
        const sourceModules = await tx.courseUnit.findMany({
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

        const copiedModules = await tx.courseUnit.findMany({
          where: { courseId: copy.course.id },
          select: { name: true, position: true },
          orderBy: { position: "asc" },
        });
        check("copying reproduces every module, name and position", copiedModules, sourceModules);

        /*
        Every assignment, or a named reason for each that did not arrive.

        Reported rather than asserted to be all of them, because a copy legitimately fails when
        a template repository was made private since last term — and this script runs against
        whatever the sandbox organization currently holds.
      */
        check(
          "copying reproduces every assignment",
          copy.copied + copy.failed.length,
          sourceAssignments,
        );
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
        check(
          "copies arrive unpublished",
          copiedAssignments.every((row) => row.distributedAt === null),
          true,
        );
        check(
          "...with due dates cleared",
          copiedAssignments.every((row) => row.dueAt === null),
          true,
        );

        /*
        The repository columns, on the kinds that have them.

        Narrowed to REPO deliberately: a Drive or file-upload assignment has no template and
        no answer keys, and the schema requires them to be null. A check over every kind would
        fail on a correctly copied document — which is exactly how it did fail first time.
      */
        const copiedRepos = copiedAssignments.filter((row) => row.kind === "REPO");
        check(
          "a copied repository assignment keeps both repositories and its answer key folder",
          copiedRepos.length > 0 &&
            copiedRepos.every(
              (row) =>
                row.templateRepo !== null &&
                row.answerKeyRepo !== null &&
                row.answerKeyDir !== null,
            ),
          true,
        );
        check(
          "...and the kinds with no repository keep none",
          copiedAssignments
            .filter((row) => row.kind !== "REPO")
            .every((row) => row.templateRepo === null && row.answerKeyRepo === null),
          true,
        );

        check(
          "a student cannot create a course",
          await refusal(() => asStudent.courses.create({ name: "Nope", cohortTerm: "Nope" })),
          "FORBIDDEN",
        );

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
            kind: "REPO",
            assignmentRepoName: { not: null },
            githubOrg: { not: null },
          },
          select: { id: true, assignmentRepoName: true, githubOrg: true },
        });

        check(
          "a copied course gets its own short name",
          copy.course.cohortSlug !== empty.course.cohortSlug && copy.course.cohortSlug.length > 0,
          true,
        );

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
              githubLogin: "somebody",
            });
            const inCopy = studentRepoName({
              cohortSlug: copy.course.cohortSlug,
              assignmentRepoName: twinInCopy.assignmentRepoName!,
              githubLogin: "somebody",
            });
            check(
              "the same assignment in two cohorts generates two different repository names",
              inOriginal !== inCopy,
              true,
            );
            check(
              "...and each starts with its own cohort",
              inCopy.startsWith(`${copy.course.cohortSlug}-`),
              true,
            );
          }
        }

        // ---- The short name, and its window -----------------------------------
        check(
          "a duplicate short name is refused",
          await refusal(() =>
            asInstructor.courses.create({
              name: "Verify Duplicate",
              cohortTerm: "Cohort Verify D",
              cohortSlug: empty.course.cohortSlug,
            }),
          ),
          "CONFLICT",
        );

        check(
          "an illegal short name is refused",
          await refusal(() =>
            asInstructor.courses.create({
              name: "Verify Illegal",
              cohortTerm: "Cohort Verify E",
              cohortSlug: "Fall 2026!",
            }),
          ),
          "BAD_REQUEST",
        );

        /*
        A term with nothing in it leaves the course name carrying the short name on its own,
        which is the point of the suggestion naming both halves. Nothing is invented — it is
        still derived from what the instructor typed — so this is a fallback rather than a
        refusal. The refusal is for the case where neither half yields anything, because that
        is where a name nobody chose would have to be made up.
      */
        check(
          "a term with nothing usable in it leaves the course name carrying it",
          (await asInstructor.courses.create({ name: "Verify Blank", cohortTerm: "!!!" })).course
            .cohortSlug,
          "verify-blank",
        );
        check(
          "...and nothing usable in either half is refused rather than guessed at",
          await refusal(() => asInstructor.courses.create({ name: "!!!", cohortTerm: "???" })),
          "BAD_REQUEST",
        );

        /*
        And once set it cannot be changed, by anybody, ever — there is no procedure that changes
        it. Asserted against the router rather than against a screen, because "the button is not
        rendered" is a different claim: the check that matters is that no caller can reach it.
      */
        check(
          "nothing can change a short name after creation",
          "setCohortSlug" in asInstructor.courses,
          false,
        );

        // ---- The join link ----------------------------------------------------
        const token = created!.joinToken;

        const preview = await asStudent.enrollments.preview({ token });
        check("the link says which course it is", preview?.name, "Verify Empty");
        check("...and that the caller is not in it yet", preview?.alreadyIn, null);

        check(
          "an unknown token previews as nothing",
          await asStudent.enrollments.preview({ token: "not-a-real-token" }),
          null,
        );

        /*
          ---- The roster, which the link is now only half of --------------------

          The link is unguessable; the roster is an allowlist. Neither is enough alone, and the
          order of these checks is the order somebody meets them: refused first, added, then in.
        */
        check(
          "a student who was never expected cannot use the link",
          await refusal(() => asStudent.enrollments.join({ token })),
          "FORBIDDEN",
        );
        check("...and the screen says so before the button", preview?.onRoster, false);

        const studentProfile = (await tx.profile.findUniqueOrThrow({
          where: { id: studentId },
          select: { githubUsername: true, email: true },
        }))!;

        const added = await asInstructor.enrollments.addToRoster({
          courseId: empty.course.id,
          entries: [
            {
              githubUsername: studentProfile.githubUsername,
              email: studentProfile.email,
              note: "Expected by the verification script",
            },
          ],
        });
        check("an instructor can write down who is expected", added.added, 1);
        check(
          "...and the screen now offers the button",
          (await asStudent.enrollments.preview({ token }))?.onRoster,
          true,
        );

        // Pasting the same list twice is something people do. The second paste adds nothing and
        // says so rather than failing on the unique constraint.
        check(
          "adding the same person again is skipped rather than refused",
          (
            await asInstructor.enrollments.addToRoster({
              courseId: empty.course.id,
              entries: [
                {
                  githubUsername: studentProfile.githubUsername,
                  email: studentProfile.email,
                  note: null,
                },
              ],
            })
          ).alreadyPresent,
          1,
        );

        const joined = await asStudent.enrollments.join({ token });
        check("redeeming the link enrolls the student", joined.joined, true);

        /*
          One entry admits one person, and the claim is what says so. Written in the same
          transaction as the enrollment, so an entry marked used always has a member behind it.
        */
        check(
          "joining claims the entry that expected them",
          (
            await tx.rosterEntry.findFirst({
              where: { courseId: empty.course.id, claimedById: studentId },
              select: { claimedAt: true },
            })
          )?.claimedAt !== undefined,
          true,
        );

        // A claimed entry cannot be tidied away: it is the record of how somebody got in, and
        // removing it would not remove them.
        const claimedEntry = await tx.rosterEntry.findFirstOrThrow({
          where: { courseId: empty.course.id, claimedById: studentId },
          select: { id: true },
        });
        check(
          "a claimed entry cannot be removed from the list",
          await refusal(() =>
            asInstructor.enrollments.removeFromRoster({
              courseId: empty.course.id,
              entryId: claimedEntry.id,
            }),
          ),
          "PRECONDITION_FAILED",
        );
        check(
          "...as ACTIVE",
          (
            await tx.enrollment.findFirst({
              where: { courseId: empty.course.id, studentId },
              select: { status: true },
            })
          )?.status,
          "ACTIVE",
        );

        /*
        Idempotent, which is what makes a reusable link safe. A student who opens it twice, or
        bookmarks it, must not produce a second enrollment — `@@unique([courseId, studentId])`
        is the constraint, and this is the procedure agreeing with it rather than provoking it.
      */
        const again = await asStudent.enrollments.join({ token });
        check("redeeming it twice does not enroll them twice", again.joined, false);
        check(
          "...and there is one enrollment",
          await tx.enrollment.count({ where: { courseId: empty.course.id, studentId } }),
          1,
        );

        /*
          **An enrollment that already exists outranks the roster, and this is the check that says
          so.** Every student enrolled before the roster table existed has no entry, so a roster
          check placed before the already-in branch tells somebody sitting in a course that the
          link to it is not for their account. It did, until the order in `join` and `preview` was
          corrected — which is a mistake with no symptom until a real cohort meets it.

          Tested by taking the entry away underneath them: the enrollment stays, and so must the
          answer.
        */
        await tx.rosterEntry.deleteMany({
          where: { courseId: empty.course.id, claimedById: studentId },
        });
        check(
          "a student already in the cohort is unaffected by having no entry",
          (await asStudent.enrollments.join({ token })).joined,
          false,
        );
        check(
          "...and their screen still says they are in it, not that the link is not theirs",
          (await asStudent.enrollments.preview({ token }))?.onRoster,
          true,
        );

        // An instructor of the course is refused: an enrollment would put them in their own
        // roster and gradebook, and accepting would file a submission in their own queue.
        check(
          "an instructor of the course cannot join it as a student",
          await refusal(() => asInstructor.enrollments.join({ token })),
          "PRECONDITION_FAILED",
        );

        // Rotating the link invalidates the old one, which is the only control over who can use
        // it. Students already in are unaffected — the token is how you join, not how you stay.
        const rotated = await asInstructor.courses.regenerateJoinToken({
          courseId: empty.course.id,
        });
        check("regenerating changes the token", rotated.joinToken !== token, true);
        check(
          "the old link no longer works",
          await refusal(() => asStudent.enrollments.join({ token })),
          "NOT_FOUND",
        );
        check(
          "...and the student who already joined is still enrolled",
          (
            await tx.enrollment.findFirst({
              where: { courseId: empty.course.id, studentId },
              select: { status: true },
            })
          )?.status,
          "ACTIVE",
        );

        check(
          "a student cannot regenerate a join link",
          await refusal(() => asStudent.courses.regenerateJoinToken({ courseId: empty.course.id })),
          "FORBIDDEN",
        );

        // An archived cohort takes no new students, which is the same "readable, accepts nothing"
        // pair a removed student gets.
        await asInstructor.courses.setArchived({ courseId: copy.course.id, archived: true });
        const archivedToken = (await tx.course.findUnique({
          where: { id: copy.course.id },
          select: { joinToken: true },
        }))!.joinToken;
        check(
          "an archived cohort refuses new students",
          await refusal(() => asStudent.enrollments.join({ token: archivedToken })),
          "PRECONDITION_FAILED",
        );

        /*
        ---- An archived cohort stays reachable, labelled ------------------------

        `listMine` used to filter `archivedAt: null`, which meant archiving a cohort was also
        the only way to make one unreachable: every procedure still admitted its members, so the
        work was all there and openable by a URL somebody happened to have kept and by nothing
        else. The pair below is the whole fix — it is in the list, and the list says which it is.

        Both halves matter. Returning the row without the label would put a finished term in
        among the running ones with nothing to tell them apart, which is the same mistake as an
        unlabelled course a student was removed from.
      */
        const archivedRow = (await asInstructor.courses.listMine()).find(
          (row) => row.id === copy.course.id,
        );
        check("an archived cohort stays in the course list", archivedRow !== undefined, true);
        check("...labelled as archived", archivedRow?.archivedAt !== null, true);

        await asInstructor.courses.setArchived({ courseId: copy.course.id, archived: false });
        check(
          "reopening clears the label",
          (await asInstructor.courses.listMine()).find((row) => row.id === copy.course.id)
            ?.archivedAt,
          null,
        );

        check(
          "a student cannot archive a course",
          await refusal(() =>
            asStudent.courses.setArchived({ courseId: empty.course.id, archived: true }),
          ),
          "FORBIDDEN",
        );

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
        check("the seeded cohort has work in triage", outstanding.submissions.length > 0, true);

        // The copy is unpublished and nobody has submitted to it, so a triage that crossed
        // courses would show the seeded cohort's work here.
        check(
          "triage is scoped to the cohort asked for",
          (await asInstructor.submissions.triage({ courseId: copy.course.id })).submissions.length,
          0,
        );

        await asInstructor.courses.setArchived({ courseId: course.id, archived: true });
        check(
          "an archived cohort's submissions leave triage",
          (await asInstructor.submissions.triage({ courseId: course.id })).submissions.length,
          0,
        );
        /*
        The student's own list, while the cohort they are in is archived. Off the list of work
        and not off the list of courses — this is the half a reader is most likely to get wrong,
        because "archived" reads as "gone" and the whole point is that it is not.
      */
        check(
          "...while the students in it keep the cohort on their own list",
          (await asStudent.courses.listMine()).find((row) => row.id === course.id)?.archivedAt !==
            null,
          true,
        );
        await asInstructor.courses.setArchived({ courseId: course.id, archived: false });
        check(
          "...and come back when it is reopened",
          (await asInstructor.submissions.triage({ courseId: course.id })).submissions.length,
          outstanding.submissions.length,
        );

        // Readable, though: archiving stops the cohort appearing in a list of work to do, and
        // takes nothing back. The assignment's own queue is how its submissions are read.
        await asInstructor.courses.setArchived({ courseId: course.id, archived: true });
        const archivedAssignmentId = outstanding.submissions[0]?.assignment.id;
        check(
          "...while its submissions stay readable in the assignment's queue",
          archivedAssignmentId
            ? (
                await asInstructor.submissions.listForAssignment({
                  assignmentId: archivedAssignmentId,
                })
              ).submissions.length > 0
            : "no submission to read",
          true,
        );
        await asInstructor.courses.setArchived({ courseId: course.id, archived: false });

        check(
          "a student cannot read a cohort's triage",
          await refusal(() => asStudent.submissions.triage({ courseId: course.id })),
          "FORBIDDEN",
        );

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
        check(
          "a student's record names them, with the fields the header shows",
          {
            id: record.student.id,
            hasEmail: record.student.email !== null,
            hasGithub: record.student.githubUsername !== null,
          },
          { id: studentId, hasEmail: true, hasGithub: true },
        );
        check("...and the cohort it is scoped to", record.course.id, course.id);

        /*
        **A row per assignment, not per submission.** "Has not begun this" is a fact about a student
        that a list of only their submissions cannot state, and it is the difference from the queue —
        where a student who never accepted is deliberately absent, because that screen asks what is
        left to grade rather than how somebody is doing.
      */
        const courseAssignments = await tx.assignment.count({ where: { courseId: course.id } });
        check(
          "there is a row for every assignment in the cohort",
          record.rows.length,
          courseAssignments,
        );
        check(
          "...including ones with nothing handed in",
          record.rows.some((row) => row.submission === null),
          true,
        );
        check(
          "...and at least one with something",
          record.rows.some((row) => row.submission !== null),
          true,
        );

        // Every row carries what the review pane needs, which is per-assignment here where the queue
        // reads it once for the page. A missing threshold would silently mark work incomplete.
        check(
          "every row carries its own assignment's grading settings",
          record.rows.every(
            (row) =>
              typeof row.assignment.completionThreshold === "number" &&
              typeof row.assignment.manualOnly === "boolean" &&
              row.assignment.courseUnit !== null,
          ),
          true,
        );

        // Scoped to this student and nobody else. The relation is filtered by `studentId`, and a
        // mistake there would quietly show one student another's work on a screen titled with their
        // name — which is the worst failure this procedure has available.
        const foreign = await tx.submission.findFirst({
          where: { assignment: { courseId: course.id }, studentId: { not: studentId } },
          select: { id: true },
        });
        check(
          "no other student's submission appears in it",
          record.rows.every(
            (row) => row.submission === null || row.submission.student.id === studentId,
          ),
          true,
        );
        if (foreign) {
          check(
            "...checked against a submission that really belongs to somebody else",
            record.rows.some((row) => row.submission?.id === foreign.id),
            false,
          );
        }

        check(
          "the cohorts offered include the one being read",
          record.courses.some((row) => row.id === course.id),
          true,
        );

        check(
          "a student cannot read their own record through this",
          await refusal(() =>
            asStudent.submissions.listForStudent({ courseId: course.id, studentId }),
          ),
          "FORBIDDEN",
        );

        /*
        A student who is not in this cohort is NOT_FOUND rather than an empty list. An empty list
        reads as "this person has done nothing", which is a different and false statement.
      */
        const outsider = await tx.profile.findFirst({
          where: { id: { not: studentId }, enrollments: { none: { courseId: course.id } } },
          select: { id: true },
        });
        if (outsider) {
          check(
            "a student who is not in the cohort is refused rather than shown as idle",
            await refusal(() =>
              asInstructor.submissions.listForStudent({
                courseId: course.id,
                studentId: outsider.id,
              }),
            ),
            "NOT_FOUND",
          );
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
        const theirsBefore = outstanding.submissions.filter((row) => row.student.id === studentId);
        const othersBefore = outstanding.submissions.filter((row) => row.student.id !== studentId);
        check(
          "this student has work in triage before being removed",
          theirsBefore.length > 0,
          true,
        );

        const removed = await asInstructor.enrollments.remove({ enrollmentId: enrollment.id });
        check("removing sets the status", removed.status, "REMOVED");

        check(
          "a removed student can still read the course",
          (await asStudent.courses.get({ courseId: course.id })).id,
          course.id,
        );
        check(
          "...and its modules, which order their own assignment list",
          Array.isArray(await asStudent.courseUnits.listForCourse({ courseId: course.id })),
          true,
        );
        check(
          "...and the course stays in their list",
          (await asStudent.courses.listMine()).find((row) => row.id === course.id)?.enrolledAs,
          "REMOVED",
        );

        if (seededAssignment) {
          check(
            "...and can still read an assignment in it",
            (await asStudent.assignments.get({ assignmentId: seededAssignment.id })).courseId,
            course.id,
          );

          /*
          And cannot hand anything in. The message is checked, not only the refusal: "you are no
          longer enrolled" is a fact the student can act on, and the generic "you are not
          enrolled" would read as the application having lost them.
        */
          const refused = await refusalMessage(() =>
            asStudent.assignments.accept({ assignmentId: seededAssignment.id }),
          );
          check("...and cannot accept anything new", refused.includes("no longer enrolled"), true);
        }

        check(
          "a removed student is not counted as a student of the cohort",
          (await asInstructor.courses.gradebook({ courseId: course.id })).activeEnrollments.some(
            (row) => row.student.id === studentId,
          ),
          false,
        );
        // Through `courses.roster`, which is the screen that shows them. The gradebook stopped
        // returning the whole enrollment list when the roster became its own read, and it is that
        // read's job to keep a departed student visible.
        check(
          "...and is still on the roster, so they can be put back",
          (await asInstructor.courses.roster({ courseId: course.id })).enrollments.some(
            (row) => row.student.id === studentId,
          ),
          true,
        );

        /*
        ---- Out of the work lists, into the record --------------------------------

        The pair that is the whole point of removing rather than deleting. Nobody is going to grade
        a submission from somebody who has left the program, so it must not sit in a list of work
        outstanding — and it must not vanish either, because how a student did before they left is
        the reason for keeping the row.

        Both halves in the same group, because each is one filter away from the other.
      */
        const afterRemoval = await asInstructor.submissions.triage({ courseId: course.id });
        check(
          "a removed student's work leaves triage",
          afterRemoval.submissions.some((row) => row.student.id === studentId),
          false,
        );
        // And only theirs. A filter that emptied the whole pile would pass the check above.
        check("...and nobody else's does", afterRemoval.submissions.length, othersBefore.length);

        const queue = await asInstructor.submissions.listForAssignment({
          assignmentId: theirsBefore[0]!.assignment.id,
        });
        check(
          "...and leaves the assignment's queue",
          queue.submissions.some((row) => row.student.id === studentId),
          false,
        );
        check(
          "...while staying openable from the gradebook",
          queue.asideSubmissions.some(
            (row) => row.student.id === studentId && row.asideReason === "removed",
          ),
          true,
        );
        /*
        The two arrays are the whole of it. Written as one query partitioned in two rather than as
        a filter and its complement, because two queries can each miss a row and nothing says so —
        a submission in neither list is unreachable and unreported.
      */
        check(
          "...and the two lists together are every submission",
          queue.submissions.length + queue.asideSubmissions.length,
          await tx.submission.count({ where: { assignmentId: theirsBefore[0]!.assignment.id } }),
        );

        const book = await asInstructor.courses.gradebook({ courseId: course.id });
        check(
          "their grades move to the removed table",
          book.removedCells.some((cell) => cell.studentId === studentId),
          true,
        );
        check(
          "...and out of the cohort's own",
          book.cells.some((cell) => cell.studentId === studentId),
          false,
        );
        check(
          "...and they are listed as removed",
          book.removedEnrollments.some((row) => row.student.id === studentId),
          true,
        );
        /*
        Three readers, one claim, and they have to agree.

        "How much is outstanding in this cohort" is answered by grading triage, by the gradebook's
        own cells, and by the per-assignment "to grade" column — and the third is the one that can
        now drift, because its counts are computed in `assignmentsOverview` rather than derived in
        the browser from the gradebook's payload. Two counts kept in step by hand is exactly how
        the heading and triage disagreed before, with nothing on either screen to reconcile them.

        A removed student is what makes this worth asserting rather than tautological: every one
        of the three has to leave their work out, and each does it in a different place.
      */
        check(
          "...so the gradebook's outstanding count matches triage",
          book.cells.filter((cell) => cell.bucket !== null && cell.bucket !== "generating").length,
          afterRemoval.submissions.length,
        );
        check(
          "...and so does the assignments list, which counts them server-side",
          (
            await asInstructor.courses.assignmentsOverview({ courseId: course.id })
          ).assignments.reduce((total, row) => total + row.counts.outstanding, 0),
          afterRemoval.submissions.length,
        );

        // A removed student redeeming the link again is refused: if it let them back in, removal
        // would not stick while they still held the link.
        const rejoinToken = (await tx.course.findUnique({
          where: { id: course.id },
          select: { joinToken: true },
        }))!.joinToken;
        check(
          "a removed student cannot rejoin with the link",
          await refusal(() => asStudent.enrollments.join({ token: rejoinToken })),
          "FORBIDDEN",
        );

        const restored = await asInstructor.enrollments.restore({ enrollmentId: enrollment.id });
        check("the instructor can put them back", restored.status, "ACTIVE");
        check(
          "...and they are counted again",
          (await asInstructor.courses.gradebook({ courseId: course.id })).activeEnrollments.some(
            (row) => row.student.id === studentId,
          ),
          true,
        );
        /*
        And their work comes back with them, unchanged. Nothing was closed or rewritten on removal,
        which is what makes this reversible: the filter reads live enrollment status, so restoring
        somebody is the whole of putting their unfinished work back on the pile.
      */
        check(
          "...and their outstanding work is back in triage",
          (await asInstructor.submissions.triage({ courseId: course.id })).submissions.filter(
            (row) => row.student.id === studentId,
          ).length,
          theirsBefore.length,
        );

        check(
          "a student cannot remove anybody",
          await refusal(() => asStudent.enrollments.remove({ enrollmentId: enrollment.id })),
          "FORBIDDEN",
        );

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
        // Expected in this cohort too. A cohort's roster is its own — being on one course's list
        // says nothing about another's, which is the point of it being per course.
        await asInstructor.enrollments.addToRoster({
          courseId: elsewhere.course.id,
          entries: [
            {
              githubUsername: studentProfile.githubUsername,
              email: studentProfile.email,
              note: null,
            },
          ],
        });
        await asStudent.enrollments.join({ token: elsewhereToken });
        const foreignEnrollment = await tx.enrollment.findFirst({
          where: { courseId: elsewhere.course.id },
          select: { id: true },
        });

        // Removing the student from a course this instructor does teach is allowed; the check is
        // that teaching is what decides it, so a second instructor is needed to prove the
        // refusal. `asStudent` above already covers the role; this covers the course.
        check(
          "an enrollment in a course you teach can be removed",
          (await asInstructor.enrollments.remove({ enrollmentId: foreignEnrollment!.id })).status,
          "REMOVED",
        );

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
        check(
          "...which is not its join token",
          coTeachToken ===
            (await tx.course.findUnique({
              where: { id: coTaught.course.id },
              select: { joinToken: true },
            }))!.joinToken,
          false,
        );

        check(
          "an unknown co-teach token previews as nothing",
          await asStudent.courses.previewCoTeach({ token: "not-a-real-co-teach-token" }),
          null,
        );

        // ---- Refused while the account is a student ----
        const asStudentPreview = await asStudent.courses.previewCoTeach({ token: coTeachToken });
        check("a student is told they are not eligible", asStudentPreview?.eligible, false);
        check(
          "...and the preview still names the cohort",
          asStudentPreview?.name,
          "Verify Co-teaching",
        );

        const studentRefusal = await refusalMessage(() =>
          asStudent.courses.acceptCoTeach({ token: coTeachToken }),
        );
        check(
          "a student cannot take up a co-teach link",
          studentRefusal.includes("instructor invitation"),
          true,
        );
        check(
          "...and no instructor row was written",
          await tx.courseInstructor.count({
            where: { courseId: coTaught.course.id, userId: studentId },
          }),
          0,
        );

        // ---- Made staff, and now admitted ----
        //
        // The promotion an admin performs, done directly here because `staff.setAdmin` and the
        // invitation flow are `verify:staff`'s subject rather than this script's.
        await tx.profile.update({ where: { id: studentId }, data: { role: "INSTRUCTOR" } });
        const asNewInstructor = createCaller({ db: tx, user: { id: studentId } } as never);

        // Before redeeming, so it is genuinely somebody outside the course. Holding the role says
        // nothing about which cohorts, which is the distinction every teach gate rests on.
        check(
          "an instructor who does not teach it cannot replace its co-teach link",
          await refusal(() =>
            asNewInstructor.courses.regenerateCoTeachToken({ courseId: coTaught.course.id }),
          ),
          "FORBIDDEN",
        );
        check(
          "...and cannot read its settings either",
          await refusal(() => asNewInstructor.courses.settings({ courseId: coTaught.course.id })),
          "FORBIDDEN",
        );

        const eligiblePreview = await asNewInstructor.courses.previewCoTeach({
          token: coTeachToken,
        });
        check("an instructor is eligible", eligiblePreview?.eligible, true);
        check("...and does not teach it yet", eligiblePreview?.alreadyTeaches, false);

        check(
          "redeeming adds them",
          (await asNewInstructor.courses.acceptCoTeach({ token: coTeachToken })).added,
          true,
        );

        /*
        The check the whole feature is for. A `CourseInstructor` row that exists but does not
        actually let somebody work in the cohort would look completely correct in the database —
        every authoring procedure gates on this table, so the proof is calling one.
      */
        const theirSettings = await asNewInstructor.courses.settings({
          courseId: coTaught.course.id,
        });
        check(
          "...and they can now read the cohort they teach",
          theirSettings.course.id,
          coTaught.course.id,
        );
        check("...and it lists both instructors", theirSettings.course.instructors.length, 2);
        check(
          "...with the creator marked as such",
          theirSettings.course.instructors.filter((row) => row.isPrimary).length,
          1,
        );

        /*
        Idempotent, the same way `enrollments.join` is: `@@unique([courseId, userId])` means a
        bookmarked link is not a case to handle. The row count is the half that matters — `added:
        false` alone would pass while a second row was written by something else.
      */
        check(
          "redeeming twice adds nothing",
          (await asNewInstructor.courses.acceptCoTeach({ token: coTeachToken })).added,
          false,
        );
        check(
          "...and there is still one row for them",
          await tx.courseInstructor.count({
            where: { courseId: coTaught.course.id, userId: studentId },
          }),
          1,
        );

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
        check(
          "an archived cohort takes no new instructors",
          await refusal(() =>
            asNewInstructor.courses.acceptCoTeach({ token: archivedCoTeachToken }),
          ),
          "PRECONDITION_FAILED",
        );

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
        check(
          "somebody enrolled as a student cannot also teach the cohort",
          await refusal(() =>
            asNewInstructor.courses.acceptCoTeach({ token: bothTokens.coTeachToken }),
          ),
          "PRECONDITION_FAILED",
        );

        // ---- Replacing the link ----
        const rotatedCoTeach = await asInstructor.courses.regenerateCoTeachToken({
          courseId: coTaught.course.id,
        });
        check(
          "replacing the co-teach link changes it",
          rotatedCoTeach.coTeachToken !== coTeachToken,
          true,
        );
        check(
          "...and the old one stops working",
          await refusal(() => asNewInstructor.courses.acceptCoTeach({ token: coTeachToken })),
          "NOT_FOUND",
        );
        check(
          "...while instructors already on the course keep it",
          (await asNewInstructor.courses.settings({ courseId: coTaught.course.id })).course
            .instructors.length,
          2,
        );

        /*
        ---- Who owns the cohort ------------------------------------------------

        Two instructors on one course, which is what makes any of this checkable: the creator
        owns it and the one who redeemed the link does not, and every check here is a pair —
        the owner is allowed and the co-teacher is refused at the same call. A single-sided
        check would pass against a guard that refused everybody.

        The rule this exists for is the second one. Before it, anybody who taught a course could
        remove the person who set it up, which is the one permission in the application that
        nothing guarded.
      */

        /*
        The owner is demoted to INSTRUCTOR for this group, and put back at the end of it.

        Not a detail. `assertOwnsCourse` lets an admin through, and the seeded cohort's creator
        is the deployment's admin — so run as it stands, every check below saying "the owner
        may" would be passing on the admin bypass while claiming to measure ownership, and
        would keep passing if ownership were removed entirely. The first version of this group
        did exactly that, and the check that caught it is the one at the end that expects the
        bypass on purpose.
      */
        const ownerRole = (await tx.profile.findUnique({
          where: { id: instructor.userId },
          select: { role: true },
        }))!.role;
        await tx.profile.update({
          where: { id: instructor.userId },
          data: { role: "INSTRUCTOR" },
        });

        const ownerView = await asInstructor.courses.settings({ courseId: coTaught.course.id });
        check("the creator owns the cohort", ownerView.ownerId, instructor.userId);
        check("...and is told they may act as owner", ownerView.callerActsAsOwner, true);

        const coTeacherView = await asNewInstructor.courses.settings({
          courseId: coTaught.course.id,
        });
        check(
          "...while the co-teacher sees the same owner",
          coTeacherView.ownerId,
          instructor.userId,
        );
        check("...and is told they may not", coTeacherView.callerActsAsOwner, false);

        // Archiving is the one action a single instructor takes that changes what every student
        // in the cohort sees, which is why it is owner-gated rather than teach-gated.
        check(
          "a co-teacher cannot archive the cohort",
          await refusal(() =>
            asNewInstructor.courses.setArchived({ courseId: coTaught.course.id, archived: true }),
          ),
          "FORBIDDEN",
        );
        check(
          "...and the refusal names who can",
          (
            await refusalMessage(() =>
              asNewInstructor.courses.setArchived({ courseId: coTaught.course.id, archived: true }),
            )
          ).includes("because they own it"),
          true,
        );
        check(
          "...while the owner may",
          (await asInstructor.courses.setArchived({ courseId: coTaught.course.id, archived: true }))
            .archivedAt !== null,
          true,
        );
        // Reopening is the same gate, because it is the same mutation with a boolean. A
        // co-teacher can read an archived cohort in full and cannot bring it back.
        check(
          "...and a co-teacher cannot reopen it either",
          await refusal(() =>
            asNewInstructor.courses.setArchived({ courseId: coTaught.course.id, archived: false }),
          ),
          "FORBIDDEN",
        );
        await asInstructor.courses.setArchived({ courseId: coTaught.course.id, archived: false });

        check(
          "a co-teacher cannot remove the owner",
          await refusal(() =>
            asNewInstructor.courses.removeInstructor({
              courseId: coTaught.course.id,
              userId: instructor.userId,
            }),
          ),
          "FORBIDDEN",
        );
        check(
          "...and nothing was removed",
          await tx.courseInstructor.count({ where: { courseId: coTaught.course.id } }),
          2,
        );

        check(
          "a co-teacher cannot hand the cohort to themselves",
          await refusal(() =>
            asNewInstructor.courses.transferOwnership({
              courseId: coTaught.course.id,
              userId: studentId,
            }),
          ),
          "FORBIDDEN",
        );

        /*
        Somebody chosen by the property this check needs — holding no instructor row on this
        course — rather than by a proxy for it like "a profile that is not the one I promoted".
        A fixture picked by a proxy eventually picks the wrong one, and it fails silently in the
        direction that matters, which two scripts here have already demonstrated.
      */
        const notAnInstructorHere = await tx.profile.findFirst({
          where: { instructorOf: { none: { courseId: coTaught.course.id } } },
          select: { id: true },
        });
        check(
          "the owner cannot hand it to somebody who does not teach it",
          notAnInstructorHere
            ? await refusal(() =>
                asInstructor.courses.transferOwnership({
                  courseId: coTaught.course.id,
                  userId: notAnInstructorHere.id,
                }),
              )
            : "no outsider to try it with",
          "NOT_FOUND",
        );
        check(
          "...nor to whoever already owns it",
          await refusal(() =>
            asInstructor.courses.transferOwnership({
              courseId: coTaught.course.id,
              userId: instructor.userId,
            }),
          ),
          "PRECONDITION_FAILED",
        );

        /*
        The transfer itself, and the four facts it has to leave behind. `isPrimary` is checked
        directly against the table rather than only through `settings`, because the failure this
        is guarding against is two rows holding it — which reads as entirely normal through
        every procedure, since each takes the first row it finds.
      */
        check(
          "the owner can hand the cohort on",
          (
            await asInstructor.courses.transferOwnership({
              courseId: coTaught.course.id,
              userId: studentId,
            })
          ).ownerId,
          studentId,
        );
        check(
          "...and exactly one row is primary afterwards",
          await tx.courseInstructor.count({
            where: { courseId: coTaught.course.id, isPrimary: true },
          }),
          1,
        );
        check(
          "...which is the new owner's",
          (await asNewInstructor.courses.settings({ courseId: coTaught.course.id })).ownerId,
          studentId,
        );
        check(
          "...the new owner can now archive it",
          (
            await asNewInstructor.courses.setArchived({
              courseId: coTaught.course.id,
              archived: true,
            })
          ).archivedAt !== null,
          true,
        );
        await asNewInstructor.courses.setArchived({
          courseId: coTaught.course.id,
          archived: false,
        });
        check(
          "...and the old owner cannot",
          await refusal(() =>
            asInstructor.courses.setArchived({ courseId: coTaught.course.id, archived: true }),
          ),
          "FORBIDDEN",
        );

        // Handed back, so the checks after this group see the cohort they were written against.
        // The assertion is that it moves in both directions rather than only away from whoever
        // created the course.
        check(
          "...and it can be handed back",
          (
            await asNewInstructor.courses.transferOwnership({
              courseId: coTaught.course.id,
              userId: instructor.userId,
            })
          ).ownerId,
          instructor.userId,
        );
        check(
          "...leaving one primary row again",
          await tx.courseInstructor.count({
            where: { courseId: coTaught.course.id, isPrimary: true },
          }),
          1,
        );

        /*
        The constraint itself, read from the catalog rather than provoked.

        Every check above passes against a course that happens to have one primary row. What
        makes two of them impossible is a partial unique index, which Prisma cannot express and
        which therefore exists only in a migration — so asking the database is how this notices
        a deployment where that migration has not been run.

        Read rather than tried. Writing a second primary row would prove the same thing and
        abort the transaction every other check here is running inside.
      */
        const primaryIndex = await tx.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'course_instructors_one_primary_per_course'
      `;
        check("one primary per course is a database constraint", primaryIndex.length, 1);
        check(
          "...unique, and only over the primary rows",
          /CREATE UNIQUE INDEX/.test(primaryIndex[0]?.indexdef ?? "") &&
            /WHERE is_primary/.test(primaryIndex[0]?.indexdef ?? ""),
          true,
        );

        /*
        ---- Ownership when no row holds it -------------------------------------

        `CourseInstructor` cascades on the profile, so deleting an owner's account takes the
        `isPrimary` row with it and leaves a course with instructors and nobody who can archive
        it. Nothing in the application deletes a profile — that is a database edit somebody
        makes by hand — which is exactly why the fallback has to hold with nobody there to
        invoke it, and why it is checked by clearing the column directly rather than through a
        procedure. The longest-serving instructor left inherits.
      */
        const derived = await asInstructor.courses.create({
          name: "Verify Derived Ownership",
          cohortTerm: "Cohort Verify G",
        });
        const derivedToken = (await tx.course.findUnique({
          where: { id: derived.course.id },
          select: { coTeachToken: true },
        }))!.coTeachToken;
        await asNewInstructor.courses.acceptCoTeach({ token: derivedToken });
        await tx.courseInstructor.updateMany({
          where: { courseId: derived.course.id },
          data: { isPrimary: false },
        });
        /*
        Backdated so that "longest-serving" is a real ordering here.

        Both rows were written inside this transaction, and Postgres resolves `now()` to the
        transaction's start time — so they share a `createdAt` to the microsecond and the
        fallback would be decided by its tie-break rather than by the rule it claims to be
        about. A day apart is what the difference looks like in a cohort somebody is running.
      */
        await tx.courseInstructor.updateMany({
          where: { courseId: derived.course.id, userId: instructor.userId },
          data: { createdAt: new Date(Date.now() - 86_400_000) },
        });
        check(
          "a course with no primary row still has an owner",
          (await asInstructor.courses.settings({ courseId: derived.course.id })).ownerId,
          instructor.userId,
        );
        check(
          "...and it is the longest-serving instructor, who can still archive it",
          (
            await asInstructor.courses.setArchived({
              courseId: derived.course.id,
              archived: true,
            })
          ).archivedAt !== null,
          true,
        );
        check(
          "...while the one who joined later still cannot",
          await refusal(() =>
            asNewInstructor.courses.setArchived({ courseId: derived.course.id, archived: false }),
          ),
          "FORBIDDEN",
        );
        await asInstructor.courses.setArchived({ courseId: derived.course.id, archived: false });

        /*
        An owner who leaves without handing the cohort on gives it to the longest-serving
        instructor left, by the same rule. Said back by the procedure rather than left to be
        noticed, because it is the right default and not one anybody would guess.
      */
        const leaving = await asInstructor.courses.removeInstructor({
          courseId: derived.course.id,
          userId: instructor.userId,
        });
        check("an owner who leaves says who inherits", leaving.newOwnerName !== null, true);
        check(
          "...and that is who owns it now",
          (await asNewInstructor.courses.settings({ courseId: derived.course.id })).ownerId,
          studentId,
        );
        check(
          "...who can now archive it",
          (
            await asNewInstructor.courses.setArchived({
              courseId: derived.course.id,
              archived: true,
            })
          ).archivedAt !== null,
          true,
        );

        /*
        ---- Deleting a cohort --------------------------------------------------

        The one irreversible operation on a whole term, so the checks that earn their place are
        the refusals — and each of them asserts the course is **still there** afterwards, which
        is the half that matters. A refusal that returned the right code while the rows went
        anyway would look correct in every log this script produces.

        Archived first, because archiving is reversible and this is not: making it the only path
        puts a survivable step in front of a permanent one.
      */
        const doomed = await asInstructor.courses.create({
          name: "Verify Deletion",
          cohortTerm: "Cohort Verify H",
        });
        // Asked for rather than assumed. The confirmation is the cohort's own short name, and
        // writing out what the derivation happens to produce today is how a check comes to be
        // testing its own copy of a rule instead of the one the application uses.
        const doomedSlug = suggestCohortSlug({
          courseName: "Verify Deletion",
          cohortTerm: "Cohort Verify H",
        });
        const doomedModule = await asInstructor.courseUnits.create({
          category: "MODULE",
          courseId: doomed.course.id,
          name: "Mod 1",
        });
        /*
        Somebody to be counted, written directly rather than joined through the link — the one
        student account this script has was promoted to INSTRUCTOR above, and it is about to
        redeem the co-teaching link on this same course, which being enrolled here would refuse.
        A different student, and the count check is skipped rather than faked if there is none.
      */
        const bystander = await tx.profile.findFirst({
          where: { role: "STUDENT", id: { not: studentId } },
          select: { id: true },
        });
        if (bystander) {
          await tx.enrollment.create({
            data: { courseId: doomed.course.id, studentId: bystander.id, status: "ACTIVE" },
          });
        }
        // Before archiving, because an archived cohort takes no new instructors.
        const doomedToken = (await tx.course.findUnique({
          where: { id: doomed.course.id },
          select: { coTeachToken: true },
        }))!.coTeachToken;
        await asNewInstructor.courses.acceptCoTeach({ token: doomedToken });

        check(
          "a cohort that is still running cannot be deleted",
          await refusal(() =>
            asInstructor.courses.remove({
              courseId: doomed.course.id,
              confirmCohortSlug: doomedSlug,
            }),
          ),
          "PRECONDITION_FAILED",
        );
        check(
          "...and its impact cannot even be read",
          await refusal(() => asInstructor.courses.removalImpact({ courseId: doomed.course.id })),
          "PRECONDITION_FAILED",
        );

        await asInstructor.courses.setArchived({ courseId: doomed.course.id, archived: true });

        check(
          "a co-teacher cannot delete an archived cohort",
          await refusal(() =>
            asNewInstructor.courses.remove({
              courseId: doomed.course.id,
              confirmCohortSlug: doomedSlug,
            }),
          ),
          "FORBIDDEN",
        );
        check(
          "...nor read what deleting it would destroy",
          await refusal(() =>
            asNewInstructor.courses.removalImpact({ courseId: doomed.course.id }),
          ),
          "FORBIDDEN",
        );

        /*
        The counts, checked against rows this block put there. The impact read is what the
        confirmation screen states as fact, so it being right is the difference between a
        sentence somebody can weigh and a number they cannot check.
      */
        const impact = await asInstructor.courses.removalImpact({ courseId: doomed.course.id });
        check(
          "the impact counts the cohort's students",
          bystander ? impact.enrollments : "no spare student to enrol",
          bystander ? 1 : "no spare student to enrol",
        );
        check("...its course units", impact.courseUnits, 1);
        check("...its instructors", impact.instructors, 2);
        check(
          "...and asks for the short name rather than the course name",
          impact.cohortSlug,
          doomedSlug,
        );

        check(
          "the wrong confirmation is refused",
          await refusal(() =>
            asInstructor.courses.remove({
              courseId: doomed.course.id,
              confirmCohortSlug: "Verify Deletion",
            }),
          ),
          "BAD_REQUEST",
        );
        check(
          "...and the cohort is still there",
          await tx.course.count({ where: { id: doomed.course.id } }),
          1,
        );

        const deletedCourse = await asInstructor.courses.remove({
          courseId: doomed.course.id,
          confirmCohortSlug: doomedSlug,
        });
        check("the owner can delete an archived cohort", deletedCourse.name, "Verify Deletion");
        check("...and it is gone", await tx.course.count({ where: { id: doomed.course.id } }), 0);
        /*
        The cascade, asserted rather than assumed. Every one of these is a separate foreign key
        with its own `onDelete`, and the one that is wrong is the one that leaves rows pointing
        at a course that no longer exists.
      */
        check(
          "...taking its modules with it",
          await tx.courseUnit.count({ where: { id: doomedModule.id } }),
          0,
        );
        check(
          "...its enrollments",
          await tx.enrollment.count({ where: { courseId: doomed.course.id } }),
          0,
        );
        check(
          "...and its instructor rows",
          await tx.courseInstructor.count({ where: { courseId: doomed.course.id } }),
          0,
        );
        check(
          "...and it leaves the course list",
          (await asInstructor.courses.listMine()).some((row) => row.id === doomed.course.id),
          false,
        );
        check(
          "...while a course deleted twice is simply not found",
          await refusal(() =>
            asInstructor.courses.remove({
              courseId: doomed.course.id,
              confirmCohortSlug: doomedSlug,
            }),
          ),
          "NOT_FOUND",
        );

        /*
        ---- An admin acts as owner on every course -----------------------------

        A decision rather than a consequence of a guard written for something else. An admin is
        the recovery path for an owner who has left the program without handing the cohort on,
        and without one every rule above is a way for a course to end up with nobody who can
        administer it.

        Checked against `derived`, which this account now neither owns nor teaches — being an
        admin is the whole of what admits them. Which is also why the role goes back up here and
        not a line earlier: every check above had to run without it.
      */
        await tx.profile.update({ where: { id: instructor.userId }, data: { role: "ADMIN" } });

        check(
          "an admin does not teach this cohort",
          await tx.courseInstructor.count({
            where: { courseId: derived.course.id, userId: instructor.userId },
          }),
          0,
        );
        check(
          "...and reopens it anyway",
          (
            await asInstructor.courses.setArchived({
              courseId: derived.course.id,
              archived: false,
            })
          ).archivedAt,
          null,
        );

        // Added back as an ordinary co-teacher, so that removing the owner below is a course with
        // two instructors rather than the last-one refusal wearing an ownership costume.
        await asInstructor.courses.acceptCoTeach({ token: derivedToken });
        check(
          "...and can remove an owner who is not them",
          (
            await asInstructor.courses.removeInstructor({
              courseId: derived.course.id,
              userId: studentId,
            })
          ).instructorName.length > 0,
          true,
        );

        await tx.profile.update({ where: { id: instructor.userId }, data: { role: ownerRole } });

        // ---- Removing an instructor ----
        //
        // The last one is refused, the same shape and the same reasoning as revoking the last
        // admin: a course with no instructors cannot be authored in or graded by anybody, and the
        // only way back is a database edit. The count is asserted first, because a spare
        // instructor lying around would make that refusal pass while testing nothing.
        check(
          "removing one of two instructors is allowed",
          (
            await asInstructor.courses.removeInstructor({
              courseId: coTaught.course.id,
              userId: studentId,
            })
          ).courseId,
          coTaught.course.id,
        );
        check(
          "...and they lose access with it",
          await refusal(() => asNewInstructor.courses.settings({ courseId: coTaught.course.id })),
          "FORBIDDEN",
        );
        check(
          "...leaving exactly one instructor",
          await tx.courseInstructor.count({ where: { courseId: coTaught.course.id } }),
          1,
        );
        check(
          "...and the last one cannot be removed",
          await refusal(() =>
            asInstructor.courses.removeInstructor({
              courseId: coTaught.course.id,
              userId: instructor.userId,
            }),
          ),
          "PRECONDITION_FAILED",
        );

        check(
          "removing somebody who does not teach the course is refused",
          await refusal(() =>
            asInstructor.courses.removeInstructor({
              courseId: coTaught.course.id,
              userId: studentId,
            }),
          ),
          "NOT_FOUND",
        );

        throw new Error("ROLLBACK");
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  // ---- Nothing survived --------------------------------------------------
  //
  // Whatever the status was before, not "ACTIVE". The script removes and restores this student and
  // may have had to restore them to begin with, so the claim worth making is that the row came out
  // exactly as it went in — hardcoding a value would report a real removal as a failure.
  check(
    "the seeded student's enrollment is unchanged",
    (
      await db.enrollment.findUnique({
        where: { id: enrollment.id },
        select: { status: true },
      })
    )?.status,
    enrollment.status,
  );
  check(
    "no courses this script created survived the rollback",
    await db.course.count({ where: { cohortTerm: { startsWith: "Cohort Verify" } } }),
    0,
  );

  return finish();
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
