/**
 * The roster's Performance tab: who lands in which group, read through the procedure.
 *
 * Run with `npm run test:integration`.
 *
 * The rule itself is `tests/lib/programs/performance.test.ts`, which runs on every save. What this
 * adds is that the procedure feeds the rule the right figures from real rows, combined here by
 * `standingAcross` the way the screen combines them when every course is shown: that past-due work
 * counts, that closed mornings count, that a test student is not measured, that the cohort picker
 * narrows the list, and — the case the rule is shaped around — that a fellow with full attendance
 * who has been late three mornings running is in needs support rather than exceeding.
 */
import { standingAcross } from "@/lib/programs/performance";
import { dateColumnFor } from "@/lib/school-time";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAccount, makeAssignment, makeSubmission, makeWorld, type World } from "./fixtures";
import { withRollback } from "./transaction";

const factory = createCallerFactory(appRouter);

/** A number no real deployment will reach, and different from the test-student suite's. */
const FAKE_NUMBER = 999_002;

/** Five closed mornings, early in September, well behind any clock this suite runs against. */
const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07"];

describe("sorting a roster into the Performance groups", () => {
  const tx = withRollback();

  let world: World;
  let cohortId: string;
  const ids = { clean: "", missing: "", lateLately: "", newcomer: "", test: "" };

  const asInstructor = () =>
    factory({ db: tx(), user: { id: world.instructorId }, viewingAs: null } as never);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 5 });
    const [clean, missing, lateLately, newcomer, test] = world.students;
    ids.clean = clean!.studentId;
    ids.missing = missing!.studentId;
    ids.lateLately = lateLately!.studentId;
    ids.newcomer = newcomer!.studentId;
    ids.test = test!.studentId;

    await tx().profile.update({
      where: { id: ids.test },
      data: { testStudentNumber: FAKE_NUMBER },
    });

    /*
      Joined in January, except the newcomer, who joined today and so has no mornings counted
      against them. Without this every fellow would have joined today and every morning would be
      before their time.
    */
    for (const enrollment of [clean!, missing!, lateLately!, test!]) {
      await tx().enrollment.update({
        where: { id: enrollment.id },
        data: { createdAt: new Date("2026-01-05T12:00:00Z") },
      });
    }

    const cohort = await tx().cohort.create({
      data: { programId: world.programId, name: "Integration Performance Cohort" },
      select: { id: true },
    });
    cohortId = cohort.id;
    await tx().enrollment.update({ where: { id: clean!.id }, data: { cohortId } });

    // One assignment, past due. Everybody but the missing fellow and the newcomer hands it in.
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      dueAt: new Date("2026-09-10T23:00:00Z"),
    });
    for (const studentId of [ids.clean, ids.lateLately, ids.test]) {
      await makeSubmission(tx(), {
        assignmentId: assignment.id,
        studentId,
        submittedAt: new Date("2026-09-09T12:00:00Z"),
      });
    }

    /*
      Five mornings. The clean and missing fellows are present at all five. The fellow who has
      slipped is present at the first two and late at the last three, which keeps their rate at
      100 percent — late counts as attending — and trips the lateness clause of the drift rule.
    */
    for (const [index, day] of DAYS.entries()) {
      const session = await tx().attendanceSession.create({
        data: {
          programId: world.programId,
          date: dateColumnFor(day),
          startedAt: new Date(`${day}T13:00:00Z`),
          endsAt: new Date(`${day}T23:00:00Z`),
          endedAt: new Date(`${day}T23:00:00Z`),
          lateAfterMinutes: 5,
          codeSecret: "a".repeat(64),
        },
        select: { id: true },
      });

      const statuses = [
        [clean!.id, "PRESENT"],
        [missing!.id, "PRESENT"],
        [lateLately!.id, index < 2 ? "PRESENT" : "LATE"],
        [test!.id, "PRESENT"],
      ] as const;

      for (const [enrollmentId, status] of statuses) {
        await tx().attendanceRecord.create({
          data: {
            sessionId: session.id,
            programId: world.programId,
            enrollmentId,
            status,
            source: "INSTRUCTOR",
          },
        });
      }
    }
  });

  const read = async (cohort = "all") =>
    (await asInstructor().programs.performance({ programId: world.programId, cohort })).fellows;
  /**
   * One fellow, with their standing across every course, as the screen computes it with no course
   * filter chosen. The procedure sends per-course readings; `standingAcross` is what combines them.
   */
  const fellow = async (studentId: string) => {
    const data = await asInstructor().programs.performance({
      programId: world.programId,
      cohort: "all",
    });
    const row = data.fellows.find((candidate) => candidate.student.id === studentId);
    return row && { ...row, standing: standingAcross(row.attendance, data.courses, row.courses) };
  };

  it("a fellow on time and here every morning exceeds", async () => {
    const row = await fellow(ids.clean);
    expect(row?.standing.bucket).toBe("exceeding");
    expect(row?.standing.onTime).toEqual({ onTime: 1, due: 1 });
    expect(row?.attendance.rate).toBe(1);
  });

  it("the grid draws a band for the course that has released work", async () => {
    const { courses } = await asInstructor().programs.performance({
      programId: world.programId,
      cohort: "all",
    });
    expect(courses).toEqual([
      expect.objectContaining({
        id: world.courseId,
        hasWork: true,
        hasChecks: false,
        archived: false,
      }),
    ]);
  });

  it("says whether the program is over, which decides the default courses", async () => {
    const { programArchived } = await asInstructor().programs.performance({
      programId: world.programId,
      cohort: "all",
    });
    expect(programArchived).toBe(false);
  });

  it("and a completion column for the one kind of unit with released work", async () => {
    const { courses } = await asInstructor().programs.performance({
      programId: world.programId,
      cohort: "all",
    });
    expect(courses[0]?.categories).toEqual(["MODULE"]);
  });

  it("each fellow carries that course's on-time count", async () => {
    const row = await fellow(ids.missing);
    expect(row?.courses[world.courseId]?.onTime).toEqual({ onTime: 0, due: 1 });
  });

  it("completion counts only work graded complete", async () => {
    const row = await fellow(ids.clean);
    expect(row?.standing.completion.MODULE).toEqual({ complete: 0, possible: 1 });
  });

  it("each fellow carries that course's completion, by kind of unit", async () => {
    const row = await fellow(ids.clean);
    expect(row?.courses[world.courseId]?.completion).toEqual({
      MODULE: { complete: 0, possible: 1 },
    });
  });

  it("each fellow carries that course's recent work", async () => {
    const row = await fellow(ids.missing);
    expect(row?.courses[world.courseId]?.recent).toMatchObject({ missed: 1, late: 0, due: 1 });
  });

  it("and the attendance windows the grid prints", async () => {
    const row = await fellow(ids.lateLately);
    expect(row?.attendance.recent).toMatchObject({ late: 3, lateOf: 5 });
    expect(row?.attendance.reason).toBe("late");
  });

  it("a fellow who never handed in the work needs support", async () => {
    const row = await fellow(ids.missing);
    expect(row?.standing.bucket).toBe("needs-support");
    expect(row?.standing.onTime).toEqual({ onTime: 0, due: 1 });
  });

  it("a fellow late three mornings running needs support, at full attendance", async () => {
    const row = await fellow(ids.lateLately);
    expect(row?.attendance.rate).toBe(1);
    expect(row?.standing.flags).toEqual([{ kind: "attendance", reason: "late" }]);
    expect(row?.standing.bucket).toBe("needs-support");
  });

  it("a fellow with no mornings counted yet is too early to say", async () => {
    const row = await fellow(ids.newcomer);
    expect(row?.attendance.rate).toBeNull();
    expect(row?.standing.bucket).toBe("too-early");
  });

  it("a test student is not measured", async () => {
    expect(await fellow(ids.test)).toBeUndefined();
  });

  it("a cohort narrows the list to its fellows", async () => {
    const rows = await read(cohortId);
    expect(rows.map((row) => row.student.id)).toEqual([ids.clean]);
  });

  it("no cohort narrows it to the fellows nobody has placed", async () => {
    const rows = await read("unassigned");
    expect(rows.map((row) => row.student.id).sort()).toEqual(
      [ids.missing, ids.lateLately, ids.newcomer].sort(),
    );
  });

  it("an instructor of another program is refused", async () => {
    const strangerId = await makeAccount(tx(), { role: "INSTRUCTOR" });
    const stranger = factory({ db: tx(), user: { id: strangerId }, viewingAs: null } as never);
    await expect(
      stranger.programs.performance({ programId: world.programId, cohort: "all" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
