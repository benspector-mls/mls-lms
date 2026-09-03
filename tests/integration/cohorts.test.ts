/**
 * Cohorts: making them, placing fellows in them, and what filtering to one does to every count.
 *
 * Run with `npm run test:integration`.
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
 *
 * Carries the 48 assertions `verify:cohorts` holds, **none of which had run**. The script needed a
 * seeded program with an instructor, a course and two distinct fellows; a seeded database has one
 * fellow, so it reported a skip and exited non-zero every time while measuring nothing. Two fellows
 * are the smallest roster on which a filter and its complement differ at all, so every group here
 * makes two.
 *
 * **Four of the script's checks were vacuous even where it did run, and the fixture fixes each.**
 * The script filtered a pile it had not filled, so "the cohort plus everyone else is the whole pile"
 * compared zero against zero; here both fellows hold submissions on two assignments, so a filter
 * that dropped one would be visible. The out-of-cohort aside had nothing to set aside, so the check
 * that an out-of-cohort submission stays openable ran over an empty array; here the fellow outside
 * the cohort has work of their own. The removed fellow's pile was empty for the same reason, and is
 * no longer. And two whole groups stood down for want of a second program and of an instructor who
 * does not teach this one — the fixture makes both, so the checks about a cohort from another
 * program and about an outsider instructor run for the first time.
 */
import { ALL_STUDENTS, UNASSIGNED } from "@/lib/programs/cohorts";
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  makeAccount,
  makeAssignment,
  makeProgram,
  makeSubmission,
  makeWorld,
  type World,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);

/** The procedures as one user would reach them, bound to this group's transaction. */
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/** Unique to this run, so the last group can ask whether any cohort it made survived. */
const suffix = crypto.randomUUID().slice(0, 8);
const cohortNamed = (label: string) => `Verify ${label} ${suffix}`;

/**
 * What a call refused with, as a string to compare against.
 *
 * The literal `"accepted"` is what comes back when the call did *not* refuse, which is what makes
 * a missing guard a visible failure rather than a passing test.
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

/**
 * A program with a course, an instructor, and **two** fellows — the first placed in a cohort and
 * the second left out of it.
 *
 * Two rather than one, and the reason is that everything worth checking here is a partition: one
 * fellow in the cohort and one out of it is the smallest roster where a filtered read and an
 * unfiltered one differ at all. With one fellow every check below runs and passes whether the
 * filter works or not.
 */
async function fixture(tx: Tx): Promise<World> {
  return makeWorld(tx, { students: 2 });
}

/**
 * The same, with two assignments and a submission from each fellow on each.
 *
 * The four screens the filter is really about are a course's piles of work, and a pile nobody has
 * handed anything in to is the same length filtered and unfiltered. Both fellows hand in, so the
 * cohort's pile is genuinely shorter than the roster's and the arithmetic comparing them has
 * something to compare.
 */
async function fixtureWithWork(tx: Tx): Promise<{ world: World; assignmentIds: string[] }> {
  const world = await fixture(tx);

  const assignmentIds: string[] = [];
  for (const label of ["Cohort Work A", "Cohort Work B"]) {
    const assignment = await makeAssignment(tx, {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: `${label} ${suffix}`,
    });
    assignmentIds.push(assignment.id);

    for (const student of world.students) {
      await makeSubmission(tx, { assignmentId: assignment.id, studentId: student.studentId });
    }
  }

  return { world, assignmentIds };
}

describe("making a cohort", () => {
  const tx = withRollback();
  let world: World;
  let squadId: string;

  beforeAll(async () => {
    world = await fixture(tx());
    squadId = (
      await createCaller(tx(), world.instructorId).cohorts.create({
        programId: world.programId,
        name: cohortNamed("Squad A"),
      })
    ).id;
  });

  // Trimmed, because " Squad 1" and "Squad 1" are the same cohort to everyone but the database,
  // and a leading space is invisible in the picker it would appear twice in.
  it("a name is trimmed", async () => {
    const created = await createCaller(tx(), world.instructorId).cohorts.create({
      programId: world.programId,
      name: `  ${cohortNamed("Padded")}  `,
    });
    expect(created.name).toBe(cohortNamed("Padded"));
  });

  it("a blank name is refused", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).cohorts.create({
        programId: world.programId,
        name: "   ",
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  it("renaming changes the name", async () => {
    const renamed = await createCaller(tx(), world.instructorId).cohorts.rename({
      cohortId: squadId,
      name: cohortNamed("Squad A2"),
    });
    expect(renamed.name).toBe(cohortNamed("Squad A2"));
  });
});

/*
  In a transaction of its own. The refusal is the unique index rather than a line of TypeScript —
  `cohorts.create` catches P2002 and rethrows it as a sentence — and a failed statement aborts
  whatever transaction it happened in, so every check after it in a shared one would fail for a
  reason that has nothing to do with what it asks.
*/
describe("a duplicate cohort name", () => {
  const tx = withRollback();

  it("a duplicate name is refused in words", async () => {
    const world = await fixture(tx());
    const asInstructor = createCaller(tx(), world.instructorId);
    await asInstructor.cohorts.create({
      programId: world.programId,
      name: cohortNamed("Duplicate"),
    });

    const code = await refusal(() =>
      asInstructor.cohorts.create({ programId: world.programId, name: cohortNamed("Duplicate") }),
    );
    expect(code).toBe("CONFLICT");
  });
});

describe("who is in it", () => {
  const tx = withRollback();
  let world: World;
  let squadId: string;
  let otherId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  /** How many active fellows the first cohort holds, as the picker reports it. */
  const squadCount = async () =>
    (await asInstructor().cohorts.listForProgram({ programId: world.programId })).cohorts.find(
      (row) => row.id === squadId,
    )?.memberCount;

  beforeAll(async () => {
    world = await fixture(tx());
    squadId = (
      await asInstructor().cohorts.create({
        programId: world.programId,
        name: cohortNamed("Squad A"),
      })
    ).id;
    otherId = (
      await asInstructor().cohorts.create({
        programId: world.programId,
        name: cohortNamed("Squad B"),
      })
    ).id;

    await asInstructor().cohorts.setPlacements({
      programId: world.programId,
      placements: [{ enrollmentId: world.students[0]!.id, cohortId: squadId }],
    });
  });

  it("the cohort reports its member count", async () => {
    expect(await squadCount()).toBe(1);
  });

  /*
    The whole placement rather than a move, which is what makes it idempotent and impossible to
    leave half applied. Sending the same list twice must not change anything, and sending a
    different one must replace rather than add.
  */
  it("and placing the same fellow again changes nothing", async () => {
    await asInstructor().cohorts.setPlacements({
      programId: world.programId,
      placements: [{ enrollmentId: world.students[0]!.id, cohortId: squadId }],
    });
    expect(await squadCount()).toBe(1);
  });

  it("and a longer list places both", async () => {
    await asInstructor().cohorts.setPlacements({
      programId: world.programId,
      placements: [
        { enrollmentId: world.students[0]!.id, cohortId: squadId },
        { enrollmentId: world.students[1]!.id, cohortId: squadId },
      ],
    });
    expect(await squadCount()).toBe(2);
  });

  /*
    The partition, stated as the thing it replaced. A grading group was a many-to-many, so a fellow
    could be in two at once and `unassignedCount` had to be its own query. A cohort is a column:
    placing somebody in a second one moves them, and "which cohort is this fellow in" has exactly
    one answer.
  */
  it("placing a fellow in a second cohort moves them out of the first", async () => {
    await asInstructor().cohorts.setPlacements({
      programId: world.programId,
      placements: [{ enrollmentId: world.students[1]!.id, cohortId: otherId }],
    });
    const placements = await asInstructor().cohorts.membershipsForProgram({
      programId: world.programId,
    });
    expect(placements.find((row) => row.enrollmentId === world.students[1]!.id)?.cohortId).toBe(
      otherId,
    );
  });

  it("and the first cohort's count falls to match", async () => {
    expect(await squadCount()).toBe(1);
  });
});

/*
  The heart of it. One cohort, one fellow in it, one fellow out of it, and four reads of one course
  that have to agree about which fellows they are counting.
*/
describe("what the filter does to every screen", () => {
  const tx = withRollback();
  let world: World;
  let assignmentIds: string[];
  let squadId: string;

  /** The fellow placed in the cohort, and the fellow deliberately left out of it. */
  let insideId: string;
  let outsideId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    const built = await fixtureWithWork(tx());
    world = built.world;
    assignmentIds = built.assignmentIds;
    insideId = world.students[0]!.studentId;
    outsideId = world.students[1]!.studentId;

    squadId = (
      await asInstructor().cohorts.create({
        programId: world.programId,
        name: cohortNamed("Squad A"),
      })
    ).id;
    await asInstructor().cohorts.setPlacements({
      programId: world.programId,
      placements: [{ enrollmentId: world.students[0]!.id, cohortId: squadId }],
    });
  });

  it("triage filtered to a cohort holds only that cohort's fellows", async () => {
    const filtered = await asInstructor().submissions.triage({
      courseId: world.courseId,
      cohort: squadId,
    });
    expect(filtered.submissions.every((row) => row.student.id === insideId)).toBe(true);
  });

  it("and is a subset of the unfiltered pile", async () => {
    const all = await asInstructor().submissions.triage({ courseId: world.courseId });
    const filtered = await asInstructor().submissions.triage({
      courseId: world.courseId,
      cohort: squadId,
    });
    expect(
      filtered.submissions.every((row) => all.submissions.some((every) => every.id === row.id)),
    ).toBe(true);
  });

  /*
    The check a quiet filter would fail. A cohort and its complement have to add up to the whole
    pile — if either drops a submission, this is the only place it shows, because a shorter list on
    a screen looks exactly like having less work to do.
  */
  it("and the cohort plus everyone else is the whole pile", async () => {
    const all = await asInstructor().submissions.triage({ courseId: world.courseId });
    const filtered = await asInstructor().submissions.triage({
      courseId: world.courseId,
      cohort: squadId,
    });
    expect(
      filtered.submissions.length +
        all.submissions.filter((row) => row.student.id !== insideId).length,
    ).toBe(all.submissions.length);
  });

  it("the gradebook lists only the cohort's fellows", async () => {
    const book = await asInstructor().courses.gradebook({
      courseId: world.courseId,
      cohort: squadId,
    });
    expect(book.activeEnrollments.map((row) => row.student.id)).toEqual([insideId]);
  });

  /*
    Cells as well as rows. `courseCells` reads every submission in the course, so a grid that
    narrowed its rows and not its cells would look right — the grid draws by row — and be wrong in
    every figure computed from the array.
  */
  it("and only their cells", async () => {
    const book = await asInstructor().courses.gradebook({
      courseId: world.courseId,
      cohort: squadId,
    });
    expect(book.cells.every((cell) => cell.studentId === insideId)).toBe(true);
  });

  it("where unfiltered holds at least as many", async () => {
    const all = await asInstructor().courses.gradebook({ courseId: world.courseId });
    const filtered = await asInstructor().courses.gradebook({
      courseId: world.courseId,
      cohort: squadId,
    });
    expect(all.cells.length >= filtered.cells.length).toBe(true);
  });

  it("the assignments list counts the same set of assignments either way", async () => {
    const all = await asInstructor().courses.assignmentsOverview({ courseId: world.courseId });
    const filtered = await asInstructor().courses.assignmentsOverview({
      courseId: world.courseId,
      cohort: squadId,
    });
    expect(filtered.assignments.length).toBe(all.assignments.length);
  });

  it("and never counts more work than the whole roster has", async () => {
    const all = await asInstructor().courses.assignmentsOverview({ courseId: world.courseId });
    const filtered = await asInstructor().courses.assignmentsOverview({
      courseId: world.courseId,
      cohort: squadId,
    });
    expect(
      filtered.assignments.every((assignment) => {
        const unfiltered = all.assignments.find((row) => row.id === assignment.id);
        return (
          unfiltered != null &&
          assignment.counts.outstanding <= unfiltered.counts.outstanding &&
          assignment.counts.graded <= unfiltered.counts.graded &&
          assignment.counts.submitted <= unfiltered.counts.submitted
        );
      }),
    ).toBe(true);
  });

  it("the queue lists only the cohort's fellows", async () => {
    const queue = await asInstructor().submissions.listForAssignment({
      assignmentId: assignmentIds[0]!,
      cohort: squadId,
    });
    expect(queue.submissions.every((row) => row.student.id === insideId)).toBe(true);
  });

  /*
    The one thing a filter must not do to the queue: a link naming a submission outside the selected
    cohort has to keep working. Falling through to the first row of the list would show a different
    fellow's report under a URL that named one, which is worse than an empty pane because nothing
    about it looks wrong.

    The fellow outside the cohort has a submission of their own on this assignment, so the aside has
    something in it to be right about.
  */
  it("and keeps an out-of-cohort submission openable, saying why", async () => {
    const queue = await asInstructor().submissions.listForAssignment({
      assignmentId: assignmentIds[0]!,
      cohort: squadId,
    });
    const aside = queue.asideSubmissions.filter((row) => row.student.id === outsideId);
    expect([aside.length, aside.every((row) => row.asideReason === "outside_cohort")]).toEqual([
      1,
      true,
    ]);
  });

  it("and the two lists together are still every submission", async () => {
    const queue = await asInstructor().submissions.listForAssignment({
      assignmentId: assignmentIds[0]!,
      cohort: squadId,
    });
    const unfiltered = await asInstructor().submissions.listForAssignment({
      assignmentId: assignmentIds[0]!,
    });
    expect(queue.submissions.length + queue.asideSubmissions.length).toBe(
      unfiltered.submissions.length + unfiltered.asideSubmissions.length,
    );
  });

  it("No cohort excludes anybody who is in one", async () => {
    const unassigned = await asInstructor().submissions.triage({
      courseId: world.courseId,
      cohort: UNASSIGNED,
    });
    expect(unassigned.submissions.every((row) => row.student.id !== insideId)).toBe(true);
  });

  it("and the counted total agrees with the picker's own figure", async () => {
    const listed = await asInstructor().cohorts.listForProgram({ programId: world.programId });
    const counted = await tx().enrollment.count({
      where: { programId: world.programId, status: "ACTIVE", cohortId: null },
    });
    expect(listed.unassignedCount).toBe(counted);
  });

  it("no filter and the All Fellows value are the same read", async () => {
    const all = await asInstructor().submissions.triage({ courseId: world.courseId });
    const named = await asInstructor().submissions.triage({
      courseId: world.courseId,
      cohort: ALL_STUDENTS,
    });
    expect(named.submissions.length).toBe(all.submissions.length);
  });
});

/*
  Fail closed rather than fail open. A cohort id from another program cannot match any enrollment on
  this roster, so the filter returns nothing — an empty screen rather than another term's fellows,
  which is the direction that costs a query rather than a leak.

  The script stood this group down whenever the database held only one program. The second program
  is made here, so the three checks run.
*/
describe("a cohort from another program", () => {
  const tx = withRollback();
  let world: World;
  let foreignId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = (await fixtureWithWork(tx())).world;
    const elsewhere = await makeProgram(tx());
    foreignId = (
      await tx().cohort.create({
        data: { programId: elsewhere.id, name: cohortNamed("Foreign") },
        select: { id: true },
      })
    ).id;
  });

  it("a cohort from another program matches nothing rather than everything", async () => {
    const filtered = await asInstructor().submissions.triage({
      courseId: world.courseId,
      cohort: foreignId,
    });
    expect(filtered.submissions.length).toBe(0);
  });

  it("and cannot be remembered as this program's filter", async () => {
    const code = await refusal(() =>
      asInstructor().cohorts.setCohort({ programId: world.programId, cohortId: foreignId }),
    );
    expect(code).toBe("NOT_FOUND");
  });

  it("and cannot be placed into", async () => {
    const code = await refusal(() =>
      asInstructor().cohorts.setPlacements({
        programId: world.programId,
        placements: [{ enrollmentId: world.students[0]!.id, cohortId: foreignId }],
      }),
    );
    expect(code).toBe("NOT_FOUND");
  });
});

/*
  A removed fellow's cohort survives removal, so restoring them returns them to the one they were
  in. Their work must not come back with it: `activeStudentWork` narrows on the same enrollment
  condition the cohort does, so both hold at once.

  Both fellows hold submissions, so "out of the cohort's pile all the same" is a claim about a pile
  that has something in it.
*/
describe("a removed fellow", () => {
  const tx = withRollback();
  let world: World;
  let squadId: string;
  let otherId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  const squadCount = async () =>
    (await asInstructor().cohorts.listForProgram({ programId: world.programId })).cohorts.find(
      (row) => row.id === squadId,
    )?.memberCount;

  beforeAll(async () => {
    world = (await fixtureWithWork(tx())).world;
    const asCaller = asInstructor();
    squadId = (
      await asCaller.cohorts.create({ programId: world.programId, name: cohortNamed("Squad A") })
    ).id;
    otherId = (
      await asCaller.cohorts.create({ programId: world.programId, name: cohortNamed("Squad B") })
    ).id;

    await asCaller.cohorts.setPlacements({
      programId: world.programId,
      placements: [
        { enrollmentId: world.students[0]!.id, cohortId: squadId },
        { enrollmentId: world.students[1]!.id, cohortId: squadId },
      ],
    });
    await asCaller.enrollments.remove({ enrollmentId: world.students[1]!.id });
  });

  it("a removed fellow keeps their cohort", async () => {
    const enrollment = await tx().enrollment.findUniqueOrThrow({
      where: { id: world.students[1]!.id },
    });
    expect(enrollment.cohortId).toBe(squadId);
  });

  it("and is out of the cohort's pile all the same", async () => {
    const filtered = await asInstructor().submissions.triage({
      courseId: world.courseId,
      cohort: squadId,
    });
    expect(
      filtered.submissions.every((row) => row.student.id !== world.students[1]!.studentId),
    ).toBe(true);
  });

  it("and out of its member count", async () => {
    expect(await squadCount()).toBe(1);
  });

  it("and cannot be placed in another cohort while removed", async () => {
    const code = await refusal(() =>
      asInstructor().cohorts.setPlacements({
        programId: world.programId,
        placements: [{ enrollmentId: world.students[1]!.id, cohortId: otherId }],
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  it("restoring puts them back in the cohort they were in", async () => {
    await asInstructor().enrollments.restore({ enrollmentId: world.students[1]!.id });
    expect(await squadCount()).toBe(2);
  });
});

/*
  One value for the whole program rather than one per course, which is most of the duplication
  moving cohorts up removed: the fact it records is "I grade these fifteen fellows" and never "in
  this course I grade these fifteen".
*/
describe("the remembered filter", () => {
  const tx = withRollback();
  let world: World;
  let squadId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await fixture(tx());
    squadId = (
      await asInstructor().cohorts.create({
        programId: world.programId,
        name: cohortNamed("Squad A"),
      })
    ).id;
  });

  it("choosing a cohort records it against the instructor", async () => {
    const chosen = await asInstructor().cohorts.setCohort({
      programId: world.programId,
      cohortId: squadId,
    });
    expect(chosen.remembered).toBe(true);
  });

  it("and the picker opens on it", async () => {
    const listed = await asInstructor().cohorts.listForProgram({ programId: world.programId });
    expect(listed.cohortId).toBe(squadId);
  });

  it("and clearing it means all fellows", async () => {
    const cleared = await asInstructor().cohorts.setCohort({
      programId: world.programId,
      cohortId: null,
    });
    expect(cleared.cohortId).toBeNull();
  });
});

describe("who may do any of this", () => {
  const tx = withRollback();
  let world: World;
  let squadId: string;

  /**
   * An instructor of no program at all.
   *
   * The check the INSTRUCTOR role alone cannot make, asked as the question it is actually about.
   * "An instructor who is not the one this suite acts as" was the same question only while a
   * program had one instructor, and co-teaching made it false — that phrasing started admitting
   * somebody who does instruct it. Somebody with no `ProgramInstructor` row on this program cannot
   * go stale as a term gains or loses instructors.
   *
   * The script looked for one among the seeded profiles and stood its four checks down when the
   * database had none, which on a freshly seeded database is every run.
   */
  let outsiderId: string;

  beforeAll(async () => {
    world = await fixture(tx());
    outsiderId = await makeAccount(tx(), { role: "INSTRUCTOR" });
    squadId = (
      await createCaller(tx(), world.instructorId).cohorts.create({
        programId: world.programId,
        name: cohortNamed("Squad A"),
      })
    ).id;
  });

  it("a fellow cannot create a cohort", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.student.studentId).cohorts.create({
        programId: world.programId,
        name: cohortNamed("Nope"),
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("a fellow cannot read the cohorts", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.student.studentId).cohorts.listForProgram({
        programId: world.programId,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("a fellow cannot read who is in them", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.student.studentId).cohorts.membershipsForProgram({
        programId: world.programId,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("an instructor who does not instruct the program cannot make it a cohort", async () => {
    const code = await refusal(() =>
      createCaller(tx(), outsiderId).cohorts.create({
        programId: world.programId,
        name: cohortNamed("Not yours"),
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("nor rename one", async () => {
    const code = await refusal(() =>
      createCaller(tx(), outsiderId).cohorts.rename({
        cohortId: squadId,
        name: cohortNamed("Not yours"),
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("nor place anybody in it", async () => {
    const code = await refusal(() =>
      createCaller(tx(), outsiderId).cohorts.setPlacements({
        programId: world.programId,
        placements: [],
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("nor remove it", async () => {
    const code = await refusal(() =>
      createCaller(tx(), outsiderId).cohorts.remove({ cohortId: squadId }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

/*
  Removing a cohort is allowed however many fellows are in it, which is the opposite of
  `courseUnits.remove` and right for the opposite reason: removing a unit leaves its assignments
  belonging to nothing, where dissolving a cohort touches no fellow and no submission.
*/
describe("removing a cohort", () => {
  const tx = withRollback();
  let world: World;
  let squadId: string;
  let otherId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await fixture(tx());
    const asCaller = asInstructor();
    squadId = (
      await asCaller.cohorts.create({ programId: world.programId, name: cohortNamed("Squad A") })
    ).id;
    otherId = (
      await asCaller.cohorts.create({ programId: world.programId, name: cohortNamed("Squad B") })
    ).id;
    await asCaller.cohorts.setPlacements({
      programId: world.programId,
      placements: [{ enrollmentId: world.student.id, cohortId: squadId }],
    });
  });

  it("a cohort with members can be removed", async () => {
    const removed = await asInstructor().cohorts.remove({ cohortId: squadId });
    expect(removed.memberCount).toBe(1);
  });

  it("and its fellows stay on the roster", async () => {
    const still = await tx().enrollment.count({
      where: { id: world.student.id, status: "ACTIVE" },
    });
    expect(still).toBe(1);
  });

  /*
    Cleared rather than cascaded, which is the shape `Enrollment.cohort` forced: the key is two
    columns, `SET NULL` would null the program too, and `programId` is NOT NULL. So `cohorts.remove`
    clears its fellows inside the transaction that deletes the row, and this is the check that it
    does.
  */
  it("and they are in no cohort rather than pointing at a deleted one", async () => {
    const enrollment = await tx().enrollment.findUniqueOrThrow({ where: { id: world.student.id } });
    expect(enrollment.cohortId).toBeNull();
  });

  /*
    The reason `ProgramInstructor.cohortId` is a plain single-column key with `SetNull` rather than
    the composite one the enrollment carries. An instructor left holding a deleted cohort's id
    would open every screen on a filter that matches nothing, which reads as being caught up.
  */
  it("removing the cohort somebody is filtered to returns them to all fellows", async () => {
    await asInstructor().cohorts.setCohort({ programId: world.programId, cohortId: otherId });
    await asInstructor().cohorts.remove({ cohortId: otherId });
    const listed = await asInstructor().cohorts.listForProgram({ programId: world.programId });
    expect(listed.cohortId).toBeNull();
  });
});

/*
  ---- What the database refuses on its own -----------------------------------

  Each in a transaction of its own, because a constraint violation aborts the one it happens in.
  Both are guards the procedures also make in words; the constraint is what holds when a second
  caller written later forgets to.
*/
describe("two cohorts of one program sharing a name", () => {
  const tx = withRollback();

  it("two cohorts in one program cannot share a name", async () => {
    const world = await fixture(tx());
    await tx().cohort.create({
      data: { programId: world.programId, name: cohortNamed("Dup") },
    });

    const code = await refusal(() =>
      tx().cohort.create({ data: { programId: world.programId, name: cohortNamed("Dup") } }),
    );
    expect(code).toBe("P2002");
  });
});

/*
  The composite foreign key, which is the guarantee that replaced a validation rule.
  `setPlacements` checks that a named cohort belongs to the program, and this is what holds when
  something else writes the column: `(cohortId, programId)` references `cohorts(id, programId)`, so
  no value `programId` can hold satisfies both halves while naming another term's cohort. The old
  grading-group version validated this by hand and said so in a comment; the key makes it
  unrepresentable.
*/
describe("the composite key on a cohort", () => {
  const tx = withRollback();

  it("a fellow cannot be placed in another program's cohort", async () => {
    const world = await fixture(tx());
    const elsewhere = await makeProgram(tx());
    const foreign = await tx().cohort.create({
      data: { programId: elsewhere.id, name: cohortNamed("Foreign Key") },
      select: { id: true },
    });

    const code = await refusal(() =>
      tx().enrollment.update({
        where: { id: world.student.id },
        data: { cohortId: foreign.id },
      }),
    );
    expect(code).toBe("P2003");
  });
});

/*
  Every group above rolled its transaction back, and this is the check that says so. It reads the
  committed database, outside any transaction, after all of them have ended.
*/
describe("the rollback really rolled back", () => {
  it("no cohorts survived the rollback", async () => {
    const leftover = await db.cohort.count({ where: { name: { endsWith: suffix } } });
    expect(leftover).toBe(0);
  });
});
