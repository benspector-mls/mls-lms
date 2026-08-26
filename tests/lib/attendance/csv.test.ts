import {
  attendanceCsv,
  attendanceCsvFilename,
  attendanceCsvIsEmpty,
  type AttendanceCsvData,
} from "@/lib/attendance/csv";

/**
 * The file somebody defends a stipend with.
 *
 * Two things here are not cosmetic: the `Recorded` column, which is the difference between a day
 * claimed on a fellow's own check-in and one claimed on a staff correction; and the formula guard,
 * because a fellow's note is free text that no instructor reviewed on its way into a spreadsheet
 * an instructor opens.
 */

function data(overrides: Partial<AttendanceCsvData> = {}): AttendanceCsvData {
  return {
    sessions: [
      { id: "s1", day: "2026-09-14", open: false },
      { id: "s2", day: "2026-09-15", open: false },
    ],
    fellows: [
      {
        enrollmentId: "e1",
        person: {
          displayName: "Ada Lovelace",
          email: "ada@example.com",
          githubUsername: "ada",
          testStudentNumber: null,
        },
        enrollment: "Active",
        enrolledFrom: "2026-09-14",
      },
    ],
    records: [
      {
        enrollmentId: "e1",
        sessionId: "s1",
        status: "PRESENT",
        source: "SELF_CHECK_IN",
        checkedInAt: new Date("2026-09-14T13:02:00Z"),
        note: null,
      },
    ],
    ...overrides,
  };
}

function rows(csv: string): string[] {
  return csv.split("\r\n");
}

describe("attendanceCsv", () => {
  it("writes one row per fellow per session, not a grid", () => {
    const lines = rows(attendanceCsv(data()));
    expect(lines).toHaveLength(3); // header plus two sessions
    expect(lines[0]).toContain("Date");
    expect(lines[1]).toContain("2026-09-14");
    expect(lines[2]).toContain("2026-09-15");
  });

  it("names how a mark was recorded, which is the whole compliance argument", () => {
    const lines = rows(attendanceCsv(data()));
    expect(lines[1]).toContain("self");
    // No record at all: absent, and nobody put that mark there.
    expect(lines[2]).toContain("not recorded");
    expect(lines[2]).toContain("ABSENT");
  });

  it("distinguishes a staff correction from a fellow's own check-in", () => {
    const lines = rows(
      attendanceCsv(
        data({
          records: [
            {
              enrollmentId: "e1",
              sessionId: "s1",
              status: "PRESENT",
              source: "INSTRUCTOR",
              checkedInAt: null,
              note: "Bus was late",
            },
          ],
        }),
      ),
    );

    expect(lines[1]).toContain("instructor");
    expect(lines[1]).toContain("Bus was late");
  });

  it("writes the check-in time in Brooklyn, not UTC", () => {
    // 13:02 UTC in September is 09:02 in New York. A timestamp in UTC beside a civil Date column
    // would put a 9am arrival on the previous evening for anybody reading the two together.
    expect(rows(attendanceCsv(data()))[1]).toContain("09:02");
  });

  it("says nothing is settled about a session still in progress", () => {
    const lines = rows(
      attendanceCsv(data({ sessions: [{ id: "s1", day: "2026-09-14", open: true }] })),
    );
    expect(lines[1]).toContain("In progress");
    expect(lines[1]).not.toContain("ABSENT");
  });

  /*
    Not a blank cell, and not an absence: a fellow who joined on the 15th has no row for the 14th
    at all. An empty cell can be misread, but a row asserting they missed a session they were not
    admitted to is simply wrong — in a number somebody is paid against.
  */
  it("omits sessions from before a fellow enrolled", () => {
    const lines = rows(
      attendanceCsv(
        data({
          fellows: [{ ...data().fellows[0], enrolledFrom: "2026-09-15" }],
          records: [],
        }),
      ),
    );

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("2026-09-15");
  });

  it("marks a test student in the name, as the screens do", () => {
    const lines = rows(
      attendanceCsv(
        data({
          fellows: [
            {
              ...data().fellows[0],
              person: { ...data().fellows[0].person, testStudentNumber: 1 },
            },
          ],
        }),
      ),
    );

    expect(lines[1]).toContain("(test student)");
  });

  it("carries the enrollment as a column, which survives being sorted", () => {
    const lines = rows(
      attendanceCsv(data({ fellows: [{ ...data().fellows[0], enrollment: "Removed" }] })),
    );
    expect(lines[1]).toContain("Removed");
  });

  it("neutralises a note a spreadsheet would otherwise execute", () => {
    const lines = rows(
      attendanceCsv(
        data({
          records: [
            {
              enrollmentId: "e1",
              sessionId: "s1",
              status: "EXCUSED",
              source: "INSTRUCTOR",
              checkedInAt: null,
              note: '=HYPERLINK("http://evil.example","click")',
            },
          ],
        }),
      ),
    );

    // The apostrophe is what makes Excel and Sheets read it as text. Quoting alone does not.
    expect(lines[1]).toContain("\"'=HYPERLINK");
  });

  it("quotes a name containing a comma rather than shifting the row", () => {
    const lines = rows(
      attendanceCsv(
        data({
          fellows: [
            {
              ...data().fellows[0],
              person: { ...data().fellows[0].person, displayName: "Lovelace, Ada" },
            },
          ],
        }),
      ),
    );

    expect(lines[1].startsWith('"Lovelace, Ada"')).toBe(true);
  });
});

describe("attendanceCsvFilename", () => {
  it("carries the cohort and the range, so two downloads are tellable apart", () => {
    expect(attendanceCsvFilename({ term: "Fall 2026", from: "2026-09-14", to: "2026-12-18" })).toBe(
      "attendance-fall-2026-2026-09-14-to-2026-12-18.csv",
    );
  });

  it("leaves the range out when there is none rather than writing an empty one", () => {
    expect(attendanceCsvFilename({ term: "Fall 2026", from: null, to: null })).toBe(
      "attendance-fall-2026.csv",
    );
  });
});

describe("attendanceCsvIsEmpty", () => {
  it("is true with no sessions and with no fellows", () => {
    expect(attendanceCsvIsEmpty(data({ sessions: [] }))).toBe(true);
    expect(attendanceCsvIsEmpty(data({ fellows: [] }))).toBe(true);
    expect(attendanceCsvIsEmpty(data())).toBe(false);
  });
});
