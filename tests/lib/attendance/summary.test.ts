import {
  programRate,
  countsAsAttended,
  driftList,
  DRIFT_RULE,
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
    open: index >= count - openTail,
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

  it("leaves an open session out of the rate entirely", () => {
    const [summary] = summarize(sessions(3, 1), [fellow()], marks(["PRESENT", "PRESENT"]));

    // Three sessions, one still running. Nobody is absent from a morning still in progress.
    expect(summary.eligible).toBe(2);
    expect(summary.rate).toBe(1);
    expect(summary.cells).toHaveLength(3);
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
