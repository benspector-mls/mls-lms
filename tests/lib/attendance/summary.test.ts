import {
  attendanceDriftReason,
  countsAsAttended,
  dailyRates,
  DEFAULT_TERM_SORT,
  recentAttendance,
  recentSessionsFrom,
  sortSummaries,
  summarize,
  termAverages,
  termRate,
  toggleTermSort,
  type FellowSummary,
  type SummaryFellow,
  type SummaryRecord,
  type SummarySession,
  type TermSort,
} from "@/lib/attendance/summary";
import type { RecentWindow } from "@/lib/recent-window";

/** A window wide enough to hold every session a test makes. */
const ANY_TIME: RecentWindow = { from: "2000-01-01", to: "2099-12-31" };

/**
 * A term reduced to a rate and a recent window.
 *
 * Three rules are the reason this is a tested function rather than arithmetic on a screen, and
 * each of them is a way to publish a wrong number: excused still counts as missed, a fellow is
 * only measured against sessions they were enrolled for, and test students are in no figure.
 */

function sessions(count: number, openTail = 0): SummarySession[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    // Sequential September days. Only the ordering and the comparison against `enrolledFrom`
    // matter, so consecutive dates are enough.
    day: `2026-09-${String(index + 1).padStart(2, "0")}`,
    unsettled: index >= count - openTail,
  }));
}

function fellow(overrides: Partial<SummaryFellow> = {}): SummaryFellow {
  return {
    enrollmentId: "e1",
    studentId: "p1",
    displayName: "Ada",
    email: "ada@example.com",
    githubUsername: "ada",
    testStudentNumber: null,
    enrolledFrom: "2026-09-01",
    ...overrides,
  };
}

function marks(statuses: (SummaryRecord["status"] | null)[], enrollmentId = "e1"): SummaryRecord[] {
  return statuses.flatMap((status, index) =>
    status === null ? [] : [{ enrollmentId, sessionId: `s${index + 1}`, status }],
  );
}

describe("countsAsAttended", () => {
  it("counts present and late, and not excused", () => {
    expect(countsAsAttended("PRESENT")).toBe(true);
    expect(countsAsAttended("LATE")).toBe(true);
    // The decision the user made, and the one most likely to be quietly reversed by a later
    // edit: an excusal explains a missed session rather than undoing it.
    expect(countsAsAttended("EXCUSED")).toBe(false);
    expect(countsAsAttended("ABSENT")).toBe(false);
  });
});

describe("summarize", () => {
  it("counts a straightforward term", () => {
    const [summary] = summarize(
      sessions(4),
      [fellow()],
      marks(["PRESENT", "LATE", "EXCUSED", "ABSENT"]),
    );

    expect(summary.eligible).toBe(4);
    expect(summary.present).toBe(1);
    expect(summary.late).toBe(1);
    expect(summary.excused).toBe(1);
    expect(summary.absent).toBe(1);
    // Two of four: excused is in the denominator and out of the numerator.
    expect(summary.rate).toBe(0.5);
  });

  it("counts a session with no record at all as missed, and reports it apart", () => {
    const [summary] = summarize(sessions(2), [fellow()], marks(["PRESENT", null]));

    expect(summary.unrecorded).toBe(1);
    expect(summary.eligible).toBe(2);
    expect(summary.rate).toBe(0.5);
  });

  /*
    The case pure derivation gets wrong, and the reason `enrolledFrom` exists. A fellow who joined
    in week three has not missed weeks one and two — they were not admitted to them — and counting
    those would put a real, wrong number in a report somebody is paid against.
  */
  it("does not count sessions from before a fellow enrolled", () => {
    const [summary] = summarize(
      sessions(4),
      [fellow({ enrolledFrom: "2026-09-03" })],
      marks([null, null, "PRESENT", "PRESENT"]),
    );

    expect(summary.eligible).toBe(2);
    expect(summary.rate).toBe(1);
    // The grid still draws four cells; the first two say "not enrolled" rather than "absent".
    expect(summary.cells).toEqual([null, null, "PRESENT", "PRESENT"]);
  });

  it("leaves an open session out of the rate for a fellow who has no record in it", () => {
    const [summary] = summarize(sessions(3, 1), [fellow()], marks(["PRESENT", "PRESENT"]));

    // Three sessions, one still running. Nobody is absent from a day still in progress.
    expect(summary.eligible).toBe(2);
    expect(summary.rate).toBe(1);
    expect(summary.cells).toHaveLength(3);
  });

  /*
    The other half of the same rule, and the reason a fellow is not made to wait until the evening
    to see the day they have already checked into. Only a record makes an open session count, so
    this can raise a rate and can never lower one.
  */
  it("counts an open session for a fellow already marked in it", () => {
    const [summary] = summarize(
      sessions(3, 1),
      [fellow()],
      marks(["PRESENT", "PRESENT", "PRESENT"]),
    );

    expect(summary.eligible).toBe(3);
    expect(summary.present).toBe(3);
    expect(summary.rate).toBe(1);
  });

  it("counts a late check-in in an open session too, and does not invent an absence beside it", () => {
    const [summary] = summarize(sessions(2, 1), [fellow()], marks(["PRESENT", "LATE"]));

    expect(summary.eligible).toBe(2);
    expect(summary.late).toBe(1);
    expect(summary.unrecorded).toBe(0);
  });

  it("has no rate at all before anything has closed", () => {
    const [summary] = summarize(sessions(2, 2), [fellow()], []);
    expect(summary.eligible).toBe(0);
    expect(summary.rate).toBeNull();
  });

  it("summarizes a test student rather than dropping them, so the grid can draw them", () => {
    const [summary] = summarize(
      sessions(2),
      [fellow({ testStudentNumber: 1 })],
      marks(["PRESENT", "PRESENT"]),
    );
    expect(summary.rate).toBe(1);
  });
});

describe("a day that has not happened yet", () => {
  /*
    The failure this guards against is the one the date-range schedule introduced: a program that
    declares nine months of meeting days has a session row for every one of them from the day the
    schedule is saved. Counting an unsettled session as missed would drop every fellow's rate to
    a few percent the moment their instructor filled in the settings screen.
  */
  const fellows = [fellow()];

  it("counts for nobody who has no record in it", () => {
    const [summary] = summarize(
      [
        { id: "past", day: "2026-09-07", unsettled: false },
        { id: "ahead", day: "2026-12-07", unsettled: true },
      ],
      fellows,
      [{ enrollmentId: "e1", sessionId: "past", status: "PRESENT" }],
    );

    expect(summary.eligible).toBe(1);
    expect(summary.rate).toBe(1);
    expect(summary.unrecorded).toBe(0);
  });

  // An instructor can excuse somebody ahead of time, and the moment they do the day is settled
  // for that fellow — the same rule an open session already follows.
  it("counts once a record exists", () => {
    const [summary] = summarize([{ id: "ahead", day: "2026-12-07", unsettled: true }], fellows, [
      { enrollmentId: "e1", sessionId: "ahead", status: "EXCUSED" },
    ]);

    expect(summary.eligible).toBe(1);
    expect(summary.excused).toBe(1);
    expect(summary.rate).toBe(0);
  });

  // The drift rule reads the last few settled days. A term of days ahead must not push every real
  // morning out of that window.
  it("is outside the drift window", () => {
    const settled: SummarySession[] = Array.from({ length: 5 }, (_, index) => ({
      id: `d${index + 1}`,
      day: `2026-09-0${index + 1}`,
      unsettled: false,
    }));
    const ahead: SummarySession[] = Array.from({ length: 5 }, (_, index) => ({
      id: `ahead${index + 1}`,
      day: `2026-12-0${index + 1}`,
      unsettled: true,
    }));
    const all = [...settled, ...ahead];

    const summaries = summarize(all, fellows, [
      { enrollmentId: "e1", sessionId: "d1", status: "ABSENT" },
      { enrollmentId: "e1", sessionId: "d2", status: "ABSENT" },
      { enrollmentId: "e1", sessionId: "d3", status: "ABSENT" },
      { enrollmentId: "e1", sessionId: "d4", status: "PRESENT" },
      { enrollmentId: "e1", sessionId: "d5", status: "PRESENT" },
    ]);

    expect(attendanceDriftReason(recentAttendance(summaries[0], all, ANY_TIME))).toBe("missing");
  });
});

describe("dailyRates", () => {
  /*
    The figure at the head of each column of the term grid. Computed from the same summaries the
    grid draws its letters from, so the number above a column and the letters under it cannot
    disagree — which they would the moment a second implementation counted a null cell differently.
  */
  const day1 = { id: "s1", day: "2026-09-07", unsettled: false };
  const day2 = { id: "s2", day: "2026-09-08", unsettled: false };

  function summariesFor(records: SummaryRecord[], fellows: SummaryFellow[]) {
    return summarize([day1, day2], fellows, records);
  }

  const ada = fellow({ enrollmentId: "e1", studentId: "p1" });
  const bo = fellow({ enrollmentId: "e2", studentId: "p2", displayName: "Bo" });

  it("is attended over enrolled, per day", () => {
    const rates = dailyRates(
      [day1, day2],
      summariesFor(
        [
          { enrollmentId: "e1", sessionId: "s1", status: "PRESENT" },
          { enrollmentId: "e2", sessionId: "s1", status: "ABSENT" },
          { enrollmentId: "e1", sessionId: "s2", status: "PRESENT" },
          { enrollmentId: "e2", sessionId: "s2", status: "LATE" },
        ],
        [ada, bo],
      ),
    );

    expect(rates).toEqual([0.5, 1]);
  });

  // The same rule the rate beside each fellow uses: late is attendance, excused is not.
  it("counts late as attended and excused as missed", () => {
    const rates = dailyRates(
      [day1, day2],
      summariesFor(
        [
          { enrollmentId: "e1", sessionId: "s1", status: "LATE" },
          { enrollmentId: "e1", sessionId: "s2", status: "EXCUSED" },
        ],
        [ada],
      ),
    );

    expect(rates).toEqual([1, 0]);
  });

  // A fellow with no record on a settled day missed it. That is what ending a session writes.
  it("counts a fellow with no record as missing the day", () => {
    const rates = dailyRates([day1], summariesFor([], [ada, bo]));
    expect(rates).toEqual([0]);
  });

  // Somebody who joined on the 8th cannot have missed the 7th, so they are in neither half of it.
  it("leaves a fellow out of the days before they enrolled", () => {
    const joinedLate = fellow({
      enrollmentId: "e2",
      studentId: "p2",
      enrolledFrom: "2026-09-08",
    });

    const rates = dailyRates(
      [day1, day2],
      summariesFor(
        [
          { enrollmentId: "e1", sessionId: "s1", status: "PRESENT" },
          { enrollmentId: "e1", sessionId: "s2", status: "PRESENT" },
          { enrollmentId: "e2", sessionId: "s2", status: "ABSENT" },
        ],
        [ada, joinedLate],
      ),
    );

    // The 7th is one of one; the 8th is one of two.
    expect(rates).toEqual([1, 0.5]);
  });

  // Every other figure on the screen leaves them out, and a column heading that did not would be
  // the one number on the page that disagreed with the rest.
  it("leaves test students out", () => {
    const tester = fellow({ enrollmentId: "e2", studentId: "p2", testStudentNumber: 1 });

    const rates = dailyRates(
      [day1],
      summariesFor(
        [
          { enrollmentId: "e1", sessionId: "s1", status: "PRESENT" },
          { enrollmentId: "e2", sessionId: "s1", status: "ABSENT" },
        ],
        [ada, tester],
      ),
    );

    expect(rates).toEqual([1]);
  });

  /*
    Nothing is settled on a day still running or still to come, so there is no rate to print. The
    grid prints a dash, the same as it does for a fellow whose own rate has no denominator yet.
  */
  it("has no figure for a day that is not settled", () => {
    const ahead = { id: "s3", day: "2026-12-07", unsettled: true };
    const rates = dailyRates(
      [ahead],
      summarize([ahead], [ada], [{ enrollmentId: "e1", sessionId: "s3", status: "PRESENT" }]),
    );

    expect(rates).toEqual([null]);
  });

  it("has no figure for a day nobody was enrolled for", () => {
    const early = fellow({ enrolledFrom: "2027-01-01" });
    expect(dailyRates([day1], summariesFor([], [early]))).toEqual([null]);
  });
});

/**
 * The window behind the drift rule, for one fellow whether or not they trip it. What these protect
 * is that the window is the cohort's days narrowed to the fellow, so a fellow who joined last week
 * is measured over fewer mornings rather than charged with the days before.
 */
describe("recentAttendance", () => {
  const term = sessions(12, 2);

  it("reads the settled mornings inside the window, leaving open ones and others out", () => {
    const longer = sessions(13, 2);
    const [summary] = summarize(
      longer,
      [fellow()],
      marks([
        "ABSENT", // the 1st, before the window
        "ABSENT",
        "PRESENT",
        "PRESENT",
        "PRESENT",
        "LATE",
        "PRESENT",
        "PRESENT",
        "LATE",
        "ABSENT",
        "PRESENT",
        null, // open
        null, // open
      ]),
    );

    expect(recentAttendance(summary, longer, { from: "2026-09-02", to: "2026-09-13" })).toEqual({
      missed: 2,
      missedOf: 10,
      late: 2,
      lateOf: 10,
      excused: 0,
    });
  });

  // An excused morning is still a missed one. The count beside it says how many had a reason.
  it("counts how many of the missed mornings were excused", () => {
    const [summary] = summarize(
      term,
      [fellow()],
      marks([
        "PRESENT",
        "PRESENT",
        "EXCUSED",
        "PRESENT",
        "ABSENT",
        "PRESENT",
        "EXCUSED",
        "PRESENT",
        "PRESENT",
        "PRESENT",
        null,
        null,
      ]),
    );

    expect(recentAttendance(summary, term, ANY_TIME)).toEqual({
      missed: 3,
      missedOf: 10,
      late: 0,
      lateOf: 10,
      excused: 2,
    });
  });

  it("narrows the window to the mornings since a fellow joined", () => {
    const [summary] = summarize(
      term,
      [fellow({ enrolledFrom: "2026-09-08" })],
      marks([null, null, null, null, null, null, null, "PRESENT", "ABSENT", "PRESENT"]),
    );

    expect(recentAttendance(summary, term, ANY_TIME)).toEqual({
      missed: 1,
      missedOf: 3,
      late: 0,
      lateOf: 3,
      excused: 0,
    });
  });

  it("is empty over a window with no settled mornings, such as a break", () => {
    const [summary] = summarize(term, [fellow()], marks(["PRESENT"]));
    expect(recentAttendance(summary, term, { from: "2026-10-01", to: "2026-10-14" })).toEqual({
      missed: 0,
      missedOf: 0,
      late: 0,
      lateOf: 0,
      excused: 0,
    });
  });

  it("names the clause the rule trips, and nothing when neither applies", () => {
    const recent = (missed: number, late: number) => ({
      missed,
      missedOf: 10,
      late,
      lateOf: 10,
      excused: 0,
    });
    // Under 75 percent attended is missing; under 75 percent on time is late; missing outranks.
    expect(attendanceDriftReason(recent(3, 0))).toBe("missing");
    expect(attendanceDriftReason(recent(2, 3))).toBe("late");
    expect(attendanceDriftReason(recent(3, 3))).toBe("missing");
    expect(attendanceDriftReason(recent(2, 2))).toBeNull();
    // An empty window trips nothing, and neither does one under the minimum.
    expect(attendanceDriftReason({ ...recent(0, 0), missedOf: 0, lateOf: 0 })).toBeNull();
    expect(attendanceDriftReason({ ...recent(3, 3), missedOf: 3, lateOf: 3 })).toBeNull();
    expect(attendanceDriftReason({ ...recent(4, 4), missedOf: 4, lateOf: 4 })).toBe("missing");
  });
});

describe("recentSessionsFrom", () => {
  const at = (days: string[]): SummarySession[] =>
    days.map((day, index) => ({ id: `s${index + 1}`, day, unsettled: false }));

  it("starts at the Monday of the week before the latest session's week", () => {
    // 2026-10-08 is a Thursday; its week starts Monday the 5th, the week before on the 28th.
    const sessions = at(["2026-09-21", "2026-09-25", "2026-09-28", "2026-10-01", "2026-10-08"]);
    expect(recentSessionsFrom(sessions)).toBe(2);
  });

  it("is zero when every session is within the last two weeks", () => {
    expect(recentSessionsFrom(at(["2026-10-05", "2026-10-08"]))).toBe(0);
  });

  it("is zero with no sessions", () => {
    expect(recentSessionsFrom([])).toBe(0);
  });

  it("counts from the latest session rather than from today, so a break still shows a fortnight", () => {
    const sessions = at(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"]);
    // The 22nd is a Monday; the week before starts on the 15th.
    expect(recentSessionsFrom(sessions)).toBe(2);
  });
});

describe("termRate", () => {
  /*
    The one figure at the head of the Rate column. Summed over the roster rather than averaged over
    the fellows' rates, so a fellow with four eligible mornings does not weigh as much as one with
    sixty.
  */
  const day1 = { id: "s1", day: "2026-09-07", unsettled: false };
  const day2 = { id: "s2", day: "2026-09-08", unsettled: false };
  const day3 = { id: "s3", day: "2026-09-09", unsettled: false };

  it("is attended over eligible, summed across the roster", () => {
    const ada = fellow({ enrollmentId: "e1", studentId: "p1" });
    // Enrolled for the last day only: one eligible morning against Ada's three.
    const bo = fellow({
      enrollmentId: "e2",
      studentId: "p2",
      displayName: "Bo",
      enrolledFrom: "2026-09-09",
    });
    const summaries = summarize(
      [day1, day2, day3],
      [ada, bo],
      [
        { enrollmentId: "e1", sessionId: "s1", status: "PRESENT" },
        { enrollmentId: "e1", sessionId: "s2", status: "LATE" },
        { enrollmentId: "e1", sessionId: "s3", status: "EXCUSED" },
        { enrollmentId: "e2", sessionId: "s3", status: "ABSENT" },
      ],
    );

    // Ada 2 of 3, Bo 0 of 1: 2 of 4 pooled, where a mean of the two rates would say 1 of 3.
    expect(termRate(summaries)).toEqual({ eligible: 4, attended: 2, rate: 0.5 });
  });

  it("leaves test students out, and is null before anything is settled", () => {
    const ada = fellow({ enrollmentId: "e1", studentId: "p1" });
    const tester = fellow({
      enrollmentId: "e2",
      studentId: "p2",
      displayName: "Test",
      testStudentNumber: 1,
    });
    const summaries = summarize(
      [day1],
      [ada, tester],
      [
        { enrollmentId: "e1", sessionId: "s1", status: "ABSENT" },
        { enrollmentId: "e2", sessionId: "s1", status: "PRESENT" },
      ],
    );
    expect(termRate(summaries)).toEqual({ eligible: 1, attended: 0, rate: 0 });

    expect(termRate(summarize([{ ...day1, unsettled: true }], [ada], []))).toEqual({
      eligible: 0,
      attended: 0,
      rate: null,
    });
  });
});

describe("termAverages", () => {
  /*
    The figure at the head of each of the other five columns. The counts are a mean per fellow who
    has an eligible session; the arrival is one mean over every check-in, so a fellow whose average
    stands on three mornings does not weigh as much as one whose average stands on fifty.
  */
  const day1 = { id: "s1", day: "2026-09-07", unsettled: false };
  const day2 = { id: "s2", day: "2026-09-08", unsettled: false };

  const ada = fellow({ enrollmentId: "e1", studentId: "p1" });
  const bo = fellow({ enrollmentId: "e2", studentId: "p2", displayName: "Bo" });
  // Enrolled for nothing settled yet: zero of everything, and out of every mean.
  const newcomer = fellow({
    enrollmentId: "e3",
    studentId: "p3",
    displayName: "New",
    enrolledFrom: "2026-09-09",
  });
  const tester = fellow({
    enrollmentId: "e4",
    studentId: "p4",
    displayName: "Test",
    testStudentNumber: 1,
  });

  const summaries = summarize(
    [day1, day2],
    [ada, bo, newcomer, tester],
    [
      { enrollmentId: "e1", sessionId: "s1", status: "PRESENT" },
      { enrollmentId: "e1", sessionId: "s2", status: "LATE" },
      { enrollmentId: "e2", sessionId: "s1", status: "EXCUSED" },
      // Bo's second morning is unrecorded, which the Absent column prints as an absence.
      { enrollmentId: "e4", sessionId: "s1", status: "PRESENT" },
      { enrollmentId: "e4", sessionId: "s2", status: "PRESENT" },
    ],
  );

  it("means the counts per fellow with an eligible session", () => {
    const averages = termAverages(summaries, () => null);
    expect(averages.fellows).toBe(2);
    expect(averages.present).toBe(0.5);
    expect(averages.late).toBe(0.5);
    expect(averages.excused).toBe(0.5);
    expect(averages.absent).toBe(0.5);
    expect(averages.arrival).toEqual({ minutes: null, fellows: 0 });
  });

  it("means the arrival times the column prints, leaving out the dashes and the test student", () => {
    const arrivalsByEnrollment: Record<string, number | null> = {
      e1: 540,
      e2: 600,
      e3: null,
      e4: 700,
    };
    const averages = termAverages(
      summaries,
      (summary) => arrivalsByEnrollment[summary.fellow.enrollmentId] ?? null,
    );
    expect(averages.arrival).toEqual({ minutes: 570, fellows: 2 });
  });

  it("is dashes when nobody is counted", () => {
    expect(termAverages([], () => null)).toEqual({
      fellows: 0,
      present: null,
      late: null,
      excused: null,
      absent: null,
      arrival: { minutes: null, fellows: 0 },
    });
  });
});

describe("sortSummaries", () => {
  function row(
    name: string,
    counts: Partial<Pick<FellowSummary, "present" | "late" | "excused" | "absent" | "unrecorded">>,
    overrides: Partial<SummaryFellow> = {},
  ): FellowSummary {
    const summary: FellowSummary = {
      fellow: fellow({ enrollmentId: name, studentId: name, displayName: name, ...overrides }),
      eligible: 0,
      present: 0,
      late: 0,
      excused: 0,
      absent: 0,
      unrecorded: 0,
      rate: null,
      cells: [],
      ...counts,
    };
    summary.eligible =
      summary.present + summary.late + summary.excused + summary.absent + summary.unrecorded;
    if (summary.eligible > 0) summary.rate = (summary.present + summary.late) / summary.eligible;
    return summary;
  }

  const rows = [
    row("Dev", { present: 2, absent: 2 }), // 50%
    row("Bea", { present: 4 }), // 100%
    row("Cara", { present: 1, late: 2, unrecorded: 1 }), // 75%, absent column reads 1
    row("Ada", {}), // nothing eligible yet: no rate
    row("Test", { present: 4 }, { testStudentNumber: 1 }), // a dash on screen, whatever the rate
  ];
  const arrivals: Record<string, number | null> = { Dev: 600, Bea: 540, Cara: null, Ada: 630 };

  const order = (sort: TermSort) =>
    sortSummaries(rows, sort, {
      nameOf: (summary) => summary.fellow.displayName ?? "",
      arrivalOf: (summary) => arrivals[summary.fellow.enrollmentId] ?? null,
    }).map((summary) => summary.fellow.displayName);

  it("opens in name order", () => {
    expect(order(DEFAULT_TERM_SORT)).toEqual(["Ada", "Bea", "Cara", "Dev", "Test"]);
  });

  it("sorts rate lowest first, with the dashes last in both directions", () => {
    expect(order({ by: "rate", direction: "asc" })).toEqual(["Dev", "Cara", "Bea", "Ada", "Test"]);
    expect(order({ by: "rate", direction: "desc" })).toEqual(["Bea", "Cara", "Dev", "Ada", "Test"]);
  });

  it("sorts arrival with no-average rows last, and absent by what the column prints", () => {
    expect(order({ by: "arrives", direction: "desc" })).toEqual([
      "Ada",
      "Dev",
      "Bea",
      "Cara",
      "Test",
    ]);
    // Cara's one unrecorded morning prints as an absence, so she sorts between Dev and the rest.
    expect(order({ by: "absent", direction: "desc" })).toEqual([
      "Dev",
      "Cara",
      "Ada",
      "Bea",
      "Test",
    ]);
  });

  it("breaks ties by name", () => {
    expect(order({ by: "present", direction: "desc" })).toEqual([
      "Bea",
      "Test",
      "Dev",
      "Cara",
      "Ada",
    ]);
  });
});

describe("toggleTermSort", () => {
  it("reverses the same column and opens a new one its own way", () => {
    expect(toggleTermSort(DEFAULT_TERM_SORT, "name")).toEqual({ by: "name", direction: "desc" });
    expect(toggleTermSort(DEFAULT_TERM_SORT, "rate")).toEqual({ by: "rate", direction: "asc" });
    expect(toggleTermSort(DEFAULT_TERM_SORT, "arrives")).toEqual({
      by: "arrives",
      direction: "desc",
    });
    expect(toggleTermSort(DEFAULT_TERM_SORT, "late")).toEqual({ by: "late", direction: "desc" });
  });
});
