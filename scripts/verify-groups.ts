/**
 * Student groups: making them, filling them, and what filtering to one does to every count.
 *
 * Run with `npm run verify:groups`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because
 * authorization is half of what these procedures are — a group id says nothing about which
 * course it belongs to until the row is read — and because the half that matters most is not
 * the group table at all. It is the four screens: **the same group has to mean the same set of
 * students to grading triage, an assignment's queue, the gradebook, and the assignments list.**
 * The day two of them disagree, one screen says an instructor is caught up while another says
 * there is work waiting, and nothing on either reconciles them.
 *
 * The strongest checks here are the ones comparing a filtered read against the unfiltered one:
 * a group's pile plus the rest of the cohort's pile must be the whole pile, exactly. A filter
 * that quietly drops a submission is invisible in every other way — the screen simply looks
 * emptier, which is what being caught up also looks like.
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
 * Runs one check in a transaction of its own, rolled back.
 *
 * Required for anything that provokes a database constraint rather than a refusal the procedure
 * makes first: a failed statement aborts the whole Postgres transaction, so a duplicate-name
 * check cannot share one with the checks that follow it.
 */
async function inOwnTransaction(
  db: typeof import("../lib/prisma").db,
  work: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<void>,
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await work(tx);
      throw new Error("ROLLBACK");
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { ALL_STUDENTS, UNGROUPED } = await import("../lib/courses/groups");

  /*
    A course with **two students**, chosen by that property rather than by being the first one
    found. Everything worth checking here is a partition — one student in the group and one out
    of it is the smallest cohort where filtered and unfiltered differ at all — so a course with
    one student would run every check below and pass whether the filter worked or not.

    Same family as the mistake `verify:modules` and `verify:authoring` both made picking an
    outsider instructor: a script that selects its fixture by a proxy for the property it needs
    will eventually select the wrong one, and the failure is silent in the direction that
    matters. `some: {}` on two enrollments is not expressible, so the count is filtered after.
  */
  const candidates = await db.course.findMany({
    where: { archivedAt: null, instructors: { some: {} } },
    select: {
      id: true,
      instructors: { take: 1, select: { userId: true } },
      // Any status. The two are made active inside the transaction below, so a cohort whose
      // second student has been removed in the running application is still a usable fixture.
      enrollments: {
        orderBy: { createdAt: "asc" },
        take: 2,
        select: { id: true, studentId: true },
      },
    },
  });

  const course = candidates.find(
    (row) =>
      row.enrollments.length === 2 &&
      // Two distinct people. One profile enrolled twice cannot be partitioned.
      row.enrollments[0]!.studentId !== row.enrollments[1]!.studentId,
  );

  if (!course) {
    return skip("no seeded course with an instructor and two distinct students");
  }

  const instructor = course.instructors[0]!;
  const enrollments = course.enrollments;

  const [inside, outside] = enrollments as [
    (typeof enrollments)[number],
    (typeof enrollments)[number],
  ];
  const createCaller = createCallerFactory(appRouter);

  try {
    await db.$transaction(async (tx) => {
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
      const asStudent = createCaller({ db: tx, user: { id: inside.studentId } } as never);

      /*
        Both students active before anything is measured, inside the transaction that is thrown
        away. A cohort in the running application will have removed somebody sooner or later, and
        without this the whole script would skip — which is how a check quietly stops existing.
        The removed-student group further down does its own remove and restore, so this is a
        starting state rather than an assumption about one.
      */
      await tx.enrollment.updateMany({
        where: { id: { in: [inside.id, outside.id] } },
        data: { status: "ACTIVE" },
      });
      // Nothing carried over from a previous term's grouping, so the counts below are this
      // script's own arithmetic rather than a sum including whatever was already there.
      await tx.groupMembership.deleteMany({
        where: { enrollment: { courseId: course.id } },
      });

      // --- making a group ---------------------------------------------------
      const squad = await asInstructor.groups.create({
        courseId: course.id,
        name: "Verify Squad A",
      });
      const other = await asInstructor.groups.create({
        courseId: course.id,
        name: "Verify Squad B",
      });

      // Trimmed, because " Squad 1" and "Squad 1" are the same group to everyone but the
      // database, and a leading space is invisible in the picker it would appear twice in.
      check("a name is trimmed",
        (await asInstructor.groups.create({ courseId: course.id, name: "  Verify Padded  " }))
          .name,
        "Verify Padded");

      check("a blank name is refused",
        await refusal(() => asInstructor.groups.create({ courseId: course.id, name: "   " })),
        "BAD_REQUEST");

      check("renaming changes the name",
        (await asInstructor.groups.rename({ groupId: squad.id, name: "Verify Squad A2" })).name,
        "Verify Squad A2");

      // --- who is in it -----------------------------------------------------
      await asInstructor.groups.setMembers({
        groupId: squad.id,
        enrollmentIds: [inside.id],
      });

      const listed = await asInstructor.groups.listForCourse({ courseId: course.id });
      check("the group reports its member count",
        listed.groups.find((row) => row.id === squad.id)?.memberCount, 1);

      /*
        The whole set rather than an add, which is what makes it idempotent and impossible to
        leave half applied. Sending the same list twice must not double anything, and sending a
        different one must replace rather than append.
      */
      await asInstructor.groups.setMembers({ groupId: squad.id, enrollmentIds: [inside.id] });
      check("...and setting the same members again changes nothing",
        (await asInstructor.groups.listForCourse({ courseId: course.id })).groups.find(
          (row) => row.id === squad.id,
        )?.memberCount,
        1);

      await asInstructor.groups.setMembers({
        groupId: squad.id,
        enrollmentIds: [inside.id, outside.id],
      });
      check("...and a longer list replaces the membership",
        (await asInstructor.groups.listForCourse({ courseId: course.id })).groups.find(
          (row) => row.id === squad.id,
        )?.memberCount,
        2);

      // Back to one, which is what every filtering check below is measured against.
      await asInstructor.groups.setMembers({ groupId: squad.id, enrollmentIds: [inside.id] });

      // A student can be in more than one group. The many-to-many is the reason `ungroupedCount`
      // is its own query rather than the cohort total minus the group counts.
      await asInstructor.groups.setMembers({ groupId: other.id, enrollmentIds: [inside.id] });
      const both = await asInstructor.groups.membershipsForCourse({ courseId: course.id });
      check("a student can belong to two groups",
        both.find((row) => row.enrollmentId === inside.id)?.groupIds.length, 2);
      await asInstructor.groups.setMembers({ groupId: other.id, enrollmentIds: [] });

      // --- what the filter does to every screen -----------------------------
      //
      // The heart of it. One group, one student in it, and four reads that have to agree about
      // which students they are counting.

      const allTriage = await asInstructor.submissions.triage({ courseId: course.id });
      const groupTriage = await asInstructor.submissions.triage({
        courseId: course.id,
        group: squad.id,
      });

      check("triage filtered to a group holds only that group's students",
        groupTriage.submissions.every((row) => row.student.id === inside.studentId), true);
      check("...and is a subset of the unfiltered pile",
        groupTriage.submissions.every((row) =>
          allTriage.submissions.some((all) => all.id === row.id)), true);
      /*
        The check a quiet filter would fail. A group and its complement have to add up to the
        whole pile — if either drops a submission, this is the only place it shows, because a
        shorter list on a screen looks exactly like having less work to do.
      */
      check("...and the group plus everyone else is the whole pile",
        groupTriage.submissions.length +
          allTriage.submissions.filter((row) => row.student.id !== inside.studentId).length,
        allTriage.submissions.length);
      check("...and the approved count narrows with it",
        groupTriage.gradedCount <= allTriage.gradedCount, true);

      const allBook = await asInstructor.courses.gradebook({ courseId: course.id });
      const groupBook = await asInstructor.courses.gradebook({
        courseId: course.id,
        group: squad.id,
      });
      check("the gradebook lists only the group's students",
        groupBook.activeEnrollments.map((row) => row.student.id), [inside.studentId]);
      /*
        Cells as well as rows. `courseCells` reads every submission in the course, so a grid that
        narrowed its rows and not its cells would look right — the grid draws by row — and be
        wrong in every figure computed from the array.
      */
      check("...and only their cells",
        groupBook.cells.every((cell) => cell.studentId === inside.studentId), true);
      check("...where unfiltered holds at least as many",
        allBook.cells.length >= groupBook.cells.length, true);

      const allList = await asInstructor.courses.assignmentsOverview({ courseId: course.id });
      const groupList = await asInstructor.courses.assignmentsOverview({
        courseId: course.id,
        group: squad.id,
      });
      check("the assignments list counts the same set of assignments either way",
        groupList.assignments.length, allList.assignments.length);
      check("...and never counts more work than the whole cohort has",
        groupList.assignments.every((assignment) => {
          const unfiltered = allList.assignments.find((row) => row.id === assignment.id);
          return (
            unfiltered != null &&
            assignment.counts.outstanding <= unfiltered.counts.outstanding &&
            assignment.counts.graded <= unfiltered.counts.graded &&
            assignment.counts.submitted <= unfiltered.counts.submitted
          );
        }),
        true);

      /*
        The queue, and the one thing a filter must not do to it: a link naming a submission
        outside the selected group has to keep working. Falling through to the first row of the
        list would show a different student's report under a URL that named one, which is worse
        than an empty pane because nothing about it looks wrong.
      */
      const assignment = allList.assignments[0];
      if (assignment) {
        const queue = await asInstructor.submissions.listForAssignment({
          assignmentId: assignment.id,
          group: squad.id,
        });
        check("the queue lists only the group's students",
          queue.submissions.every((row) => row.student.id === inside.studentId), true);
        check("...and keeps an out-of-group submission openable, saying why",
          queue.asideSubmissions
            .filter((row) => row.student.id === outside.studentId)
            .every((row) => row.asideReason === "outside_group"),
          true);

        const unfilteredQueue = await asInstructor.submissions.listForAssignment({
          assignmentId: assignment.id,
        });
        check("...and the two lists together are still every submission",
          queue.submissions.length + queue.asideSubmissions.length,
          unfilteredQueue.submissions.length + unfilteredQueue.asideSubmissions.length);
      } else {
        console.log("skip  the queue under a group filter — the course has no assignments");
      }

      // --- ungrouped, and the student nobody placed --------------------------
      const ungrouped = await asInstructor.submissions.triage({
        courseId: course.id,
        group: UNGROUPED,
      });
      check("Ungrouped excludes anybody who is in a group",
        ungrouped.submissions.every((row) => row.student.id !== inside.studentId), true);
      check("...and the counted total agrees with the picker's own figure",
        (await asInstructor.groups.listForCourse({ courseId: course.id })).ungroupedCount,
        await tx.enrollment.count({
          where: { courseId: course.id, status: "ACTIVE", groupMemberships: { none: {} } },
        }));

      check("no filter and the All Students value are the same read",
        (await asInstructor.submissions.triage({ courseId: course.id, group: ALL_STUDENTS }))
          .submissions.length,
        allTriage.submissions.length);

      /*
        Fail closed rather than fail open. A group id from another course cannot match any
        enrollment in this one, so the filter returns nothing — an empty screen rather than
        another cohort's students, which is the direction that costs a query rather than a leak.
      */
      const elsewhere = await tx.course.findFirst({
        where: { id: { not: course.id } },
        select: { id: true },
      });
      if (elsewhere) {
        const foreign = await tx.courseGroup.create({
          data: { courseId: elsewhere.id, name: "Verify Foreign" },
          select: { id: true },
        });
        check("a group from another course matches nothing rather than everything",
          (await asInstructor.submissions.triage({ courseId: course.id, group: foreign.id }))
            .submissions.length,
          0);
        check("...and cannot be remembered as this course's filter",
          await refusal(() =>
            asInstructor.groups.setGradingGroup({ courseId: course.id, groupId: foreign.id })),
          "NOT_FOUND");
      } else {
        console.log("skip  a group from another course — only one course is seeded");
      }

      // --- a removed student -------------------------------------------------
      //
      // Their membership survives removal, so restoring them returns them to the groups they
      // were in. Their work must not come back with it: `activeStudentWork` is applied inside
      // the same enrollment condition the group narrows, so both hold at once.
      await asInstructor.groups.setMembers({
        groupId: squad.id,
        enrollmentIds: [inside.id, outside.id],
      });
      await asInstructor.enrollments.remove({ enrollmentId: outside.id });

      check("a removed student keeps their membership",
        await tx.groupMembership.count({
          where: { groupId: squad.id, enrollmentId: outside.id },
        }),
        1);
      check("...and is out of the group's pile all the same",
        (await asInstructor.submissions.triage({ courseId: course.id, group: squad.id }))
          .submissions.every((row) => row.student.id !== outside.studentId),
        true);
      check("...and out of its member count",
        (await asInstructor.groups.listForCourse({ courseId: course.id })).groups.find(
          (row) => row.id === squad.id,
        )?.memberCount,
        1);
      check("...and cannot be added to another group while removed",
        await refusal(() =>
          asInstructor.groups.setMembers({ groupId: other.id, enrollmentIds: [outside.id] })),
        "BAD_REQUEST");

      await asInstructor.enrollments.restore({ enrollmentId: outside.id });
      check("restoring puts them back in the group they were in",
        (await asInstructor.groups.listForCourse({ courseId: course.id })).groups.find(
          (row) => row.id === squad.id,
        )?.memberCount,
        2);
      await asInstructor.groups.setMembers({ groupId: squad.id, enrollmentIds: [inside.id] });

      // --- the remembered filter ---------------------------------------------
      check("choosing a group records it against the instructor",
        (await asInstructor.groups.setGradingGroup({ courseId: course.id, groupId: squad.id }))
          .remembered,
        true);
      check("...and the picker opens on it",
        (await asInstructor.groups.listForCourse({ courseId: course.id })).gradingGroupId,
        squad.id);
      check("...and clearing it means all students",
        (await asInstructor.groups.setGradingGroup({ courseId: course.id, groupId: null }))
          .groupId,
        null);

      // --- who may do any of this --------------------------------------------
      check("a student cannot create a group",
        await refusal(() => asStudent.groups.create({ courseId: course.id, name: "Nope" })),
        "FORBIDDEN");
      check("a student cannot read the groups",
        await refusal(() => asStudent.groups.listForCourse({ courseId: course.id })),
        "FORBIDDEN");
      check("a student cannot read who is in them",
        await refusal(() => asStudent.groups.membershipsForCourse({ courseId: course.id })),
        "FORBIDDEN");

      /*
        The check the INSTRUCTOR role alone cannot make, asked as the question it is actually
        about. "An instructor who is not the one this script acts as" was the same question only
        while a course had one instructor, and co-teaching made it false — the query started
        returning somebody who does teach the course. `instructorOf: { none: ... }` cannot go
        stale as a course gains or loses instructors.
      */
      const outsider = await tx.profile.findFirst({
        where: { role: "INSTRUCTOR", instructorOf: { none: { courseId: course.id } } },
        select: { id: true },
      });

      if (outsider) {
        const asOutsider = createCaller({ db: tx, user: { id: outsider.id } } as never);
        check("an instructor who does not teach the course cannot make it a group",
          await refusal(() =>
            asOutsider.groups.create({ courseId: course.id, name: "Not yours" })),
          "FORBIDDEN");
        check("...nor rename one",
          await refusal(() =>
            asOutsider.groups.rename({ groupId: squad.id, name: "Not yours" })),
          "FORBIDDEN");
        check("...nor change who is in it",
          await refusal(() =>
            asOutsider.groups.setMembers({ groupId: squad.id, enrollmentIds: [] })),
          "FORBIDDEN");
        check("...nor remove it",
          await refusal(() => asOutsider.groups.remove({ groupId: squad.id })),
          "FORBIDDEN");
      } else {
        console.log("skip  an instructor who does not teach the course — none is seeded");
      }

      // --- removing a group ---------------------------------------------------
      //
      // Allowed however many students are in it, which is the opposite of `modules.remove` and
      // right for the opposite reason: removing a module leaves its assignments belonging to
      // nothing, where dissolving a group touches no student and no submission.
      const removed = await asInstructor.groups.remove({ groupId: squad.id });
      check("a group with members can be removed", removed.memberCount, 1);
      check("...and its students stay in the cohort",
        await tx.enrollment.count({ where: { id: inside.id, status: "ACTIVE" } }), 1);
      check("...and its memberships go with it",
        await tx.groupMembership.count({ where: { groupId: squad.id } }), 0);

      /*
        The reason `gradingGroupId` is `onDelete: SetNull` rather than a bare column. An
        instructor left holding a deleted group's id would open every screen on a filter that
        matches nothing, which reads as being caught up.
      */
      await asInstructor.groups.setGradingGroup({ courseId: course.id, groupId: other.id });
      await asInstructor.groups.remove({ groupId: other.id });
      check("removing the group somebody is filtered to returns them to all students",
        (await asInstructor.groups.listForCourse({ courseId: course.id })).gradingGroupId,
        null);

      throw new Error("ROLLBACK");
      /*
        Well past Prisma's five-second default, which this exceeds honestly rather than by being
        slow: the filtering checks read grading triage, the gradebook, the assignments list, and
        an assignment's queue twice each — filtered and unfiltered — and comparing the two is the
        whole point. Cheaper checks here would be checks of something else.
      */
    }, { timeout: 60_000 });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  /*
    ---- What the database refuses on its own ---------------------------------

    In transactions of their own, because a constraint violation aborts the one it happens in.
    Both are guards the procedures also make in words; the constraint is what holds when a second
    caller written later forgets to.
  */
  await inOwnTransaction(db, async (tx) => {
    await tx.courseGroup.create({ data: { courseId: course.id, name: "Verify Dup" } });
    check("two groups in one course cannot share a name",
      await refusal(() =>
        tx.courseGroup.create({ data: { courseId: course.id, name: "Verify Dup" } })),
      "P2002");
  });

  await inOwnTransaction(db, async (tx) => {
    const group = await tx.courseGroup.create({
      data: { courseId: course.id, name: "Verify Twice" },
      select: { id: true },
    });
    await tx.groupMembership.create({ data: { groupId: group.id, enrollmentId: inside.id } });
    check("a student cannot be in one group twice",
      await refusal(() =>
        tx.groupMembership.create({ data: { groupId: group.id, enrollmentId: inside.id } })),
      "P2002");
  });

  // --- the rollback really rolled back ---------------------------------------
  check("no groups survived the rollback",
    await db.courseGroup.count({ where: { name: { startsWith: "Verify " } } }), 0);

  return report();
}

/**
 * Groups of checks that did not run, and why.
 *
 * **A partial run must not read as a pass.** These scripts depend on seeded data, and the day
 * that data changes shape a whole group can stop running while the output still says everything
 * is fine. Reported, and non-zero.
 */
const skips: string[] = [];
function skip(reason: string) {
  skips.push(reason);
  console.log(`\nSKIPPED — ${reason}`);
}

function report() {
  if (failures > 0) console.log(`\n${failures} FAILED`);
  else if (skips.length === 0) console.log("\nAll checks passed.");
  else
    console.log(
      `\n${skips.length} group(s) did not run. Nothing failed, but this is not a pass.`,
    );

  if (failures > 0 || skips.length > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
