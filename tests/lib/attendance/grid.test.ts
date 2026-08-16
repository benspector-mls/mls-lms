import {
  gridCounts,
  gridRows,
  splitForCorrection,
  type GridEnrollment,
  type GridRecord,
} from "@/lib/attendance/grid";
import { defaultEndsAt, type WindowSession } from "@/lib/attendance/window";

/**
 * The roster, with what each fellow did attached.
 *
 * **The property worth guarding is that the roster comes from the enrollments.** A grid built from
 * the records would silently omit whoever did not check in — exactly the people an instructor
 * opened the screen to deal with — and the omission would look like a quiet morning.
 */

const STARTED = new Date("2026-09-14T13:00:00Z");

function session(overrides: Partial<WindowSession> = {}): WindowSession {
  return {
    startedAt: STARTED,
    endsAt: defaultEndsAt(STARTED),
    endedAt: null,
    lateAfterMinutes: 5,
    ...overrides,
  };
}

function enrollment(id: string, name: string): GridEnrollment {
  return {
    enrollmentId: id,
    student: {
      id: `student-${id}`,
      displayName: name,
      email: `${name.toLowerCase()}@example.com`,
      githubUsername: name.toLowerCase(),
      testStudentNumber: null,
    },
  };
}

function record(enrollmentId: string, overrides: Partial<GridRecord> = {}): GridRecord {
  return {
    enrollmentId,
    status: "PRESENT",
    source: "SELF_CHECK_IN",
    checkedInAt: new Date("2026-09-14T13:02:00Z"),
    note: null,
    recordedByName: null,
    ...overrides,
  };
}

const ROSTER = [enrollment("e1", "Ada"), enrollment("e2", "Grace"), enrollment("e3", "Alan")];

describe("gridRows", () => {
  it("returns every enrollment when nobody has checked in", () => {
    const rows = gridRows(ROSTER, [], session(), new Date("2026-09-14T13:05:00Z"));
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.record === null)).toBe(true);
  });

  it("returns every enrollment when everybody has", () => {
    const records = ROSTER.map((row) => record(row.enrollmentId));
    const rows = gridRows(ROSTER, records, session(), new Date("2026-09-14T13:05:00Z"));
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.record !== null)).toBe(true);
  });

  it("drops a record whose enrollment is not on this roster, rather than appending it", () => {
    // Arises legitimately — a removed fellow who was there that day, when the caller asked only
    // for active ones. Appending it would render as a nameless row in the middle of the grid.
    const rows = gridRows(ROSTER, [record("someone-else")], session(), new Date());
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.record === null)).toBe(true);
  });

  /*
    The same inputs, two moments, two meanings. While check-in is open a missing row is a live
    count nobody should read as an absence; once the session has closed it is one.
  */
  it("changes what an empty cell means when the session closes, with nothing else changing", () => {
    const open = gridRows(ROSTER, [], session(), new Date("2026-09-14T13:05:00Z"));
    expect(open.every((row) => row.pending === "not-yet")).toBe(true);

    const closed = gridRows(ROSTER, [], session(), new Date("2026-09-14T18:00:00Z"));
    expect(closed.every((row) => row.pending === "no-check-in")).toBe(true);
  });

  it("says no-check-in for a session a person ended, however early", () => {
    const ended = session({ endedAt: new Date("2026-09-14T13:20:00Z") });
    const rows = gridRows(ROSTER, [], ended, new Date("2026-09-14T13:25:00Z"));
    expect(rows.every((row) => row.pending === "no-check-in")).toBe(true);
  });

  it("treats a day with no session at all as one with no check-in", () => {
    const rows = gridRows(ROSTER, [], null, new Date());
    expect(rows.every((row) => row.pending === "no-check-in")).toBe(true);
  });
});

describe("gridCounts", () => {
  it("counts each status apart, and unrecorded apart from absent", () => {
    const rows = gridRows(
      ROSTER,
      [record("e1"), record("e2", { status: "LATE" })],
      session(),
      new Date("2026-09-14T13:05:00Z"),
    );

    expect(gridCounts(rows)).toEqual({
      present: 1,
      late: 1,
      excused: 0,
      absent: 0,
      // Not folded into absent: nothing has been decided about this person yet, and a count that
      // said otherwise would be asserting an absence the record does not hold.
      unrecorded: 1,
    });
  });

  it("counts an explicit absence as absent rather than unrecorded", () => {
    const rows = gridRows(
      ROSTER,
      [record("e1", { status: "ABSENT", source: "FINALIZED", checkedInAt: null })],
      session({ endedAt: new Date("2026-09-14T14:00:00Z") }),
      new Date("2026-09-14T14:05:00Z"),
    );

    expect(gridCounts(rows).absent).toBe(1);
    expect(gridCounts(rows).unrecorded).toBe(2);
  });
});

describe("splitForCorrection", () => {
  it("floats whoever needs attention to the top, and the two lists are exhaustive", () => {
    const rows = gridRows(ROSTER, [record("e2")], session(), new Date("2026-09-14T13:05:00Z"));
    const { unresolved, recorded } = splitForCorrection(rows);

    expect(unresolved.map((row) => row.enrollmentId)).toEqual(["e1", "e3"]);
    expect(recorded.map((row) => row.enrollmentId)).toEqual(["e2"]);
    expect(unresolved.length + recorded.length).toBe(rows.length);
  });
});
