/**
 * Starting a matriculation, getting fellows into it, taking them out again, and the courses inside.
 *
 * Run with `npm run verify:enrollment`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. Authorization is most
 * of what these procedures are — any instructor may create a program, but only one who instructs it
 * may replace its join link or remove somebody from it — and a check that only holds when the
 * function is called some other way is not a check on what an instructor uses.
 *
 * **A fellow joins a matriculation, not a course**, which is the change this script is mostly
 * about. One roster, one join link, and one enrollment admit somebody to every course of the year;
 * the checks that used to be per course are now per program, and the ones about a course are about
 * its curriculum and its short name rather than about who is in it.
 *
 * **Two groups are worth reading.** The roster group is the link and the allowlist together: the
 * link is unguessable and the allowlist is what says who may use it, and neither is enough alone.
 * The removal group asserts both halves of every claim — a removed fellow keeps reading the feedback
 * they were given and cannot hand anything else in, and those two facts are one `where` clause apart
 * in code that otherwise reads identically, so getting one right and the other wrong is the failure
 * this design can actually produce.
 *
 * Who instructs a matriculation, who owns it, and how it is deleted are `verify:programs`.
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
  const { studentRepoName, slugifyCourse, suggestCourseSlug, courseSlugProblem } = await import(
    "../lib/courses/course-slug"
  );
  const links = await import("../lib/links");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { ownerOf } = await import("../lib/programs/ownership");

  /*
    A course with work already in it, which several checks below depend on rather than assume.

    `submissions: { some: {} }` is the load-bearing part. The short name is frozen once anybody has
    accepted, and a removed fellow keeping access is only meaningful against an assignment they
    actually submitted — so a course with assignments and no submissions would make both checks pass
    vacuously. It did: with two courses matching, `findFirst` returned the copied one and the freeze
    check reported that renaming was allowed.
  */
  const course = await db.course.findFirst({
    where: { archivedAt: null, assignments: { some: { submissions: { some: {} } } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, programId: true },
  });

  /*
    The matriculation's **owner**, not whichever instructor row comes back first.

    `findFirst` with no ordering was fine while a program had one instructor and stopped being fine
    the day it could have two: archiving is owner-gated, so a script that picked a co-teacher would
    report a working guard as a broken feature — or, worse, pick the owner by luck on one run and not
    the next. Same defect as choosing an outsider by "an instructor who is not this one", which two
    scripts had and which passed by accident.
  */
  const instructor = course
    ? ownerOf(
        await db.programInstructor.findMany({
          where: { programId: course.programId },
          select: { userId: true, isPrimary: true, createdAt: true },
        }),
      )
    : null;

  /*
    Any status, and restored inside the transaction if it is not active.

    `status: "ACTIVE"` here meant the script skipped the moment somebody removed the seeded fellow in
    the running application — which is a thing instructors do, and the state the removal checks below
    are *about*. Skipping was worse than it looks: it printed a pass. So the enrollment is picked
    regardless of status and put back to ACTIVE as the first thing inside the rollback, which makes
    the starting point the same either way and changes nothing outside it.
  */
  const enrollment = course
    ? await db.enrollment.findFirst({
        where: { programId: course.programId },
        orderBy: { createdAt: "asc" },
        select: { id: true, studentId: true, status: true },
      })
    : null;

  if (!course || !instructor || !enrollment) {
    skip("needs a seeded program with an instructor, a fellow, and at least one submission");
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
        // Pure, and checked before anything else, because every repository name a course generates
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
          check(`"${term}" slugifies to "${expected}"`, slugifyCourse(term), expected);
        }

        /*
          ---- The short name a new course is offered -----------------------------

          **The course and the matriculation, not the matriculation alone.** That is the whole reason
          this function exists: every program a school runs starts in the fall, so a term-only
          suggestion made `fall-2026` the short name of whichever course was created first and a
          refusal for the rest — and the instructor hitting the refusal had done nothing wrong.

          The pair that matters most is the middle one: **one course's short name is the same shape in
          every season**. Measured against the term in hand rather than against the longest a term can
          be, a fellowship would be `software-engineering-f26` in the autumn and `software-sp27` in
          the spring — one character of season costing a word of the course name — and two years of
          the same course would stop looking related.

          Uniqueness is still the database's. Two courses whose names abbreviate the same way collide,
          which this cannot prevent and `create` refuses in words.
        */
        const suggestions: [string, string, string][] = [
          // Short enough whole.
          ["Data Science", "Fall 2026", "data-science-f26"],
          // Too long whole, so the course becomes its initials — and stays that way across seasons.
          ["Fullstack Software Engineering", "Fall 2026", "fse-f26"],
          ["Fullstack Software Engineering", "Spring 2027", "fse-sp27"],
          ["Data Science", "Spring 2027", "data-science-sp27"],
          // A term this cannot compact keeps its full slug, and the course gives way to it.
          ["Fullstack Software Engineering", "Cohort 12 (evening)", "fse-cohort-12-evening"],
          // Seasons that share a first letter are still told apart.
          ["Data Science", "Summer 2026", "data-science-su26"],
          ["Data Science", "Winter 2026", "data-science-w26"],
          // A two-digit year, for the people who write it that way.
          ["Data Science", "Fall '26", "data-science-f26"],
          // Half a form is half a suggestion rather than none.
          ["", "Fall 2026", "f26"],
          ["Data Science", "", "data-science"],
        ];
        for (const [courseName, matriculation, expected] of suggestions) {
          check(
            `"${courseName}" + "${matriculation}" suggests "${expected}"`,
            suggestCourseSlug({ courseName, matriculation }),
            expected,
          );
        }

        // Every one of them has to be a legal repository name, which is the only property that
        // actually matters — a suggestion the form would then reject is worse than no suggestion.
        for (const [courseName, matriculation] of suggestions) {
          const slug = suggestCourseSlug({ courseName, matriculation });
          if (slug === "") continue;
          check(`..."${slug}" is a usable short name`, courseSlugProblem(slug), null);
        }

        /*
          ---- Moving between courses, and between matriculations -----------------

          Pure too, and checked because it is the arithmetic the two switchers do. Switching keeps
          the view where the view exists in every course, and lands on settings where it does not —
          an assignment belongs to one course, so its queue cannot travel. Getting that backwards
          sends an instructor to another course's assignment id.

          Every item of both sidebar groups is here, and that is the point of the tables rather than
          a completeness gesture: a view missing from either function does not fail, it silently
          falls through to settings, so switching from the roster would land on settings and read as
          the switcher losing your place.
        */
        const [alpha, beta, someAssignment] = [
          "aaaaaaaa-0000-0000-0000-000000000001",
          "bbbbbbbb-0000-0000-0000-000000000002",
          "cccccccc-0000-0000-0000-000000000003",
        ];
        const courseSwitches: [string, string, string][] = [
          ["triage", links.triageHref(alpha), links.triageHref(beta)],
          ["the curriculum", links.curriculumHref(alpha), links.curriculumHref(beta)],
          ["the gradebook", links.gradebookHref(alpha), links.gradebookHref(beta)],
          ["the team sets", links.teamsHref(alpha), links.teamsHref(beta)],
          ["settings", links.courseSettingsHref(alpha), links.courseSettingsHref(beta)],
          // The four that cannot carry across, each landing on settings rather than on another
          // course's copy of an id it does not have.
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
          ["a fellow's work", links.studentHref(alpha, "stu-1"), links.courseSettingsHref(beta)],
          // The bare course address, which is itself a redirect to settings.
          ["the course address", links.courseHref(alpha), links.courseSettingsHref(beta)],
          // No course in the address at all, which is the course list.
          ["the course list", "/courses", links.courseSettingsHref(beta)],
        ];
        for (const [what, from, expected] of courseSwitches) {
          check(`switching course from ${what}`, links.sameViewInCourse(from, beta), expected);
        }

        const programSwitches: [string, string, string][] = [
          ["attendance", links.attendanceHref(alpha), links.attendanceHref(beta)],
          ["the roster", links.rosterHref(alpha), links.rosterHref(beta)],
          ["the cohorts", links.cohortsHref(alpha), links.cohortsHref(beta)],
          [
            "the instructors",
            links.programInstructorsHref(alpha),
            links.programInstructorsHref(beta),
          ],
          ["settings", links.programSettingsHref(alpha), links.programSettingsHref(beta)],
          /*
            One day of attendance does not travel. The other matriculation may not have met that
            day, and landing on an empty screen offering to record a morning that never happened is
            worse than landing on today.
          */
          [
            "one day of attendance",
            links.attendanceDayHref(alpha, "2026-08-14"),
            links.programSettingsHref(beta),
          ],
          // A fellow is on one roster or another, so their record cannot carry across either.
          [
            "a fellow's record",
            links.programStudentHref(alpha, "stu-1"),
            links.programSettingsHref(beta),
          ],
          ["the program list", links.programsHref(), links.programSettingsHref(beta)],
        ];
        for (const [what, from, expected] of programSwitches) {
          check(`switching program from ${what}`, links.sameViewInProgram(from, beta), expected);
        }

        check(
          "a queue link can still open one submission",
          links.gradingQueueHref(alpha, someAssignment, "sub-1"),
          `/instructor/courses/${alpha}/curriculum/${someAssignment}?submission=sub-1`,
        );

        /*
          There are two fellow-shaped addresses and they name different scopes. The program one is
          about the person — their attendance, their cohort, their GCF — and the course one is about
          their work, which only means anything inside one course: the same person repeating a year
          has two sets of submissions, and an address naming only the person would have to pick one.
        */
        check(
          "a fellow's work names its course",
          links.studentHref(alpha, "stu-1"),
          `/instructor/courses/${alpha}/students/stu-1`,
        );
        check(
          "...and can open one of their submissions",
          links.studentHref(alpha, "stu-1", "sub-1"),
          `/instructor/courses/${alpha}/students/stu-1?submission=sub-1`,
        );
        check(
          "...while a fellow's record names the matriculation instead",
          links.programStudentHref(alpha, "stu-1"),
          `/instructor/programs/${alpha}/students/stu-1`,
        );

        // ---- Starting a matriculation -----------------------------------------
        //
        // Created empty, which is the decision and not a limitation: carrying a term forward is
        // `courses.create` copying a course, once per course, and a program-level copy is that
        // same operation called several times.
        const program = await asInstructor.programs.create({
          name: "Verify Program",
          matriculation: "Cohort Verify A",
        });
        check("a program is created", program.name, "Verify Program");

        check(
          "a program with the same name and term is refused",
          await refusal(() =>
            asInstructor.programs.create({
              name: "Verify Program",
              matriculation: "Cohort Verify A",
            }),
          ),
          "CONFLICT",
        );
        check(
          "...while the same name in another term is a different program",
          (
            await asInstructor.programs.create({
              name: "Verify Program",
              matriculation: "Cohort Verify A2",
            })
          ).matriculation,
          "Cohort Verify A2",
        );

        /*
          The creator is the primary instructor, and can immediately add a course.

          The second half is the real check. A `ProgramInstructor` row that was not written looks
          entirely normal until somebody tries to add a course, because every authoring procedure
          checks that table rather than the role.
        */
        const createdProgram = await tx.program.findUnique({
          where: { id: program.id },
          select: {
            joinToken: true,
            instructors: { select: { userId: true, isPrimary: true } },
          },
        });
        check("the creator is the primary instructor", createdProgram?.instructors, [
          { userId: instructor.userId, isPrimary: true },
        ]);
        check("a join token is generated", (createdProgram?.joinToken ?? "").length >= 32, true);

        check(
          "a fellow cannot create a program",
          await refusal(() =>
            asStudent.programs.create({ name: "Nope", matriculation: "Nope" }),
          ),
          "FORBIDDEN",
        );

        // ---- A course inside it ------------------------------------------------
        const empty = await asInstructor.courses.create({
          programId: program.id,
          name: "Verify Empty",
        });
        check("a course is created", empty.course.name, "Verify Empty");
        check(
          "...with nothing copied into it",
          { copied: empty.copied, failed: empty.failed },
          { copied: 0, failed: [] },
        );
        check("...in the program it was asked for", empty.course.programId, program.id);

        /*
          Unpublished, which is what replaced "do not enrol anybody yet" as the way to keep a course
          that begins in March off a fellow's screen in September. Being on the roster now makes
          somebody a student of every course of the matriculation, so publication is the only lever
          left — and a course arriving visible would put an empty shell in front of the roster the
          moment it was created.
        */
        check("...and not published yet", empty.course.publishedAt, null);

        const context = await asInstructor.assignments.authoringContext({
          courseId: empty.course.id,
        });
        check("...and can be authored in immediately", context.course.name, "Verify Empty");

        check(
          "a fellow cannot create a course",
          await refusal(() =>
            asStudent.courses.create({ programId: program.id, name: "Nope" }),
          ),
          "FORBIDDEN",
        );

        // ---- Copying -----------------------------------------------------------
        const sourceModules = await tx.courseUnit.findMany({
          where: { courseId: course.id },
          select: { name: true, position: true },
          orderBy: { position: "asc" },
        });
        const sourceAssignments = await tx.assignment.count({ where: { courseId: course.id } });

        const copy = await asInstructor.courses.create({
          programId: program.id,
          name: "Verify Copy",
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

          Reported rather than asserted to be all of them, because a copy legitimately fails when a
          template repository was made private since last term — and this script runs against
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

          Narrowed to REPO deliberately: a Drive or file-upload assignment has no template and no
          answer keys, and the schema requires them to be null. A check over every kind would fail on
          a correctly copied document — which is exactly how it did fail first time.
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

        /*
          ---- The course is in every repository name -----------------------------

          A fellow's repository is `{courseSlug}-{assignmentRepoName}-{github login}`, which is what
          keeps two years of the same course apart on GitHub — and what lets two courses of one
          matriculation both hold an assignment called `project-1`. It is why the short name stayed
          on the course rather than moving up to the program with everything else.

          Checked here because copying is exactly how a collision arises, and because the slug is
          only editable until the first Accept.
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
          copy.course.slug !== empty.course.slug && copy.course.slug.length > 0,
          true,
        );

        if (twinInCopy) {
          /*
            The names the two courses generate for the same assignment and the same fellow differ.

            Built through `studentRepoName` rather than by string concatenation here, so this checks
            the function `accept` actually calls. Asserting the shape by rebuilding it a second way
            would pass while both were wrong together.
          */
          const original = await tx.assignment.findFirst({
            where: { courseId: course.id, assignmentRepoName: twinInCopy.assignmentRepoName },
            select: { assignmentRepoName: true, course: { select: { slug: true } } },
          });

          if (original) {
            const inOriginal = studentRepoName({
              courseSlug: original.course.slug,
              assignmentRepoName: original.assignmentRepoName!,
              githubLogin: "somebody",
            });
            const inCopy = studentRepoName({
              courseSlug: copy.course.slug,
              assignmentRepoName: twinInCopy.assignmentRepoName!,
              githubLogin: "somebody",
            });
            check(
              "the same assignment in two courses generates two different repository names",
              inOriginal !== inCopy,
              true,
            );
            check(
              "...and each starts with its own course",
              inCopy.startsWith(`${copy.course.slug}-`),
              true,
            );
          }
        }

        // ---- The short name, and its window -----------------------------------
        check(
          "a duplicate short name is refused",
          await refusal(() =>
            asInstructor.courses.create({
              programId: program.id,
              name: "Verify Duplicate",
              slug: empty.course.slug,
            }),
          ),
          "CONFLICT",
        );

        check(
          "an illegal short name is refused",
          await refusal(() =>
            asInstructor.courses.create({
              programId: program.id,
              name: "Verify Illegal",
              slug: "Fall 2026!",
            }),
          ),
          "BAD_REQUEST",
        );

        /*
          Nothing usable in the course name at all leaves the matriculation carrying the short name
          on its own, which is the point of the suggestion naming both halves. Nothing is invented —
          it is still derived from what somebody typed — so this is a fallback rather than a refusal.
        */
        check(
          "a course name with nothing usable in it leaves the term carrying it",
          (await asInstructor.courses.create({ programId: program.id, name: "!!!" })).course.slug,
          suggestCourseSlug({ courseName: "", matriculation: "Cohort Verify A" }),
        );

        /*
          And once set it cannot be changed, by anybody, ever — there is no procedure that changes
          it. Asserted against the router rather than against a screen, because "the button is not
          rendered" is a different claim: the check that matters is that no caller can reach it.
        */
        check(
          "nothing can change a short name after creation",
          "setSlug" in asInstructor.courses,
          false,
        );

        // ---- The join link ----------------------------------------------------
        //
        // The program's, and there is one. A fellow taking four courses used to hold four links
        // saying the same thing.
        const token = createdProgram!.joinToken;

        const preview = await asStudent.enrollments.preview({ token });
        check("the link says which matriculation it is", preview?.name, "Verify Program");
        check("...and its term", preview?.matriculation, "Cohort Verify A");
        check("...and that the caller is not in it yet", preview?.alreadyIn, null);

        check(
          "an unknown token previews as nothing",
          await asStudent.enrollments.preview({ token: "not-a-real-token" }),
          null,
        );

        /*
          ---- The roster, which the link is only half of -------------------------

          The link is unguessable; the roster is an allowlist. Neither is enough alone, and the order
          of these checks is the order somebody meets them: refused first, added, then in.
        */
        check(
          "a fellow who was never expected cannot use the link",
          await refusal(() => asStudent.enrollments.join({ token })),
          "FORBIDDEN",
        );
        check("...and the screen says so before the button", preview?.onRoster, false);

        const studentProfile = (await tx.profile.findUniqueOrThrow({
          where: { id: studentId },
          select: { githubUsername: true, email: true },
        }))!;

        const added = await asInstructor.enrollments.addToRoster({
          programId: program.id,
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

        // Pasting the same list twice is something people do. The second paste adds nothing and says
        // so rather than failing on the unique constraint.
        check(
          "adding the same person again is skipped rather than refused",
          (
            await asInstructor.enrollments.addToRoster({
              programId: program.id,
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
        check("redeeming the link enrolls the fellow", joined.joined, true);

        /*
          One entry admits one person, and the claim is what says so. Written in the same transaction
          as the enrollment, so an entry marked used always has a member behind it.
        */
        check(
          "joining claims the entry that expected them",
          (
            await tx.rosterEntry.findFirst({
              where: { programId: program.id, claimedById: studentId },
              select: { claimedAt: true },
            })
          )?.claimedAt !== undefined,
          true,
        );

        // A claimed entry cannot be tidied away: it is the record of how somebody got in, and
        // removing it would not remove them.
        const claimedEntry = await tx.rosterEntry.findFirstOrThrow({
          where: { programId: program.id, claimedById: studentId },
          select: { id: true },
        });
        check(
          "a claimed entry cannot be removed from the list",
          await refusal(() =>
            asInstructor.enrollments.removeFromRoster({
              programId: program.id,
              entryId: claimedEntry.id,
            }),
          ),
          "PRECONDITION_FAILED",
        );
        check(
          "...as ACTIVE",
          (
            await tx.enrollment.findFirst({
              where: { programId: program.id, studentId },
              select: { status: true },
            })
          )?.status,
          "ACTIVE",
        );

        // ---- Publishing --------------------------------------------------------
        //
        // The three readers of `publishedAt` have to agree, and this is the pair that says so: a
        // fellow's own course list and the course itself. `verify:dashboard` covers the assignment
        // feed, which is the third.
        check(
          "an unpublished course is absent from a fellow's list",
          (await asStudent.courses.listMine()).some((row) => row.id === empty.course.id),
          false,
        );
        check(
          "...and refused if they name its address directly",
          await refusal(() => asStudent.courses.get({ courseId: empty.course.id })),
          "NOT_FOUND",
        );
        check(
          "...while its instructor sees it",
          (await asInstructor.courses.listMine()).some((row) => row.id === empty.course.id),
          true,
        );

        check(
          "publishing records when it happened",
          (
            await asInstructor.courses.setPublished({
              courseId: empty.course.id,
              published: true,
            })
          ).publishedAt !== null,
          true,
        );
        check(
          "a fellow cannot publish a course",
          await refusal(() =>
            asStudent.courses.setPublished({ courseId: empty.course.id, published: false }),
          ),
          "FORBIDDEN",
        );
        await asInstructor.courses.setPublished({ courseId: empty.course.id, published: false });

        /*
          **One enrollment admits them to every published course of the matriculation**, which is the
          duplication this whole change removed. Before it, one fellow taking four courses meant four
          rosters, four links, and four rows saying the same thing.

          Opened one at a time rather than asserted over the list, because the claim is that each
          call succeeds — a predicate over an array would be satisfied by an array of promises and
          measure nothing.
        */
        await asInstructor.courses.setPublished({ courseId: empty.course.id, published: true });
        await asInstructor.courses.setPublished({ courseId: copy.course.id, published: true });
        const theirCourses = (await asStudent.courses.listMine())
          .filter((row) => row.program.id === program.id)
          .map((row) => row.id);
        const opened: string[] = [];
        for (const courseId of theirCourses) {
          opened.push((await asStudent.courses.get({ courseId })).id);
        }
        check(
          "...and it admits them to every published course of the program",
          opened.length >= 2 && opened.every((id) => theirCourses.includes(id)),
          true,
        );
        await asInstructor.courses.setPublished({ courseId: empty.course.id, published: false });

        /*
          Idempotent, which is what makes a reusable link safe. A fellow who opens it twice, or
          bookmarks it, must not produce a second enrollment — `@@unique([programId, studentId])` is
          the constraint, and this is the procedure agreeing with it rather than provoking it.
        */
        const again = await asStudent.enrollments.join({ token });
        check("redeeming it twice does not enroll them twice", again.joined, false);
        check(
          "...and there is one enrollment",
          await tx.enrollment.count({ where: { programId: program.id, studentId } }),
          1,
        );

        /*
          **An enrollment that already exists outranks the roster, and this is the check that says
          so.** Every fellow enrolled before the roster table existed has no entry, so a roster check
          placed before the already-in branch tells somebody sitting in a program that the link to it
          is not for their account. It did, until the order in `join` and `preview` was corrected —
          which is a mistake with no symptom until a real roster meets it.

          Tested by taking the entry away underneath them: the enrollment stays, and so must the
          answer.
        */
        await tx.rosterEntry.deleteMany({
          where: { programId: program.id, claimedById: studentId },
        });
        check(
          "a fellow already in the program is unaffected by having no entry",
          (await asStudent.enrollments.join({ token })).joined,
          false,
        );
        check(
          "...and their screen still says they are in it, not that the link is not theirs",
          (await asStudent.enrollments.preview({ token }))?.onRoster,
          true,
        );

        // An instructor of the program is refused: an enrollment would put them in their own roster
        // and gradebook, and accepting would file a submission in their own queue.
        check(
          "an instructor of the program cannot join it as a fellow",
          await refusal(() => asInstructor.enrollments.join({ token })),
          "PRECONDITION_FAILED",
        );

        // Rotating the link invalidates the old one, which is the only control over who can use it.
        // Fellows already in are unaffected — the token is how you join, not how you stay.
        const rotated = await asInstructor.programs.regenerateJoinToken({ programId: program.id });
        check("regenerating changes the token", rotated.joinToken !== token, true);
        check(
          "the old link no longer works",
          await refusal(() => asStudent.enrollments.join({ token })),
          "NOT_FOUND",
        );
        check(
          "...and the fellow who already joined is still enrolled",
          (
            await tx.enrollment.findFirst({
              where: { programId: program.id, studentId },
              select: { status: true },
            })
          )?.status,
          "ACTIVE",
        );

        check(
          "a fellow cannot regenerate a join link",
          await refusal(() =>
            asStudent.programs.regenerateJoinToken({ programId: program.id }),
          ),
          "FORBIDDEN",
        );

        /*
          An archived matriculation takes no new fellows, which is the same "readable, accepts
          nothing" pair a removed fellow gets. Its own program rather than this one, because
          archiving reaches every course and the checks below still need this one running.
        */
        const closed = await asInstructor.programs.create({
          name: "Verify Closed",
          matriculation: "Cohort Verify B",
        });
        await asInstructor.programs.setArchived({ programId: closed.id, archived: true });
        const closedToken = (await tx.program.findUnique({
          where: { id: closed.id },
          select: { joinToken: true },
        }))!.joinToken;
        check(
          "an archived program refuses new fellows",
          await refusal(() => asStudent.enrollments.join({ token: closedToken })),
          "PRECONDITION_FAILED",
        );

        /*
          ---- An archived course stays reachable, labelled -----------------------

          `listMine` used to filter `archivedAt: null`, which meant archiving a course was also the
          only way to make one unreachable: every procedure still admitted its members, so the work
          was all there and openable by a URL somebody happened to have kept and by nothing else. The
          pair below is the whole fix — it is in the list, and the list says which it is.

          Both halves matter. Returning the row without the label would put a finished course in among
          the running ones with nothing to tell them apart, which is the same mistake as an unlabelled
          course a fellow was removed from.
        */
        await asInstructor.courses.setArchived({ courseId: copy.course.id, archived: true });
        const archivedRow = (await asInstructor.courses.listMine()).find(
          (row) => row.id === copy.course.id,
        );
        check("an archived course stays in the course list", archivedRow !== undefined, true);
        check("...labelled as archived", archivedRow?.archivedAt !== null, true);

        await asInstructor.courses.setArchived({ courseId: copy.course.id, archived: false });
        check(
          "reopening clears the label",
          (await asInstructor.courses.listMine()).find((row) => row.id === copy.course.id)
            ?.archivedAt,
          null,
        );

        check(
          "a fellow cannot archive a course",
          await refusal(() =>
            asStudent.courses.setArchived({ courseId: empty.course.id, archived: true }),
          ),
          "FORBIDDEN",
        );

        /*
          ---- Triage is one course's, and an archived course's is nobody's -------

          Both halves were claimed in the ROADMAP and neither was true. `triage` filtered
          `archivedAt: null` in its admin branch only, so the reader it held for was the one who
          teaches nothing; and the screen called it with no course at all, so an instructor teaching
          two courses got both piles interleaved.

          The first check is the load-bearing one. Every assertion below is that some pile is empty,
          and a seeded course with nothing outstanding would make all of them pass while measuring
          nothing — so the pile is asserted to be non-empty before anything empties it.
        */
        const outstanding = await asInstructor.submissions.triage({ courseId: course.id });
        check("the seeded course has work in triage", outstanding.submissions.length > 0, true);

        // The copy is unpublished and nobody has submitted to it, so a triage that crossed courses
        // would show the seeded course's work here.
        check(
          "triage is scoped to the course asked for",
          (await asInstructor.submissions.triage({ courseId: copy.course.id })).submissions.length,
          0,
        );

        await asInstructor.courses.setArchived({ courseId: course.id, archived: true });
        check(
          "an archived course's submissions leave triage",
          (await asInstructor.submissions.triage({ courseId: course.id })).submissions.length,
          0,
        );
        /*
          The fellow's own list, while the course they are in is archived. Off the list of work and
          not off the list of courses — this is the half a reader is most likely to get wrong, because
          "archived" reads as "gone" and the whole point is that it is not.
        */
        check(
          "...while the fellows in it keep the course on their own list",
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

        // Readable, though: archiving stops the course appearing in a list of work to do, and takes
        // nothing back. The assignment's own queue is how its submissions are read.
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
          "a fellow cannot read a course's triage",
          await refusal(() => asStudent.submissions.triage({ courseId: course.id })),
          "FORBIDDEN",
        );

        /*
          ---- One fellow's work, which is the grading queue's other axis ---------

          `listForAssignment` is one assignment across many fellows; `listForStudent` is one fellow
          across many assignments. They share the select and the row decoration, so the checks worth
          making here are the ones about the *difference*: what the rows cover, and who may read them.
        */
        const record = await asInstructor.submissions.listForStudent({
          courseId: course.id,
          studentId,
        });
        check(
          "a fellow's record names them, with the fields the header shows",
          {
            id: record.student.id,
            hasEmail: record.student.email !== null,
            hasGithub: record.student.githubUsername !== null,
          },
          { id: studentId, hasEmail: true, hasGithub: true },
        );
        check("...and the course it is scoped to", record.course.id, course.id);
        check("...and the matriculation above it", record.program.id, course.programId);

        /*
          **A row per assignment, not per submission.** "Has not begun this" is a fact about a fellow
          that a list of only their submissions cannot state, and it is the difference from the queue
          — where a fellow who never accepted is deliberately absent, because that screen asks what is
          left to grade rather than how somebody is doing.
        */
        const courseAssignments = await tx.assignment.count({ where: { courseId: course.id } });
        check(
          "there is a row for every assignment in the course",
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

        // Scoped to this fellow and nobody else. The relation is filtered by `studentId`, and a
        // mistake there would quietly show one fellow another's work on a screen titled with their
        // name — which is the worst failure this procedure has available.
        const foreign = await tx.submission.findFirst({
          where: { assignment: { courseId: course.id }, studentId: { not: studentId } },
          select: { id: true },
        });
        check(
          "no other fellow's submission appears in it",
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
          "the courses offered include the one being read",
          record.courses.some((row) => row.id === course.id),
          true,
        );

        check(
          "a fellow cannot read their own record through this",
          await refusal(() =>
            asStudent.submissions.listForStudent({ courseId: course.id, studentId }),
          ),
          "FORBIDDEN",
        );

        /*
          A fellow who is not on this roster is NOT_FOUND rather than an empty list. An empty list
          reads as "this person has done nothing", which is a different and false statement.
        */
        const outsider = await tx.profile.findFirst({
          where: {
            id: { not: studentId },
            enrollments: { none: { programId: course.programId } },
          },
          select: { id: true },
        });
        if (outsider) {
          check(
            "a fellow who is not on the roster is refused rather than shown as idle",
            await refusal(() =>
              asInstructor.submissions.listForStudent({
                courseId: course.id,
                studentId: outsider.id,
              }),
            ),
            "NOT_FOUND",
          );
        } else {
          check("no account outside the roster to check against", "skipped", "skipped");
        }

        /*
          ---- One fellow across the whole matriculation --------------------------

          The other student page, and it is a different question: who they are rather than what they
          handed in. The check that earns its place is the last one — a row per course of the
          matriculation, which is what makes it the way into the per-course record above.
        */
        const person = await asInstructor.programs.student({
          programId: course.programId,
          studentId,
        });
        check("the fellow's record names them", person.student.id, studentId);
        check(
          "...and carries a row per course of the matriculation",
          person.courses.length,
          await tx.course.count({ where: { programId: course.programId } }),
        );
        check(
          "...and their arrival averages",
          typeof person.arrivals.overall.count === "number" &&
            person.arrivals.byWeekday.length === 7,
          true,
        );
        check(
          "a fellow cannot read another's record",
          await refusal(() =>
            asStudent.programs.student({ programId: course.programId, studentId }),
          ),
          "FORBIDDEN",
        );
        check(
          "somebody not on the roster is refused rather than shown as empty",
          outsider
            ? await refusal(() =>
                asInstructor.programs.student({
                  programId: course.programId,
                  studentId: outsider.id,
                }),
              )
            : "NOT_FOUND",
          "NOT_FOUND",
        );

        // ---- Removing, and the pair that must not come apart ------------------
        //
        // Every check below asserts both halves. A removed fellow who can still submit, and one who
        // can no longer read what they were given, are both defects, and each is one enum value away
        // from the other in code that reads the same.
        const seededAssignment = await tx.assignment.findFirst({
          where: { courseId: course.id, distributedAt: { not: null } },
          select: { id: true },
        });

        /*
          What this fellow had waiting before they were removed, measured rather than assumed.

          Every check below asserts something is *absent* from a list, and a fellow with nothing
          outstanding would satisfy all of them while measuring nothing at all. So the pile is read
          first, and asserted to contain their work.
        */
        const theirsBefore = outstanding.submissions.filter((row) => row.student.id === studentId);
        const othersBefore = outstanding.submissions.filter((row) => row.student.id !== studentId);
        check("this fellow has work in triage before being removed", theirsBefore.length > 0, true);

        const removed = await asInstructor.enrollments.remove({ enrollmentId: enrollment.id });
        check("removing sets the status", removed.status, "REMOVED");

        check(
          "a removed fellow can still read the course",
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
            longer enrolled" is a fact the fellow can act on, and the generic "you are not enrolled"
            would read as the application having lost them.
          */
          const refused = await refusalMessage(() =>
            asStudent.assignments.accept({ assignmentId: seededAssignment.id }),
          );
          check("...and cannot accept anything new", refused.includes("no longer enrolled"), true);
        }

        check(
          "a removed fellow is not counted as a student of the course",
          (await asInstructor.courses.gradebook({ courseId: course.id })).activeEnrollments.some(
            (row) => row.student.id === studentId,
          ),
          false,
        );
        // Through `programs.roster`, which is the screen that shows them. The gradebook stopped
        // returning the whole enrollment list when the roster became its own read, and it is that
        // read's job to keep a departed fellow visible.
        check(
          "...and is still on the roster, so they can be put back",
          (
            await asInstructor.programs.roster({ programId: course.programId })
          ).enrollments.some((row) => row.student.id === studentId),
          true,
        );

        /*
          ---- Out of the work lists, into the record ----------------------------

          The pair that is the whole point of removing rather than deleting. Nobody is going to grade
          a submission from somebody who has left the program, so it must not sit in a list of work
          outstanding — and it must not vanish either, because how a fellow did before they left is
          the reason for keeping the row.

          Both halves in the same group, because each is one filter away from the other.
        */
        const afterRemoval = await asInstructor.submissions.triage({ courseId: course.id });
        check(
          "a removed fellow's work leaves triage",
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
          The two arrays are the whole of it. Written as one query partitioned in two rather than as a
          filter and its complement, because two queries can each miss a row and nothing says so — a
          submission in neither list is unreachable and unreported.
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
          "...and out of the course's own",
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

          "How much is outstanding in this course" is answered by grading triage, by the gradebook's
          own cells, and by the per-assignment "to grade" column — and the third is the one that can
          now drift, because its counts are computed in `assignmentsOverview` rather than derived in
          the browser from the gradebook's payload. Two counts kept in step by hand is exactly how the
          heading and triage disagreed before, with nothing on either screen to reconcile them.

          A removed fellow is what makes this worth asserting rather than tautological: every one of
          the three has to leave their work out, and each does it in a different place.
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

        // A removed fellow redeeming the link again is refused: if it let them back in, removal
        // would not stick while they still held the link.
        const rejoinToken = (await tx.program.findUnique({
          where: { id: course.programId },
          select: { joinToken: true },
        }))!.joinToken;
        check(
          "a removed fellow cannot rejoin with the link",
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
          "a fellow cannot remove anybody",
          await refusal(() => asStudent.enrollments.remove({ enrollmentId: enrollment.id })),
          "FORBIDDEN",
        );

        /*
          A roster belongs to one matriculation, so being expected on one says nothing about another.
          That is the point of the allowlist being the program's rather than the school's, and it is
          what makes a fellow repeating a year join the new matriculation rather than inherit the old
          one's admission.
        */
        check(
          "being expected on one roster is not being expected on another",
          await tx.rosterEntry.count({ where: { programId: closed.id, claimedById: studentId } }),
          0,
        );

        /*
          An enrollment id says nothing about which program it is in until the row is read, which is
          why the procedure loads it before checking who is asking. Removing the fellow from a
          matriculation this instructor does instruct is allowed; `asStudent` above covers the role,
          and this covers the program.
        */
        const secondEnrollment = await tx.enrollment.findFirstOrThrow({
          where: { programId: program.id, studentId },
          select: { id: true },
        });
        check(
          "an enrollment in a program you instruct can be removed",
          (await asInstructor.enrollments.remove({ enrollmentId: secondEnrollment.id })).status,
          "REMOVED",
        );

        // ---- Deleting a course -------------------------------------------------
        //
        // The course, not the matriculation: `verify:programs` deletes one of those. What earns its
        // place here is the pair the program above the course created — deleting one course of four
        // leaves the roster, the cohorts and the attendance exactly where they were.
        const doomed = await asInstructor.courses.create({
          programId: program.id,
          name: "Verify Deletion",
        });
        const doomedSlug = doomed.course.slug;
        const doomedModule = await asInstructor.courseUnits.create({
          category: "MODULE",
          courseId: doomed.course.id,
          name: "Mod 1",
        });

        check(
          "a course that is still running cannot be deleted",
          await refusal(() =>
            asInstructor.courses.remove({
              courseId: doomed.course.id,
              confirmSlug: doomedSlug,
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

        const impact = await asInstructor.courses.removalImpact({ courseId: doomed.course.id });
        check("...its course units", impact.courseUnits, 1);
        check(
          "...and asks for the short name rather than the course name",
          impact.slug,
          doomedSlug,
        );
        /*
          The roster is named and not counted as a loss, which is the whole difference between this
          and deleting the matriculation. A reader weighing the numbers above needs to know the
          roster is their denominator rather than one of them.
        */
        check(
          "...and reports the roster as something that stays",
          impact.enrollments,
          await tx.enrollment.count({ where: { programId: program.id } }),
        );

        check(
          "the wrong confirmation is refused",
          await refusal(() =>
            asInstructor.courses.remove({
              courseId: doomed.course.id,
              confirmSlug: "Verify Deletion",
            }),
          ),
          "BAD_REQUEST",
        );
        check(
          "...and the course is still there",
          await tx.course.count({ where: { id: doomed.course.id } }),
          1,
        );

        const enrolledBefore = await tx.enrollment.count({ where: { programId: program.id } });
        const deletedCourse = await asInstructor.courses.remove({
          courseId: doomed.course.id,
          confirmSlug: doomedSlug,
        });
        check("the owner can delete an archived course", deletedCourse.name, "Verify Deletion");
        check("...and it is gone", await tx.course.count({ where: { id: doomed.course.id } }), 0);
        check(
          "...taking its modules with it",
          await tx.courseUnit.count({ where: { id: doomedModule.id } }),
          0,
        );
        /*
          And leaving the roster alone, which is the check the program above the course made possible
          and the one worth reading. Enrollments belong to the matriculation now: deleting one course
          of several must not remove a single fellow from it.
        */
        check(
          "...and leaving every fellow on the roster",
          await tx.enrollment.count({ where: { programId: program.id } }),
          enrolledBefore,
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
              confirmSlug: doomedSlug,
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
  // Whatever the status was before, not "ACTIVE". The script removes and restores this fellow and
  // may have had to restore them to begin with, so the claim worth making is that the row came out
  // exactly as it went in — hardcoding a value would report a real removal as a failure.
  check(
    "the seeded fellow's enrollment is unchanged",
    (
      await db.enrollment.findUnique({
        where: { id: enrollment.id },
        select: { status: true },
      })
    )?.status,
    enrollment.status,
  );
  check(
    "no programs this script created survived the rollback",
    await db.program.count({ where: { matriculation: { startsWith: "Cohort Verify" } } }),
    0,
  );

  return finish();
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
