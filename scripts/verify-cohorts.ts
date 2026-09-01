/**
 * Cohorts: making them, placing fellows in them, and what filtering to one does to every count.
 *
 * Run with `npm run verify:cohorts`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because authorization
 * is half of what these procedures are — a cohort id says nothing about which program it belongs to
 * until the row is read — and because the half that matters most is not the cohorts table at all.
 * It is the four screens: **the same cohort has to mean the same set of fellows to grading triage,
 * an assignment's queue, the gradebook, and the assignments list.** The day two of them disagree,
 * one screen says an instructor is caught up while another says there is work waiting, and nothing
 * on either reconciles them.
 *
 * **A cohort belongs to the program and the four screens belong to a course**, which is the new
 * thing to check rather than a restatement of the old: one placement now narrows every course of a
 * program, so the checks read the program's cohorts and then a course's piles.
 *
 * The strongest checks here are the ones comparing a filtered read against the unfiltered one: a
 * cohort's pile plus the rest of the roster's pile must be the whole pile, exactly. A filter that
 * quietly drops a submission is invisible in every other way — the screen simply looks emptier,
 * which is what being caught up also looks like.
 *
 * **A fellow is in at most one cohort**, held as `Enrollment.cohortId`, so the checks that used to
 * assert a many-to-many membership now assert the opposite: placing somebody in a second cohort
 * moves them out of the first. That is the partition, and it is true by construction.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { ALL_STUDENTS, UNASSIGNED } = await import("../lib/programs/cohorts");

  /*
    A program with **two fellows and at least one course**, chosen by those properties rather than by
    being the first one found. Everything worth checking here is a partition — one fellow in the
    cohort and one out of it is the smallest roster where filtered and unfiltered differ at all — so
    a program with one fellow would run every check below and pass whether the filter worked or not.
    The course is needed because the four screens the filter is really about are a course's.

    Same family as the mistake `verify:modules` and `verify:authoring` both made picking an outsider
    instructor: a script that selects its fixture by a proxy for the property it needs will
    eventually select the wrong one, and the failure is silent in the direction that matters.
    `some: {}` on two enrollments is not expressible, so the count is filtered after.
  */
  const candidates = await db.program.findMany({
    where: { archivedAt: null, instructors: { some: {} }, courses: { some: {} } },
    select: {
      id: true,
      instructors: { take: 1, select: { userId: true } },
      courses: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true } },
      // Any status. The two are made active inside the transaction below, so a roster whose second
      // fellow has been removed in the running application is still a usable fixture.
      enrollments: {
        orderBy: { createdAt: "asc" },
        take: 2,
        select: { id: true, studentId: true },
      },
    },
  });

  const program = candidates.find(
    (row) =>
      row.enrollments.length === 2 &&
      // Two distinct people. One profile enrolled twice cannot be partitioned — and the unique key
      // on `(programId, studentId)` makes that impossible anyway, which is worth not relying on.
      row.enrollments[0]!.studentId !== row.enrollments[1]!.studentId,
  );

  if (!program) {
    return skip("no seeded program with an instructor, a course, and two distinct fellows");
  }

  const instructor = program.instructors[0]!;
  const course = program.courses[0]!;
  const enrollments = program.enrollments;

  const [inside, outside] = enrollments as [
    (typeof enrollments)[number],
    (typeof enrollments)[number],
  ];
  const createCaller = createCallerFactory(appRouter);

  try {
    await db.$transaction(
      async (tx) => {
        const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
        const asStudent = createCaller({ db: tx, user: { id: inside.studentId } } as never);

        /*
          Both fellows active before anything is measured, inside the transaction that is thrown
          away. A roster in the running application will have removed somebody sooner or later, and
          without this the whole script would skip — which is how a check quietly stops existing.
          The removed-fellow group further down does its own remove and restore, so this is a
          starting state rather than an assumption about one.

          Their cohort is cleared in the same statement, so the counts below are this script's own
          arithmetic rather than a sum including whatever the roster was already divided into.
        */
        await tx.enrollment.updateMany({
          where: { id: { in: [inside.id, outside.id] } },
          data: { status: "ACTIVE", cohortId: null },
        });

        // --- making a cohort --------------------------------------------------
        const squad = await asInstructor.cohorts.create({
          programId: program.id,
          name: "Verify Squad A",
        });
        const other = await asInstructor.cohorts.create({
          programId: program.id,
          name: "Verify Squad B",
        });

        // Trimmed, because " Squad 1" and "Squad 1" are the same cohort to everyone but the
        // database, and a leading space is invisible in the picker it would appear twice in.
        check(
          "a name is trimmed",
          (
            await asInstructor.cohorts.create({
              programId: program.id,
              name: "  Verify Padded  ",
            })
          ).name,
          "Verify Padded",
        );

        check(
          "a blank name is refused",
          await refusal(() => asInstructor.cohorts.create({ programId: program.id, name: "   " })),
          "BAD_REQUEST",
        );

        check(
          "a duplicate name is refused in words",
          await refusal(() =>
            asInstructor.cohorts.create({ programId: program.id, name: "Verify Squad A" }),
          ),
          "CONFLICT",
        );

        check(
          "renaming changes the name",
          (await asInstructor.cohorts.rename({ cohortId: squad.id, name: "Verify Squad A2" })).name,
          "Verify Squad A2",
        );

        // --- who is in it -----------------------------------------------------
        await asInstructor.cohorts.setPlacements({
          programId: program.id,
          placements: [{ enrollmentId: inside.id, cohortId: squad.id }],
        });

        const listed = await asInstructor.cohorts.listForProgram({ programId: program.id });
        check(
          "the cohort reports its member count",
          listed.cohorts.find((row) => row.id === squad.id)?.memberCount,
          1,
        );

        /*
          The whole placement rather than a move, which is what makes it idempotent and impossible
          to leave half applied. Sending the same list twice must not change anything, and sending a
          different one must replace rather than add.
        */
        await asInstructor.cohorts.setPlacements({
          programId: program.id,
          placements: [{ enrollmentId: inside.id, cohortId: squad.id }],
        });
        check(
          "...and placing the same fellow again changes nothing",
          (await asInstructor.cohorts.listForProgram({ programId: program.id })).cohorts.find(
            (row) => row.id === squad.id,
          )?.memberCount,
          1,
        );

        await asInstructor.cohorts.setPlacements({
          programId: program.id,
          placements: [
            { enrollmentId: inside.id, cohortId: squad.id },
            { enrollmentId: outside.id, cohortId: squad.id },
          ],
        });
        check(
          "...and a longer list places both",
          (await asInstructor.cohorts.listForProgram({ programId: program.id })).cohorts.find(
            (row) => row.id === squad.id,
          )?.memberCount,
          2,
        );

        /*
          The partition, stated as the thing it replaced. A grading group was a many-to-many, so a
          fellow could be in two at once and `unassignedCount` had to be its own query. A cohort is
          a column: placing somebody in a second one moves them, and "which cohort is this fellow
          in" has exactly one answer.
        */
        await asInstructor.cohorts.setPlacements({
          programId: program.id,
          placements: [{ enrollmentId: outside.id, cohortId: other.id }],
        });
        const placements = await asInstructor.cohorts.membershipsForProgram({
          programId: program.id,
        });
        check(
          "placing a fellow in a second cohort moves them out of the first",
          placements.find((row) => row.enrollmentId === outside.id)?.cohortId,
          other.id,
        );
        check(
          "...and the first cohort's count falls to match",
          (await asInstructor.cohorts.listForProgram({ programId: program.id })).cohorts.find(
            (row) => row.id === squad.id,
          )?.memberCount,
          1,
        );

        // Back to one placed fellow and one in nothing, which is what every filtering check below
        // is measured against.
        await asInstructor.cohorts.setPlacements({
          programId: program.id,
          placements: [{ enrollmentId: outside.id, cohortId: null }],
        });

        // --- what the filter does to every screen -----------------------------
        //
        // The heart of it. One cohort, one fellow in it, and four reads of one course that have to
        // agree about which fellows they are counting.

        const allTriage = await asInstructor.submissions.triage({ courseId: course.id });
        const cohortTriage = await asInstructor.submissions.triage({
          courseId: course.id,
          cohort: squad.id,
        });

        check(
          "triage filtered to a cohort holds only that cohort's fellows",
          cohortTriage.submissions.every((row) => row.student.id === inside.studentId),
          true,
        );
        check(
          "...and is a subset of the unfiltered pile",
          cohortTriage.submissions.every((row) =>
            allTriage.submissions.some((all) => all.id === row.id),
          ),
          true,
        );
        /*
          The check a quiet filter would fail. A cohort and its complement have to add up to the
          whole pile — if either drops a submission, this is the only place it shows, because a
          shorter list on a screen looks exactly like having less work to do.
        */
        check(
          "...and the cohort plus everyone else is the whole pile",
          cohortTriage.submissions.length +
            allTriage.submissions.filter((row) => row.student.id !== inside.studentId).length,
          allTriage.submissions.length,
        );
        const allBook = await asInstructor.courses.gradebook({ courseId: course.id });
        const cohortBook = await asInstructor.courses.gradebook({
          courseId: course.id,
          cohort: squad.id,
        });
        check(
          "the gradebook lists only the cohort's fellows",
          cohortBook.activeEnrollments.map((row) => row.student.id),
          [inside.studentId],
        );
        /*
          Cells as well as rows. `courseCells` reads every submission in the course, so a grid that
          narrowed its rows and not its cells would look right — the grid draws by row — and be
          wrong in every figure computed from the array.
        */
        check(
          "...and only their cells",
          cohortBook.cells.every((cell) => cell.studentId === inside.studentId),
          true,
        );
        check(
          "...where unfiltered holds at least as many",
          allBook.cells.length >= cohortBook.cells.length,
          true,
        );

        const allList = await asInstructor.courses.assignmentsOverview({ courseId: course.id });
        const cohortList = await asInstructor.courses.assignmentsOverview({
          courseId: course.id,
          cohort: squad.id,
        });
        check(
          "the assignments list counts the same set of assignments either way",
          cohortList.assignments.length,
          allList.assignments.length,
        );
        check(
          "...and never counts more work than the whole roster has",
          cohortList.assignments.every((assignment) => {
            const unfiltered = allList.assignments.find((row) => row.id === assignment.id);
            return (
              unfiltered != null &&
              assignment.counts.outstanding <= unfiltered.counts.outstanding &&
              assignment.counts.graded <= unfiltered.counts.graded &&
              assignment.counts.submitted <= unfiltered.counts.submitted
            );
          }),
          true,
        );

        /*
          The queue, and the one thing a filter must not do to it: a link naming a submission
          outside the selected cohort has to keep working. Falling through to the first row of the
          list would show a different fellow's report under a URL that named one, which is worse
          than an empty pane because nothing about it looks wrong.
        */
        const assignment = allList.assignments[0];
        if (assignment) {
          const queue = await asInstructor.submissions.listForAssignment({
            assignmentId: assignment.id,
            cohort: squad.id,
          });
          check(
            "the queue lists only the cohort's fellows",
            queue.submissions.every((row) => row.student.id === inside.studentId),
            true,
          );
          check(
            "...and keeps an out-of-cohort submission openable, saying why",
            queue.asideSubmissions
              .filter((row) => row.student.id === outside.studentId)
              .every((row) => row.asideReason === "outside_cohort"),
            true,
          );

          const unfilteredQueue = await asInstructor.submissions.listForAssignment({
            assignmentId: assignment.id,
          });
          check(
            "...and the two lists together are still every submission",
            queue.submissions.length + queue.asideSubmissions.length,
            unfilteredQueue.submissions.length + unfilteredQueue.asideSubmissions.length,
          );
        } else {
          console.log("skip  the queue under a cohort filter — the course has no assignments");
        }

        // --- no cohort, and the fellow nobody placed ---------------------------
        const unassigned = await asInstructor.submissions.triage({
          courseId: course.id,
          cohort: UNASSIGNED,
        });
        check(
          "No cohort excludes anybody who is in one",
          unassigned.submissions.every((row) => row.student.id !== inside.studentId),
          true,
        );
        check(
          "...and the counted total agrees with the picker's own figure",
          (await asInstructor.cohorts.listForProgram({ programId: program.id })).unassignedCount,
          await tx.enrollment.count({
            where: { programId: program.id, status: "ACTIVE", cohortId: null },
          }),
        );

        check(
          "no filter and the All Fellows value are the same read",
          (await asInstructor.submissions.triage({ courseId: course.id, cohort: ALL_STUDENTS }))
            .submissions.length,
          allTriage.submissions.length,
        );

        /*
          Fail closed rather than fail open. A cohort id from another program cannot match any
          enrollment on this roster, so the filter returns nothing — an empty screen rather than
          another term's fellows, which is the direction that costs a query rather than a
          leak.
        */
        const elsewhere = await tx.program.findFirst({
          where: { id: { not: program.id } },
          select: { id: true },
        });
        if (elsewhere) {
          const foreign = await tx.cohort.create({
            data: { programId: elsewhere.id, name: "Verify Foreign" },
            select: { id: true },
          });
          check(
            "a cohort from another program matches nothing rather than everything",
            (await asInstructor.submissions.triage({ courseId: course.id, cohort: foreign.id }))
              .submissions.length,
            0,
          );
          check(
            "...and cannot be remembered as this program's filter",
            await refusal(() =>
              asInstructor.cohorts.setCohort({ programId: program.id, cohortId: foreign.id }),
            ),
            "NOT_FOUND",
          );
          check(
            "...and cannot be placed into",
            await refusal(() =>
              asInstructor.cohorts.setPlacements({
                programId: program.id,
                placements: [{ enrollmentId: inside.id, cohortId: foreign.id }],
              }),
            ),
            "NOT_FOUND",
          );
        } else {
          console.log("skip  a cohort from another program — only one program is seeded");
        }

        // --- a removed fellow --------------------------------------------------
        //
        // Their cohort survives removal, so restoring them returns them to the one they were in.
        // Their work must not come back with it: `activeStudentWork` narrows on the same enrollment
        // condition the cohort does, so both hold at once.
        await asInstructor.cohorts.setPlacements({
          programId: program.id,
          placements: [
            { enrollmentId: inside.id, cohortId: squad.id },
            { enrollmentId: outside.id, cohortId: squad.id },
          ],
        });
        await asInstructor.enrollments.remove({ enrollmentId: outside.id });

        check(
          "a removed fellow keeps their cohort",
          (await tx.enrollment.findUniqueOrThrow({ where: { id: outside.id } })).cohortId,
          squad.id,
        );
        check(
          "...and is out of the cohort's pile all the same",
          (
            await asInstructor.submissions.triage({ courseId: course.id, cohort: squad.id })
          ).submissions.every((row) => row.student.id !== outside.studentId),
          true,
        );
        check(
          "...and out of its member count",
          (await asInstructor.cohorts.listForProgram({ programId: program.id })).cohorts.find(
            (row) => row.id === squad.id,
          )?.memberCount,
          1,
        );
        check(
          "...and cannot be placed in another cohort while removed",
          await refusal(() =>
            asInstructor.cohorts.setPlacements({
              programId: program.id,
              placements: [{ enrollmentId: outside.id, cohortId: other.id }],
            }),
          ),
          "BAD_REQUEST",
        );

        await asInstructor.enrollments.restore({ enrollmentId: outside.id });
        check(
          "restoring puts them back in the cohort they were in",
          (await asInstructor.cohorts.listForProgram({ programId: program.id })).cohorts.find(
            (row) => row.id === squad.id,
          )?.memberCount,
          2,
        );
        await asInstructor.cohorts.setPlacements({
          programId: program.id,
          placements: [{ enrollmentId: outside.id, cohortId: null }],
        });

        // --- the remembered filter ---------------------------------------------
        //
        // One value for the whole program rather than one per course, which is most of the
        // duplication moving cohorts up removed: the fact it records is "I grade these fifteen
        // fellows" and never "in this course I grade these fifteen".
        check(
          "choosing a cohort records it against the instructor",
          (await asInstructor.cohorts.setCohort({ programId: program.id, cohortId: squad.id }))
            .remembered,
          true,
        );
        check(
          "...and the picker opens on it",
          (await asInstructor.cohorts.listForProgram({ programId: program.id })).cohortId,
          squad.id,
        );
        check(
          "...and clearing it means all fellows",
          (await asInstructor.cohorts.setCohort({ programId: program.id, cohortId: null }))
            .cohortId,
          null,
        );

        // --- who may do any of this --------------------------------------------
        check(
          "a fellow cannot create a cohort",
          await refusal(() => asStudent.cohorts.create({ programId: program.id, name: "Nope" })),
          "FORBIDDEN",
        );
        check(
          "a fellow cannot read the cohorts",
          await refusal(() => asStudent.cohorts.listForProgram({ programId: program.id })),
          "FORBIDDEN",
        );
        check(
          "a fellow cannot read who is in them",
          await refusal(() => asStudent.cohorts.membershipsForProgram({ programId: program.id })),
          "FORBIDDEN",
        );

        /*
          The check the INSTRUCTOR role alone cannot make, asked as the question it is actually
          about. "An instructor who is not the one this script acts as" was the same question only
          while a program had one instructor, and co-teaching made it false — the query started
          returning somebody who does instruct it. `programsInstructing: { none: ... }` cannot go
          stale as a term gains or loses instructors.
        */
        const outsider = await tx.profile.findFirst({
          where: {
            role: "INSTRUCTOR",
            programsInstructing: { none: { programId: program.id } },
          },
          select: { id: true },
        });

        if (outsider) {
          const asOutsider = createCaller({ db: tx, user: { id: outsider.id } } as never);
          check(
            "an instructor who does not instruct the program cannot make it a cohort",
            await refusal(() =>
              asOutsider.cohorts.create({ programId: program.id, name: "Not yours" }),
            ),
            "FORBIDDEN",
          );
          check(
            "...nor rename one",
            await refusal(() =>
              asOutsider.cohorts.rename({ cohortId: squad.id, name: "Not yours" }),
            ),
            "FORBIDDEN",
          );
          check(
            "...nor place anybody in it",
            await refusal(() =>
              asOutsider.cohorts.setPlacements({ programId: program.id, placements: [] }),
            ),
            "FORBIDDEN",
          );
          check(
            "...nor remove it",
            await refusal(() => asOutsider.cohorts.remove({ cohortId: squad.id })),
            "FORBIDDEN",
          );
        } else {
          console.log("skip  an instructor who does not instruct the program — none is seeded");
        }

        // --- removing a cohort --------------------------------------------------
        //
        // Allowed however many fellows are in it, which is the opposite of `courseUnits.remove` and
        // right for the opposite reason: removing a unit leaves its assignments belonging to
        // nothing, where dissolving a cohort touches no fellow and no submission.
        await asInstructor.cohorts.setPlacements({
          programId: program.id,
          placements: [{ enrollmentId: inside.id, cohortId: squad.id }],
        });
        const removed = await asInstructor.cohorts.remove({ cohortId: squad.id });
        check("a cohort with members can be removed", removed.memberCount, 1);
        check(
          "...and its fellows stay on the roster",
          await tx.enrollment.count({ where: { id: inside.id, status: "ACTIVE" } }),
          1,
        );
        /*
          Cleared rather than cascaded, which is the shape `Enrollment.cohort` forced: the key is
          two columns, `SET NULL` would null the program too, and `programId` is NOT NULL. So
          `cohorts.remove` clears its fellows inside the transaction that deletes the row, and this
          is the check that it does.
        */
        check(
          "...and they are in no cohort rather than pointing at a deleted one",
          (await tx.enrollment.findUniqueOrThrow({ where: { id: inside.id } })).cohortId,
          null,
        );

        /*
          The reason `ProgramInstructor.cohortId` is a plain single-column key with `SetNull` rather
          than the composite one the enrollment carries. An instructor left holding a deleted
          cohort's id would open every screen on a filter that matches nothing, which reads as being
          caught up.
        */
        await asInstructor.cohorts.setCohort({ programId: program.id, cohortId: other.id });
        await asInstructor.cohorts.remove({ cohortId: other.id });
        check(
          "removing the cohort somebody is filtered to returns them to all fellows",
          (await asInstructor.cohorts.listForProgram({ programId: program.id })).cohortId,
          null,
        );

        throw new Error("ROLLBACK");
        /*
          Well past Prisma's five-second default, which this exceeds honestly rather than by being
          slow: the filtering checks read grading triage, the gradebook, the assignments list, and
          an assignment's queue twice each — filtered and unfiltered — and comparing the two is the
          whole point. Cheaper checks here would be checks of something else.
        */
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  /*
    ---- What the database refuses on its own ---------------------------------

    In transactions of their own, because a constraint violation aborts the one it happens in. Both
    are guards the procedures also make in words; the constraint is what holds when a second caller
    written later forgets to.
  */
  await inOwnTransaction(db, async (tx) => {
    await tx.cohort.create({ data: { programId: program.id, name: "Verify Dup" } });
    check(
      "two cohorts in one program cannot share a name",
      await refusal(() =>
        tx.cohort.create({ data: { programId: program.id, name: "Verify Dup" } }),
      ),
      "P2002",
    );
  });

  /*
    The composite foreign key, which is the guarantee that replaced a validation rule. `setPlacements`
    checks that a named cohort belongs to the program, and this is what holds when something else
    writes the column: `(cohortId, programId)` references `cohorts(id, programId)`, so no value
    `programId` can hold satisfies both halves while naming another term's cohort. The old
    grading-group version validated this by hand and said so in a comment; the key makes it
    unrepresentable.
  */
  await inOwnTransaction(db, async (tx) => {
    const elsewhere = await tx.program.findFirst({
      where: { id: { not: program.id } },
      select: { id: true },
    });

    if (!elsewhere) {
      console.log("skip  the composite key on a cohort — only one program is seeded");
      return;
    }

    const foreign = await tx.cohort.create({
      data: { programId: elsewhere.id, name: "Verify Foreign Key" },
      select: { id: true },
    });

    check(
      "a fellow cannot be placed in another program's cohort",
      await refusal(() =>
        tx.enrollment.update({ where: { id: inside.id }, data: { cohortId: foreign.id } }),
      ),
      "P2003",
    );
  });

  // --- the rollback really rolled back ---------------------------------------
  check(
    "no cohorts survived the rollback",
    await db.cohort.count({ where: { name: { startsWith: "Verify " } } }),
    0,
  );

  return finish();
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
