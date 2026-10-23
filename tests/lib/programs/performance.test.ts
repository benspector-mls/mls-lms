import {
  attendanceFlags,
  chosenMeasures,
  gradedCompletionByStudent,
  meetingShares,
  onTimeByStudent,
  defaultCourseIds,
  shareBand,
  shownCourseIds,
  standingAcross,
  type CourseStanding,
  type Measure,
  measureOf,
  performanceBucket,
  performanceFlagLabel,
  PERFORMANCE_RULE,
  type PerformanceFlag,
  type PerformanceReading,
  type Standing,
  workFlags,
} from "@/lib/programs/performance";
import type { RecentAssignment, RecentCell, RecentWork } from "@/lib/gradebook/summary";
import type { RecentAttendance } from "@/lib/attendance/summary";

/**
 * The roster's Performance rule.
 *
 * What these protect is the promise the tab makes to the instructor reading it: that the group is
 * the worst band on the row, so a fellow in exceeding has nothing red or yellow anywhere, and
 * anybody with a red cell is in needs support however good their term has been.
 */

const AT = new Date("2026-10-15T12:00:00Z");
const PAST = "2026-10-01T12:00:00Z";
const LATER_PAST = "2026-10-10T12:00:00Z";
const FUTURE = "2026-10-20T12:00:00Z";

function reading(overrides: Partial<PerformanceReading> = {}): PerformanceReading {
  return {
    onTime: { onTime: 10, submitted: 10, due: 10 },
    completion: {},
    attendanceRate: 0.95,
    flags: [],
    ...overrides,
  };
}

const workFlag: PerformanceFlag = {
  kind: "work",
  courseId: "c1",
  courseName: "Web Fundamentals",
  reason: "deadlines",
  band: "red",
};
const attendanceFlag: PerformanceFlag = { kind: "attendance", reason: "late", band: "red" };
const yellowFlag: PerformanceFlag = { ...workFlag, band: "yellow" };

const quiet: RecentAttendance = { missed: 0, missedOf: 10, late: 0, lateOf: 10, excused: 0 };
const steady: RecentWork = {
  studentId: "s1",
  missed: 0,
  late: 0,
  due: 10,
  incomplete: 0,
  graded: 5,
};

describe("shareBand", () => {
  it("a share is red under meeting, yellow under exceeding, and green from there", () => {
    const rule = { meeting: 0.75, exceeding: 0.9 };
    expect(shareBand(0.74, rule)).toBe("red");
    expect(shareBand(0.75, rule)).toBe("yellow");
    expect(shareBand(0.89, rule)).toBe("yellow");
    expect(shareBand(0.9, rule)).toBe("green");
  });
});

describe("performanceBucket", () => {
  it("a fellow on time, here, and unflagged exceeds", () => {
    expect(performanceBucket(reading())).toBe("exceeding");
  });

  it("exceeding begins at the attendance threshold itself", () => {
    expect(
      performanceBucket(reading({ attendanceRate: PERFORMANCE_RULE.attendance.exceeding })),
    ).toBe("exceeding");
  });

  it("just under the exceeding attendance is meeting", () => {
    expect(performanceBucket(reading({ attendanceRate: 0.89 }))).toBe("meeting");
  });

  it("meeting begins at its own attendance threshold", () => {
    expect(
      performanceBucket(reading({ attendanceRate: PERFORMANCE_RULE.attendance.meeting })),
    ).toBe("meeting");
  });

  it("below the meeting attendance needs support", () => {
    expect(performanceBucket(reading({ attendanceRate: 0.74 }))).toBe("needs-support");
  });

  it("nine of ten on time still exceeds", () => {
    expect(performanceBucket(reading({ onTime: { onTime: 9, submitted: 10, due: 10 } }))).toBe(
      "exceeding",
    );
  });

  it("eight of ten on time is meeting, however good attendance is", () => {
    expect(
      performanceBucket(
        reading({ onTime: { onTime: 8, submitted: 10, due: 10 }, attendanceRate: 1 }),
      ),
    ).toBe("meeting");
  });

  it("seven of ten on time needs support", () => {
    expect(performanceBucket(reading({ onTime: { onTime: 7, submitted: 10, due: 10 } }))).toBe(
      "needs-support",
    );
  });

  it("reads the submitted share and each kind of work's completion share the same way", () => {
    expect(performanceBucket(reading({ onTime: { onTime: 7, submitted: 7, due: 10 } }))).toBe(
      "needs-support",
    );
    expect(
      performanceBucket(reading({ completion: { MODULE: { complete: 8, possible: 10 } } })),
    ).toBe("meeting");
    expect(
      performanceBucket(reading({ completion: { PROJECT: { complete: 0, possible: 1 } } })),
    ).toBe("needs-support");
    // Nothing past due and graded of a kind is no share, and no band.
    expect(
      performanceBucket(reading({ completion: { PROJECT: { complete: 0, possible: 0 } } })),
    ).toBe("exceeding");
  });

  /*
    The case the rule is shaped around: a fellow whose term is excellent and whose fortnight is not.
  */
  it("a red work flag needs support even with a perfect term", () => {
    expect(performanceBucket(reading({ attendanceRate: 1, flags: [workFlag] }))).toBe(
      "needs-support",
    );
  });

  it("a red attendance flag needs support even at 95 percent", () => {
    expect(performanceBucket(reading({ flags: [attendanceFlag] }))).toBe("needs-support");
  });

  it("a yellow flag alone is meeting, not needs support", () => {
    expect(performanceBucket(reading({ flags: [yellowFlag] }))).toBe("meeting");
  });

  it("one red among yellows is still needs support", () => {
    expect(performanceBucket(reading({ flags: [yellowFlag, workFlag] }))).toBe("needs-support");
  });

  it("nothing due yet is too early, not exceeding", () => {
    expect(performanceBucket(reading({ onTime: null }))).toBe("too-early");
  });

  it("too few mornings is too early, not exceeding", () => {
    expect(performanceBucket(reading({ attendanceRate: null }))).toBe("too-early");
  });

  it("too early wins over a flag, because there is nothing yet to weigh it against", () => {
    expect(performanceBucket(reading({ onTime: null, flags: [workFlag] }))).toBe("too-early");
  });
});

describe("performanceBucket, reading only some measures", () => {
  /*
    What these protect: a measure left out is not read at all, neither its term share, its flagged
    windows, nor its missing figure, so an instructor who asks who needs support for attendance
    and deadlines gets a group that holds nobody who is there for anything else.
  */
  const only = (...measures: Measure[]) => new Set(measures);
  const fallingShort: PerformanceFlag = { ...workFlag, reason: "falling-short" };

  it("a red attendance rate is ignored when attendance is left out", () => {
    const red = reading({ attendanceRate: 0.5 });
    expect(performanceBucket(red)).toBe("needs-support");
    expect(performanceBucket(red, only("deadlines", "submissions", "completion"))).toBe(
      "exceeding",
    );
  });

  it("under deadlines alone, a red submitted share and a red completion share are ignored", () => {
    const red = reading({
      onTime: { onTime: 10, submitted: 7, due: 10 },
      completion: { MODULE: { complete: 0, possible: 4 } },
    });
    expect(performanceBucket(red)).toBe("needs-support");
    expect(performanceBucket(red, only("deadlines"))).toBe("exceeding");
    expect(performanceBucket(red, only("submissions"))).toBe("needs-support");
    expect(performanceBucket(red, only("completion"))).toBe("needs-support");
  });

  it("a flag belongs to its measure and is ignored with it", () => {
    expect(performanceBucket(reading({ flags: [attendanceFlag] }), only("deadlines"))).toBe(
      "exceeding",
    );
    expect(performanceBucket(reading({ flags: [workFlag] }), only("attendance"))).toBe(
      "exceeding",
    );
    expect(performanceBucket(reading({ flags: [workFlag] }), only("deadlines"))).toBe(
      "needs-support",
    );
    expect(performanceBucket(reading({ flags: [fallingShort] }), only("deadlines"))).toBe(
      "exceeding",
    );
    expect(performanceBucket(reading({ flags: [fallingShort] }), only("completion"))).toBe(
      "needs-support",
    );
  });

  it("too early only when a chosen measure has nothing to read", () => {
    // Too few mornings: too early for attendance, placed under the work measures.
    const noMornings = reading({ attendanceRate: null });
    expect(performanceBucket(noMornings, only("attendance"))).toBe("too-early");
    expect(performanceBucket(noMornings, only("deadlines"))).toBe("exceeding");
    // Nothing due: too early for every work measure, placed under attendance.
    const nothingDue = reading({ onTime: null });
    expect(performanceBucket(nothingDue, only("completion"))).toBe("too-early");
    expect(performanceBucket(nothingDue, only("attendance"))).toBe("exceeding");
  });

  it("completion alone with nothing graded yet is too early, not exceeding", () => {
    expect(performanceBucket(reading({ completion: {} }), only("completion"))).toBe("too-early");
    // The same fellow is placed once another measure is read beside it.
    expect(performanceBucket(reading({ completion: {} }), only("completion", "deadlines"))).toBe(
      "exceeding",
    );
  });
});

describe("measureOf", () => {
  it("files attendance flags under attendance and work flags by their reason", () => {
    expect(measureOf(attendanceFlag)).toBe("attendance");
    expect(measureOf(workFlag)).toBe("deadlines");
    expect(measureOf({ ...workFlag, reason: "falling-short" })).toBe("completion");
  });
});

describe("chosenMeasures", () => {
  it("reads every measure when the address names none", () => {
    expect(chosenMeasures(null)).toEqual(
      new Set(["attendance", "deadlines", "submissions", "completion"]),
    );
  });

  it("reads the measures the address names", () => {
    expect(chosenMeasures("attendance,deadlines")).toEqual(new Set(["attendance", "deadlines"]));
  });

  it("ignores a name that is no measure", () => {
    expect(chosenMeasures("attendance,grades")).toEqual(new Set(["attendance"]));
  });

  it("reads every measure when the address names nothing valid, rather than none", () => {
    expect(chosenMeasures("")).toEqual(chosenMeasures(null));
    expect(chosenMeasures("grades")).toEqual(chosenMeasures(null));
  });
});

describe("performanceFlagLabel", () => {
  it("names the course for a work flag", () => {
    expect(performanceFlagLabel(workFlag)).toBe("Missing deadlines · Web Fundamentals");
  });

  it("uses the attendance screen's own words for an attendance flag", () => {
    expect(performanceFlagLabel(attendanceFlag)).toBe("Arriving late");
  });
});

describe("workFlags", () => {
  const course = { id: "c1", name: "Web Fundamentals" };

  it("says nothing about a course with no window, or a quiet one", () => {
    expect(workFlags(course, null)).toEqual([]);
    expect(workFlags(course, steady)).toEqual([]);
  });

  it("of ten deadlines, one slipped is green, two are yellow, and four are red", () => {
    expect(workFlags(course, { ...steady, missed: 1 })).toEqual([]);
    expect(workFlags(course, { ...steady, missed: 1, late: 1 })).toEqual([
      { ...workFlag, band: "yellow" },
    ]);
    expect(workFlags(course, { ...steady, missed: 2, late: 2 })).toEqual([workFlag]);
  });

  it("of five graded, one incomplete is yellow, and two are red", () => {
    const fallingShort = { ...workFlag, reason: "falling-short" as const };
    expect(workFlags(course, { ...steady, incomplete: 1 })).toEqual([
      { ...fallingShort, band: "yellow" },
    ]);
    expect(workFlags(course, { ...steady, incomplete: 2 })).toEqual([fallingShort]);
  });
});

describe("attendanceFlags", () => {
  it("says nothing before the fellow can be judged, or when the fortnight is clean", () => {
    expect(attendanceFlags(null)).toEqual([]);
    expect(attendanceFlags(quiet)).toEqual([]);
  });

  it("of ten mornings, one absence is green, two are yellow, and three are red", () => {
    const missing = { kind: "attendance" as const, reason: "missing" as const };
    expect(attendanceFlags({ ...quiet, missed: 1 })).toEqual([]);
    expect(attendanceFlags({ ...quiet, missed: 2 })).toEqual([{ ...missing, band: "yellow" }]);
    expect(attendanceFlags({ ...quiet, missed: 3 })).toEqual([{ ...missing, band: "red" }]);
  });

  it("of ten mornings, two late arrivals are yellow, and three are red", () => {
    expect(attendanceFlags({ ...quiet, late: 1 })).toEqual([]);
    expect(attendanceFlags({ ...quiet, late: 2 })).toEqual([{ ...attendanceFlag, band: "yellow" }]);
    expect(attendanceFlags({ ...quiet, late: 3 })).toEqual([attendanceFlag]);
  });

  it("says nothing over an empty window", () => {
    expect(attendanceFlags({ missed: 0, missedOf: 0, late: 0, lateOf: 0, excused: 0 })).toEqual([]);
  });

  // An excused morning is still a missed one; the count beside it is for the reader, not the rule.
  it("reads excused absences as absences", () => {
    expect(attendanceFlags({ ...quiet, missed: 3, excused: 3 })).toEqual([
      { kind: "attendance", reason: "missing", band: "red" },
    ]);
  });
});

describe("onTimeByStudent", () => {
  const assignment = (
    id: string,
    dueAt: string | null,
    distributedAt: string | null = PAST,
  ): RecentAssignment => ({ id, dueAt, distributedAt });

  const cell = (assignmentId: string, overrides: Partial<RecentCell> = {}): RecentCell => ({
    assignmentId,
    studentId: "s1",
    status: "SUBMITTED",
    submittedAt: PAST,
    extendedDueAt: null,
    isComplete: null,
    ...overrides,
  });

  const onTimeOf = (work: RecentAssignment[], cells: RecentCell[]) =>
    onTimeByStudent(["s1"], work, cells, AT).get("s1");

  it("counts work handed in by the deadline, graded or not", () => {
    expect(onTimeOf([assignment("a1", LATER_PAST)], [cell("a1")])).toEqual({
      onTime: 1,
      submitted: 1,
      due: 1,
    });
  });

  it("counts late work as due and not on time", () => {
    expect(onTimeOf([assignment("a1", PAST)], [cell("a1", { submittedAt: LATER_PAST })])).toEqual({
      onTime: 0,
      submitted: 1,
      due: 1,
    });
  });

  it("counts work handed in by an agreed extension as on time", () => {
    expect(
      onTimeOf(
        [assignment("a1", PAST)],
        [cell("a1", { submittedAt: LATER_PAST, extendedDueAt: LATER_PAST })],
      ),
    ).toEqual({ onTime: 1, submitted: 1, due: 1 });
  });

  it("counts work never taken up as due and not on time", () => {
    expect(onTimeOf([assignment("a1", PAST)], [])).toEqual({ onTime: 0, submitted: 0, due: 1 });
  });

  it("counts accepted-but-not-handed-in work as due and not on time", () => {
    expect(
      onTimeOf([assignment("a1", PAST)], [cell("a1", { status: "ACCEPTED", submittedAt: null })]),
    ).toEqual({ onTime: 0, submitted: 0, due: 1 });
  });

  /*
    The one place the denominator is the fellow's rather than the class's: their deadline has not
    passed, so the assignment is not yet due for them.
  */
  it("leaves out work inside an unexpired extension with nothing handed in", () => {
    expect(
      onTimeOf(
        [assignment("a1", PAST)],
        [cell("a1", { status: "ACCEPTED", submittedAt: null, extendedDueAt: FUTURE })],
      ),
    ).toEqual({ onTime: 0, submitted: 0, due: 0 });
  });

  it("leaves out work whose deadline has not passed", () => {
    expect(onTimeOf([assignment("a1", FUTURE)], [])).toEqual({ onTime: 0, submitted: 0, due: 0 });
  });

  it("leaves out drafts and undated work", () => {
    expect(onTimeOf([assignment("a1", PAST, null), assignment("a2", null)], [])).toEqual({
      onTime: 0,
      submitted: 0,
      due: 0,
    });
  });

  it("gives every student asked about an entry", () => {
    const result = onTimeByStudent(["s1", "s2"], [assignment("a1", PAST)], [cell("a1")], AT);
    expect(result.get("s2")).toEqual({ onTime: 0, submitted: 0, due: 1 });
  });
});

describe("gradedCompletionByStudent", () => {
  /*
    The Completed share's own denominator: past due for the fellow, and either graded or never
    handed in. What is left out is exactly the work waiting on an instructor, so a fellow is never
    marked down for a grading queue.
  */
  const assignment = (
    id: string,
    dueAt: string | null,
    distributedAt: string | null = PAST,
  ): RecentAssignment => ({ id, dueAt, distributedAt });

  const cell = (assignmentId: string, overrides: Partial<RecentCell> = {}): RecentCell => ({
    assignmentId,
    studentId: "s1",
    status: "GRADED",
    submittedAt: PAST,
    extendedDueAt: null,
    isComplete: true,
    ...overrides,
  });

  const completionOf = (work: RecentAssignment[], cells: RecentCell[]) =>
    gradedCompletionByStudent(["s1"], work, cells, AT).get("s1");

  it("counts graded work, complete or not, however late it was handed in", () => {
    expect(
      completionOf(
        [assignment("a1", PAST), assignment("a2", PAST)],
        [cell("a1"), cell("a2", { isComplete: false, submittedAt: LATER_PAST })],
      ),
    ).toEqual({ complete: 1, possible: 2 });
  });

  it("leaves out work handed in and not yet graded", () => {
    expect(
      completionOf(
        [assignment("a1", PAST), assignment("a2", PAST)],
        [cell("a1"), cell("a2", { status: "SUBMITTED", isComplete: null })],
      ),
    ).toEqual({ complete: 1, possible: 1 });
  });

  it("counts work never handed in as incomplete", () => {
    expect(completionOf([assignment("a1", PAST)], [])).toEqual({ complete: 0, possible: 1 });
    expect(
      completionOf(
        [assignment("a1", PAST)],
        [cell("a1", { status: "ACCEPTED", isComplete: null })],
      ),
    ).toEqual({ complete: 0, possible: 1 });
  });

  it("leaves out work not yet due, inside an extension, undated, or a draft", () => {
    expect(
      completionOf(
        [
          assignment("a1", FUTURE),
          assignment("a2", PAST),
          assignment("a3", null),
          assignment("a4", PAST, null),
        ],
        [cell("a2", { status: "ACCEPTED", isComplete: null, extendedDueAt: FUTURE })],
      ),
    ).toEqual({ complete: 0, possible: 0 });
  });

  it("gives every student asked about an entry", () => {
    const result = gradedCompletionByStudent(
      ["s1", "s2"],
      [assignment("a1", PAST)],
      [cell("a1")],
      AT,
    );
    expect(result.get("s2")).toEqual({ complete: 0, possible: 1 });
  });
});

describe("meetingShares", () => {
  /*
    The tiles above the grid: of the fellows with a figure in a column, how many are not red there.
    A fellow the rule has not read is in neither number.
  */
  const standing = (overrides: Partial<Standing> = {}): Standing => ({
    bucket: "exceeding",
    onTime: { onTime: 9, submitted: 10, due: 10 },
    completion: { MODULE: { complete: 8, possible: 10 } },
    recentlyGraded: { complete: 0, graded: 0 },
    flags: [],
    ...overrides,
  });

  const rows = [
    // Green or yellow everywhere.
    { attendance: { rate: 0.95, recent: quiet }, standing: standing() },
    // Red on the term shares, and absent lately.
    {
      attendance: { rate: 0.6, recent: { ...quiet, missed: 3 } },
      standing: standing({
        onTime: { onTime: 2, submitted: 5, due: 10 },
        completion: { MODULE: { complete: 1, possible: 4 } },
      }),
    },
    // Too early on every count: nothing to read.
    {
      attendance: { rate: null, recent: null },
      standing: standing({ onTime: null, completion: {} }),
    },
  ];

  it("counts the fellows not red in each column, of those with a figure", () => {
    const byKey = Object.fromEntries(meetingShares(rows, ["MODULE"]).map((s) => [s.key, s]));
    expect(byKey.attendance).toMatchObject({ meeting: 1, counted: 2 });
    expect(byKey.absence).toMatchObject({ meeting: 1, counted: 2 });
    expect(byKey.tardiness).toMatchObject({ meeting: 2, counted: 2 });
    expect(byKey.onTime).toMatchObject({ meeting: 1, counted: 2 });
    expect(byKey.submitted).toMatchObject({ meeting: 1, counted: 2 });
    expect(byKey["completion:MODULE"]).toMatchObject({
      title: "Graded Assignments Completed",
      meeting: 1,
      counted: 2,
    });
  });

  it("makes one Completed tile per kind of work given", () => {
    expect(meetingShares(rows, ["MODULE", "PROJECT"]).map((s) => s.key)).toEqual([
      "attendance",
      "absence",
      "tardiness",
      "onTime",
      "submitted",
      "completion:MODULE",
      "completion:PROJECT",
    ]);
  });

  it("lists only the chosen measures' columns, in the same order", () => {
    const chosen = new Set<Measure>(["attendance", "completion"]);
    expect(meetingShares(rows, ["MODULE"], chosen).map((s) => s.key)).toEqual([
      "attendance",
      "absence",
      "tardiness",
      "completion:MODULE",
    ]);
  });
});

describe("defaultCourseIds", () => {
  const running = { id: "fundamentals", archived: false };
  const finished = { id: "prework", archived: true };

  it("reads the courses still running", () => {
    expect([...defaultCourseIds([finished, running], false)]).toEqual(["fundamentals"]);
  });

  it("reads every course once the program is archived", () => {
    expect([...defaultCourseIds([finished, running], true)].sort()).toEqual([
      "fundamentals",
      "prework",
    ]);
  });

  it("reads every course when every course is archived, rather than none", () => {
    expect([...defaultCourseIds([finished], false)]).toEqual(["prework"]);
  });
});

describe("shownCourseIds", () => {
  const courses = [
    { id: "c1", archived: false },
    { id: "c2", archived: false },
    { id: "c3", archived: true },
  ];

  it("reads the default when the address names none", () => {
    expect([...shownCourseIds(null, courses, false)]).toEqual(["c1", "c2"]);
  });

  it("shows the courses the address names, archived ones included", () => {
    expect([...shownCourseIds("c3,c1", courses, false)].sort()).toEqual(["c1", "c3"]);
  });

  it("ignores an id that names no course of this program", () => {
    expect([...shownCourseIds("c2,elsewhere", courses, false)]).toEqual(["c2"]);
  });

  it("shows none when the address names none of them", () => {
    expect(shownCourseIds("", courses, false).size).toBe(0);
  });
});

describe("standingAcross", () => {
  const prework = { id: "prework", name: "Prework" };
  const fundamentals = { id: "fundamentals", name: "Web Fundamentals" };

  const readings: Record<string, CourseStanding> = {
    // A course that ended badly: most deadlines missed, and red for it.
    prework: {
      onTime: { onTime: 2, submitted: 4, due: 10 },
      completion: { MODULE: { complete: 3, possible: 10 } },
      recent: { ...steady, missed: 6, late: 2, incomplete: 1, graded: 4 },
    },
    // A course going well.
    fundamentals: {
      onTime: { onTime: 10, submitted: 10, due: 10 },
      completion: { MODULE: { complete: 9, possible: 10 }, PROJECT: { complete: 1, possible: 1 } },
      recent: steady,
    },
  };
  const here = { rate: 0.95, recent: quiet };

  it("sums every course given", () => {
    const standing = standingAcross(here, [prework, fundamentals], readings);
    expect(standing.onTime).toEqual({ onTime: 12, submitted: 14, due: 20 });
    expect(standing.completion).toEqual({
      MODULE: { complete: 12, possible: 20 },
      PROJECT: { complete: 1, possible: 1 },
    });
    expect(standing.recentlyGraded).toEqual({ complete: 8, graded: 9 });
  });

  it("carries each course's windows as flags, named by course", () => {
    expect(standingAcross(here, [prework, fundamentals], readings).flags).toEqual([
      {
        kind: "work",
        courseId: "prework",
        courseName: "Prework",
        reason: "deadlines",
        band: "red",
      },
      {
        kind: "work",
        courseId: "prework",
        courseName: "Prework",
        reason: "falling-short",
        band: "yellow",
      },
    ]);
  });

  /*
    The case the filter exists for: one past course is the only reason a fellow needs support, and
    leaving it out reads them against the rest.
  */
  it("a fellow held back only by one course moves when it is left out", () => {
    expect(standingAcross(here, [prework, fundamentals], readings).bucket).toBe("needs-support");
    expect(standingAcross(here, [fundamentals], readings).bucket).toBe("exceeding");
  });

  /*
    Two deadlines slipped in each of two courses is one small slip twice: the windows are banded
    per course and never added into a rule, so no course is red and the fellow is meeting.
  */
  it("a small slip in each of two courses is meeting, not needs support", () => {
    const slipped: Record<string, CourseStanding> = {
      prework: { ...readings.fundamentals!, recent: { ...steady, missed: 2 } },
      fundamentals: { ...readings.fundamentals!, recent: { ...steady, missed: 1, late: 1 } },
    };
    const standing = standingAcross(here, [prework, fundamentals], slipped);
    expect(standing.flags.map((flag) => flag.band)).toEqual(["yellow", "yellow"]);
    expect(standing.bucket).toBe("meeting");
  });

  it("keeps an attendance flag whichever courses are shown", () => {
    const late = { rate: 1, recent: { ...quiet, late: 3 } };
    expect(standingAcross(late, [fundamentals], readings).flags).toEqual([
      { kind: "attendance", reason: "late", band: "red" },
    ]);
    expect(standingAcross(late, [fundamentals], readings).bucket).toBe("needs-support");
  });

  it("is too early to say when nothing in the shown courses has come due", () => {
    const standing = standingAcross(here, [], readings);
    expect(standing.onTime).toBeNull();
    expect(standing.bucket).toBe("too-early");
  });

  /*
    The worst-first order counts flags by colour, so a flag of a measure left out is dropped with
    its colour rather than carried along to push the fellow up a group.
  */
  it("keeps only the chosen measures' flags, and places the fellow by them", () => {
    const late = { rate: 1, recent: { ...quiet, late: 3 } };
    const standing = standingAcross(
      late,
      [prework, fundamentals],
      readings,
      new Set<Measure>(["attendance", "completion"]),
    );
    expect(standing.flags).toEqual([
      { kind: "attendance", reason: "late", band: "red" },
      {
        kind: "work",
        courseId: "prework",
        courseName: "Prework",
        reason: "falling-short",
        band: "yellow",
      },
    ]);
    // Prework's red term shares are deadlines and submissions, and neither is read.
    expect(
      standingAcross(here, [prework, fundamentals], readings, new Set<Measure>(["attendance"]))
        .bucket,
    ).toBe("exceeding");
  });
});
