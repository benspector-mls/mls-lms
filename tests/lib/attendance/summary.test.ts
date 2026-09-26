import {
  attendanceDriftReason,
  programRate,
  countsAsAttended,
  dailyRates,
  driftList,
  DRIFT_RULE,
  recentAttendance,
  recentAttendanceSentence,
  summarize,
  type SummaryFellow,
  type SummaryRecord,
  type SummarySession,
} from "@/lib/attendance/summary";

/**
 * A term reduced to a rate and a short list.
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

describe("driftList", () => {
  const term = sessions(10);

  it("names a fellow who has missed enough of the recent sessions", () => {
    const drifting = driftList(
      summarize(
        term,
        [fellow()],
        marks([
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "ABSENT",
          "PRESENT",
          "ABSENT",
        ]),
      ),
      term,
    );

    expect(drifting).toHaveLength(1);
    expect(drifting[0].reason).toBe("missing");
    expect(drifting[0].missedRecently).toBe(DRIFT_RULE.missedAtLeast);
  });

  it("names a fellow who is repeatedly late even though they are always here", () => {
    const drifting = driftList(
      summarize(
        term,
        [fellow()],
        marks([
          "PRESENT",
          "PRESENT",
          "LATE",
          "PRESENT",
          "LATE",
          "PRESENT",
          "PRESENT",
          "LATE",
          "PRESENT",
          "PRESENT",
        ]),
      ),
      term,
    );

    expect(drifting).toHaveLength(1);
    expect(drifting[0].reason).toBe("late");
  });

  it("counts an excused absence towards drifting, since it is still a missed session", () => {
    const drifting = driftList(
      summarize(
        term,
        [fellow()],
        marks([
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "EXCUSED",
          "EXCUSED",
        ]),
      ),
      term,
    );

    expect(drifting).toHaveLength(1);
  });

  it("leaves alone somebody whose absences are all in the distant past", () => {
    // Cumulatively this fellow is at 60 percent, and they have been at every recent session. The
    // list is about who to call today, not about who has had a hard term.
    const drifting = driftList(
      summarize(
        term,
        [fellow()],
        marks([
          "ABSENT",
          "ABSENT",
          "ABSENT",
          "ABSENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
          "PRESENT",
        ]),
      ),
      term,
    );

    expect(drifting).toHaveLength(0);
  });

  it("does not judge a fellow who has barely arrived", () => {
    // A Monday joiner who misses Tuesday is not drifting, and a list that said so would be
    // ignored by the third week.
    const short = sessions(3);
    const drifting = driftList(
      summarize(short, [fellow()], marks(["ABSENT", "ABSENT", "ABSENT"])),
      short,
    );

    expect(drifting).toHaveLength(0);
  });

  it("never names a test student", () => {
    const drifting = driftList(summarize(term, [fellow({ testStudentNumber: 1 })], []), term);
    expect(drifting).toHaveLength(0);
  });

  it("puts the worst first", () => {
    const summaries = summarize(
      term,
      [
        fellow({ enrollmentId: "e1", studentId: "p1" }),
        fellow({ enrollmentId: "e2", studentId: "p2", displayName: "Grace" }),
      ],
      [
        ...marks(
          [
            "PRESENT",
            "PRESENT",
            "PRESENT",
            "PRESENT",
            "PRESENT",
            "PRESENT",
            "PRESENT",
            "PRESENT",
            "ABSENT",
            "ABSENT",
          ],
          "e1",
        ),
        ...marks(
          [
            "PRESENT",
            "PRESENT",
            "PRESENT",
            "PRESENT",
            "PRESENT",
            "ABSENT",
            "ABSENT",
            "ABSENT",
            "ABSENT",
            "ABSENT",
          ],
          "e2",
        ),
      ],
    );

    const drifting = driftList(summaries, term);
    expect(drifting.map((entry) => entry.summary.fellow.enrollmentId)).toEqual(["e2", "e1"]);
  });
});

describe("programRate", () => {
  it("is over the fellows who count", () => {
    const summaries = summarize(
      sessions(2),
      [fellow({ enrollmentId: "e1" }), fellow({ enrollmentId: "e2", testStudentNumber: 1 })],
      [...marks(["PRESENT", "ABSENT"], "e1"), ...marks(["PRESENT", "PRESENT"], "e2")],
    );

    // The test student's perfect record does not lift the roster's figure.
    expect(programRate(summaries)).toBe(0.5);
  });

  it("is null when nothing has closed yet", () => {
    expect(programRate(summarize(sessions(2, 2), [fellow()], []))).toBeNull();
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

  // The drift list reads the last few settled days. A term of days ahead must not push every real
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
      { enrollmentId: "e1", sessionId: "d3", status: "PRESENT" },
      { enrollmentId: "e1", sessionId: "d4", status: "PRESENT" },
      { enrollmentId: "e1", sessionId: "d5", status: "PRESENT" },
    ]);

    expect(driftList(summaries, all)).toHaveLength(1);
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
 * The windows behind the drift list, for one fellow whether or not they are on it. What these
 * protect is that the window is the cohort's last few mornings narrowed to the fellow, so a fellow
 * who joined last week is measured over fewer days rather than charged with the days before.
 */
describe("recentAttendance", () => {
  const term = sessions(12, 2);

  it("reads the last settled mornings, leaving open ones and older ones out", () => {
    const [summary] = summarize(
      term,
      [fellow()],
      marks([
        "ABSENT", // outside both windows
        "ABSENT",
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

    expect(recentAttendance(summary, term)).toEqual({
      missed: 1,
      missedOf: 5,
      late: 2,
      lateOf: 10,
    });
  });

  it("narrows the window to the mornings since a fellow joined", () => {
    const [summary] = summarize(
      term,
      [fellow({ enrolledFrom: "2026-09-08" })],
      marks([null, null, null, null, null, null, null, "PRESENT", "ABSENT", "PRESENT"]),
    );

    expect(recentAttendance(summary, term)).toEqual({
      missed: 1,
      missedOf: 3,
      late: 0,
      lateOf: 3,
    });
  });

  it("names the clause the drift list would, and nothing when neither applies", () => {
    expect(attendanceDriftReason({ missed: 2, missedOf: 5, late: 0, lateOf: 10 })).toBe("missing");
    expect(attendanceDriftReason({ missed: 1, missedOf: 5, late: 3, lateOf: 10 })).toBe("late");
    expect(attendanceDriftReason({ missed: 2, missedOf: 5, late: 3, lateOf: 10 })).toBe("missing");
    expect(attendanceDriftReason({ missed: 1, missedOf: 5, late: 2, lateOf: 10 })).toBeNull();
  });

  it("says both windows in words", () => {
    expect(recentAttendanceSentence({ missed: 1, missedOf: 5, late: 2, lateOf: 10 })).toBe(
      "missed 1 of the last 5 mornings · late 2 of the last 10",
    );
    expect(recentAttendanceSentence({ missed: 0, missedOf: 3, late: 0, lateOf: 3 })).toBe(
      "missed 0 of the 3 mornings so far · late 0 of the 3 so far",
    );
    expect(recentAttendanceSentence({ missed: 0, missedOf: 0, late: 0, lateOf: 0 })).toBe(
      "no mornings have closed yet",
    );
  });
});
