import {
  onTimeByStudent,
  defaultCourseIds,
  shownCourseIds,
  standingAcross,
  type CourseStanding,
  performanceBucket,
  performanceFlagLabel,
  PERFORMANCE_RULE,
  type PerformanceFlag,
  type PerformanceReading,
} from "@/lib/programs/performance";
import type { RecentAssignment, RecentCell } from "@/lib/gradebook/summary";

/**
 * The roster's Performance rule.
 *
 * What these protect is the promise the tab makes to the instructor reading it: that a fellow in
 * exceeding is on time, here, and has nothing flagged this fortnight, and that anybody with a flag
 * is in needs support however good their term has been.
 */

const AT = new Date("2026-10-15T12:00:00Z");
const PAST = "2026-10-01T12:00:00Z";
const LATER_PAST = "2026-10-10T12:00:00Z";
const FUTURE = "2026-10-20T12:00:00Z";

function reading(overrides: Partial<PerformanceReading> = {}): PerformanceReading {
  return { onTime: { onTime: 10, due: 10 }, attendanceRate: 0.95, flags: [], ...overrides };
}

const workFlag: PerformanceFlag = {
  kind: "work",
  courseId: "c1",
  courseName: "Web Fundamentals",
  reason: "deadlines",
};
const attendanceFlag: PerformanceFlag = { kind: "attendance", reason: "late" };

describe("performanceBucket", () => {
  it("a fellow on time, here, and unflagged exceeds", () => {
    expect(performanceBucket(reading())).toBe("exceeding");
  });

  it("exceeding begins at the attendance threshold itself", () => {
    expect(
      performanceBucket(reading({ attendanceRate: PERFORMANCE_RULE.exceedingAttendanceAtLeast })),
    ).toBe("exceeding");
  });

  it("just under the exceeding attendance is meeting", () => {
    expect(performanceBucket(reading({ attendanceRate: 0.89 }))).toBe("meeting");
  });

  it("meeting begins at its own attendance threshold", () => {
    expect(
      performanceBucket(reading({ attendanceRate: PERFORMANCE_RULE.meetingAttendanceAtLeast })),
    ).toBe("meeting");
  });

  it("below the meeting attendance needs support", () => {
    expect(performanceBucket(reading({ attendanceRate: 0.79 }))).toBe("needs-support");
  });

  it("nine of ten on time is still the bar", () => {
    expect(performanceBucket(reading({ onTime: { onTime: 9, due: 10 } }))).toBe("exceeding");
  });

  it("eight of ten on time needs support, however good attendance is", () => {
    expect(performanceBucket(reading({ onTime: { onTime: 8, due: 10 }, attendanceRate: 1 }))).toBe(
      "needs-support",
    );
  });

  /*
    The case the rule is shaped around: a fellow whose term is excellent and whose fortnight is not.
  */
  it("a work flag needs support even with a perfect term", () => {
    expect(performanceBucket(reading({ attendanceRate: 1, flags: [workFlag] }))).toBe(
      "needs-support",
    );
  });

  it("an attendance flag needs support even at 95 percent", () => {
    expect(performanceBucket(reading({ flags: [attendanceFlag] }))).toBe("needs-support");
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

describe("performanceFlagLabel", () => {
  it("names the course for a work flag", () => {
    expect(performanceFlagLabel(workFlag)).toBe("Missing deadlines · Web Fundamentals");
  });

  it("uses the attendance screen's own words for an attendance flag", () => {
    expect(performanceFlagLabel(attendanceFlag)).toBe("Arriving late");
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
    expect(onTimeOf([assignment("a1", LATER_PAST)], [cell("a1")])).toEqual({ onTime: 1, due: 1 });
  });

  it("counts late work as due and not on time", () => {
    expect(onTimeOf([assignment("a1", PAST)], [cell("a1", { submittedAt: LATER_PAST })])).toEqual({
      onTime: 0,
      due: 1,
    });
  });

  it("counts work handed in by an agreed extension as on time", () => {
    expect(
      onTimeOf(
        [assignment("a1", PAST)],
        [cell("a1", { submittedAt: LATER_PAST, extendedDueAt: LATER_PAST })],
      ),
    ).toEqual({ onTime: 1, due: 1 });
  });

  it("counts work never taken up as due and not on time", () => {
    expect(onTimeOf([assignment("a1", PAST)], [])).toEqual({ onTime: 0, due: 1 });
  });

  it("counts accepted-but-not-handed-in work as due and not on time", () => {
    expect(
      onTimeOf([assignment("a1", PAST)], [cell("a1", { status: "ACCEPTED", submittedAt: null })]),
    ).toEqual({ onTime: 0, due: 1 });
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
    ).toEqual({ onTime: 0, due: 0 });
  });

  it("leaves out work whose deadline has not passed", () => {
    expect(onTimeOf([assignment("a1", FUTURE)], [])).toEqual({ onTime: 0, due: 0 });
  });

  it("leaves out drafts and undated work", () => {
    expect(onTimeOf([assignment("a1", PAST, null), assignment("a2", null)], [])).toEqual({
      onTime: 0,
      due: 0,
    });
  });

  it("gives every student asked about an entry", () => {
    const result = onTimeByStudent(["s1", "s2"], [assignment("a1", PAST)], [cell("a1")], AT);
    expect(result.get("s2")).toEqual({ onTime: 0, due: 1 });
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
    // A course that ended badly: most deadlines missed, and flagged for it.
    prework: {
      onTime: { onTime: 2, due: 10 },
      completion: { MODULE: { complete: 3, possible: 10 } },
      reasons: ["deadlines"],
    },
    // A course going well.
    fundamentals: {
      onTime: { onTime: 10, due: 10 },
      completion: { MODULE: { complete: 8, possible: 10 }, PROJECT: { complete: 1, possible: 1 } },
      reasons: [],
    },
  };
  const here = { rate: 0.95, reason: null };

  it("sums every course given", () => {
    const standing = standingAcross(here, [prework, fundamentals], readings);
    expect(standing.onTime).toEqual({ onTime: 12, due: 20 });
    expect(standing.completion).toEqual({
      MODULE: { complete: 11, possible: 20 },
      PROJECT: { complete: 1, possible: 1 },
    });
  });

  it("carries each course's flags, named by course", () => {
    expect(standingAcross(here, [prework, fundamentals], readings).flags).toEqual([
      { kind: "work", courseId: "prework", courseName: "Prework", reason: "deadlines" },
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

  it("keeps an attendance flag whichever courses are shown", () => {
    const late = { rate: 1, reason: "late" as const };
    expect(standingAcross(late, [fundamentals], readings).flags).toEqual([
      { kind: "attendance", reason: "late" },
    ]);
    expect(standingAcross(late, [fundamentals], readings).bucket).toBe("needs-support");
  });

  it("is too early to say when nothing in the shown courses has come due", () => {
    const standing = standingAcross(here, [], readings);
    expect(standing.onTime).toBeNull();
    expect(standing.bucket).toBe("too-early");
  });
});
