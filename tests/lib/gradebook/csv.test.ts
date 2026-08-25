import {
  gradebookCsv,
  gradebookCsvFilename,
  gradebookIsEmpty,
  sortGradebookAssignments,
  type GradebookCsvAssignment,
  type GradebookCsvData,
  type GradebookCsvPerson,
} from "@/lib/gradebook/csv";

function assignment(overrides: Partial<GradebookCsvAssignment> = {}): GradebookCsvAssignment {
  return {
    id: "a1",
    title: "Loops",
    pointValue: 10,
    courseUnit: { id: "u1", position: 0, name: "Module 1", category: "MODULE" },
    ...overrides,
  };
}

function student(overrides: Partial<GradebookCsvPerson> = {}): GradebookCsvPerson {
  return {
    id: "s1",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    githubUsername: "ada",
    testStudentNumber: null,
    ...overrides,
  };
}

function gradebook(overrides: Partial<GradebookCsvData> = {}): GradebookCsvData {
  return {
    assignments: [assignment()],
    activeEnrollments: [{ student: student() }],
    removedEnrollments: [],
    cells: [{ assignmentId: "a1", studentId: "s1", finalScore: 9 }],
    removedCells: [],
    ...overrides,
  };
}

/** The file split back into records and fields, for assertions that are about one cell. */
function rows(csv: string): string[][] {
  return csv
    .trimEnd()
    .split("\r\n")
    .map((line) => line.split(","));
}

/**
 * The header row whose first field is this label.
 *
 * By name rather than by index, because the header block grows: it was the titles and the point
 * values, then "Part of" joined them, and every assertion written as `rows(csv)[1]` had to be
 * renumbered for a change that did not affect what it was testing.
 */
function headerRow(csv: string, label: string): string[] {
  const row = rows(csv).find((fields) => fields[0] === label);
  if (!row) throw new Error(`No header row labelled "${label}".`);
  return row;
}

/**
 * The nth student's row, counted past however many header rows there are.
 *
 * A student row is one whose first field is not a header label. Found rather than counted for
 * the same reason `headerRow` is looked up by name.
 */
const HEADER_LABELS = new Set(["Student", "Unit", "Points possible"]);

function studentRows(csv: string): string[][] {
  return rows(csv).filter((fields) => !HEADER_LABELS.has(fields[0]));
}

/** How many rows precede the students, so a count can be about the data rather than the headers. */
function headerRowCount(csv: string): number {
  return rows(csv).filter((fields) => HEADER_LABELS.has(fields[0])).length;
}

describe("column order follows the course, not the alphabet", () => {
  it("sorts by module position, then module name, then title", () => {
    const sorted = sortGradebookAssignments([
      assignment({ id: "c", title: "Arrays", courseUnit: { id: "u2", position: 2, name: "Module 3", category: "MODULE" } }),
      assignment({ id: "b", title: "Zebras", courseUnit: { id: "u1", position: 1, name: "Module 2", category: "MODULE" } }),
      assignment({ id: "a", title: "Async", courseUnit: { id: "u1", position: 1, name: "Module 2", category: "MODULE" } }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the columns of the file in that same order", () => {
    const csv = gradebookCsv(
      gradebook({
        assignments: [
          assignment({ id: "a2", title: "Recursion", courseUnit: { id: "u1", position: 1, name: "Module 2", category: "MODULE" } }),
          assignment({ id: "a1", title: "Loops", courseUnit: { id: "u0", position: 0, name: "Module 1", category: "MODULE" } }),
        ],
        cells: [
          { assignmentId: "a2", studentId: "s1", finalScore: 4 },
          { assignmentId: "a1", studentId: "s1", finalScore: 9 },
        ],
      }),
    );

    const header = headerRow(csv, "Student");
    const [ada] = studentRows(csv);
    expect(header.slice(4)).toEqual(["Loops", "Recursion"]);
    // The scores have to travel with their columns, which is the failure a sort can hide: both
    // orderings look plausible in isolation, and only the pairing is wrong.
    expect(ada.slice(4)).toEqual(["9", "4"]);
  });
});

describe("a gap is blank and never a zero", () => {
  it("leaves a cell empty when the student never accepted the assignment", () => {
    const csv = gradebookCsv(gradebook({ cells: [] }));
    expect(studentRows(csv)[0].slice(4)).toEqual([""]);
  });

  it("leaves a cell empty when the submission exists but is not graded", () => {
    const csv = gradebookCsv(
      gradebook({ cells: [{ assignmentId: "a1", studentId: "s1", finalScore: null }] }),
    );
    expect(studentRows(csv)[0].slice(4)).toEqual([""]);
  });

  it("writes a score as a bare number a spreadsheet can sum", () => {
    const csv = gradebookCsv(
      gradebook({ cells: [{ assignmentId: "a1", studentId: "s1", finalScore: 8.5 }] }),
    );
    expect(studentRows(csv)[0].slice(4)).toEqual(["8.5"]);
  });

  it("writes a zero when the score really is zero", () => {
    const csv = gradebookCsv(
      gradebook({ cells: [{ assignmentId: "a1", studentId: "s1", finalScore: 0 }] }),
    );
    expect(studentRows(csv)[0].slice(4)).toEqual(["0"]);
  });
});

describe("who is in the file", () => {
  it("puts removed students below the active ones and says which is which", () => {
    const csv = gradebookCsv(
      gradebook({
        activeEnrollments: [{ student: student({ id: "s1", displayName: "Ada" }) }],
        removedEnrollments: [{ student: student({ id: "s2", displayName: "Grace" }) }],
        cells: [{ assignmentId: "a1", studentId: "s1", finalScore: 9 }],
        removedCells: [{ assignmentId: "a1", studentId: "s2", finalScore: 6 }],
      }),
    );

    const [ada, grace] = studentRows(csv);
    expect(ada[0]).toBe("Ada");
    expect(ada[3]).toBe("Active");
    expect(grace[0]).toBe("Grace");
    expect(grace[3]).toBe("Removed");
    // A departed student's kept work is the point of removing rather than deleting, so it has to
    // reach the file — marked, so it can be excluded from any figure.
    expect(grace[4]).toBe("6");
  });

  it("marks a test student in the name, the way the grid marks it with a badge", () => {
    const csv = gradebookCsv(
      gradebook({
        activeEnrollments: [{ student: student({ displayName: "Test 1", testStudentNumber: 1 }) }],
      }),
    );

    expect(studentRows(csv)[0][0]).toBe("Test 1 (test student)");
  });

  it("falls back through the name chain rather than leaving the column empty", () => {
    const csv = gradebookCsv(
      gradebook({
        activeEnrollments: [{ student: student({ displayName: null }) }],
      }),
    );

    expect(studentRows(csv)[0][0]).toBe("ada");
  });

  it("carries email and GitHub username as their own columns", () => {
    const csv = gradebookCsv(gradebook());
    const header = headerRow(csv, "Student");
    const [ada] = studentRows(csv);

    expect(header.slice(0, 4)).toEqual(["Student", "Email", "GitHub username", "Enrollment"]);
    expect(ada.slice(1, 3)).toEqual(["ada@example.com", "ada"]);
  });
});

describe("the point values row", () => {
  it("sits under the header, labelled, with one value per assignment", () => {
    const csv = gradebookCsv(
      gradebook({
        assignments: [
          assignment({ id: "a1", title: "Loops", pointValue: 10 }),
          assignment({
            id: "a2",
            title: "Recursion",
            pointValue: 20,
            courseUnit: { id: "u1", position: 1, name: "Module 2", category: "MODULE" },
          }),
        ],
      }),
    );

    // Raw scores are uninterpretable without it: 7 is a good result out of 8 and a poor one out
    // of 20, and the grid never had to say which because every cell on screen reads `7/8`.
    expect(headerRow(csv, "Points possible")).toEqual(["Points possible", "", "", "", "10", "20"]);
  });
});

describe("text a spreadsheet cannot misread", () => {
  it("quotes a name containing a comma so the row does not shift a column", () => {
    const csv = gradebookCsv(
      gradebook({ activeEnrollments: [{ student: student({ displayName: "Lovelace, Ada" }) }] }),
    );

    expect(csv).toContain('"Lovelace, Ada"');
    // Split naively, the row would have one field too many and every score would be one column
    // to the right of the assignment it belongs to. Located by its content rather than by line
    // number, so a header row added later does not renumber an assertion about quoting.
    const line = csv.split("\r\n").find((record) => record.includes("Lovelace, Ada"))!;
    expect(line.split('"')[2]).toBe(",ada@example.com,ada,Active,9");
  });

  it("doubles a quote inside a field", () => {
    const csv = gradebookCsv(
      gradebook({
        activeEnrollments: [{ student: student({ displayName: 'Ada "The Countess"' }) }],
      }),
    );

    expect(csv).toContain('"Ada ""The Countess"""');
  });

  it("keeps a newline inside a field from becoming a new record", () => {
    const csv = gradebookCsv(
      gradebook({ activeEnrollments: [{ student: student({ displayName: "Ada\nLovelace" }) }] }),
    );

    expect(csv).toContain('"Ada\nLovelace"');
    /*
      The newline is inside a quoted field, so it must not split the record. Counted as "one
      student row" rather than as a fixed total, because the header block grows: this is an
      assertion about quoting, not about how many headers the file has.
    */
    expect(studentRows(csv)).toHaveLength(1);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(headerRowCount(csv) + 1);
  });

  it("refuses to let a display name run as a formula", () => {
    const csv = gradebookCsv(
      gradebook({
        activeEnrollments: [{ student: student({ displayName: '=HYPERLINK("http://evil","x")' }) }],
      }),
    );

    // Quoting alone would not do it — both Excel and Google Sheets parse the formula out of a
    // quoted field, and this file is opened on the machine holding the rest of the roster.
    expect(csv).toContain("'=HYPERLINK");
  });

  it.each(["+1", "-1", "@sum", "=1"])("neutralizes a leading %s", (name) => {
    const csv = gradebookCsv(
      gradebook({ activeEnrollments: [{ student: student({ displayName: name }) }] }),
    );

    expect(studentRows(csv)[0][0].startsWith("'")).toBe(true);
  });

  it("leaves an ordinary name alone", () => {
    const csv = gradebookCsv(gradebook());
    expect(studentRows(csv)[0][0]).toBe("Ada Lovelace");
  });
});

describe("nothing to export", () => {
  it.each([
    ["no assignments", gradebook({ assignments: [] })],
    ["no students", gradebook({ activeEnrollments: [], cells: [] })],
  ])("reports %s as empty", (_case, data) => {
    expect(gradebookIsEmpty(data)).toBe(true);
  });

  it("counts a cohort of only removed students as something to export", () => {
    // Their kept record is exactly what somebody downloading an archived cohort wants.
    expect(
      gradebookIsEmpty(
        gradebook({
          activeEnrollments: [],
          cells: [],
          removedEnrollments: [{ student: student({ id: "s2" }) }],
        }),
      ),
    ).toBe(false);
  });

  it("reports a populated gradebook as not empty", () => {
    expect(gradebookIsEmpty(gradebook())).toBe(false);
  });
});

describe("the filename", () => {
  const DATE = new Date(2026, 7, 11);

  it("names the cohort and the day", () => {
    expect(gradebookCsvFilename({ matriculation: "Fall 2026", cohortLabel: null, date: DATE })).toBe(
      "gradebook-fall-2026-2026-08-11.csv",
    );
  });

  it("names the group when the screen was filtered", () => {
    expect(
      gradebookCsvFilename({ matriculation: "Fall 2026", cohortLabel: "Section A", date: DATE }),
    ).toBe("gradebook-fall-2026-section-a-2026-08-11.csv");
  });

  it("leaves no doubled hyphen when a term slugifies to nothing", () => {
    expect(gradebookCsvFilename({ matriculation: "!!!", cohortLabel: null, date: DATE })).toBe(
      "gradebook-2026-08-11.csv",
    );
  });

  it("pads a single-digit month and day", () => {
    expect(
      gradebookCsvFilename({
        matriculation: "Spring 2027",
        cohortLabel: null,
        date: new Date(2027, 0, 5),
      }),
    ).toBe("gradebook-spring-2027-2027-01-05.csv");
  });
});

describe("which unit a column belongs to", () => {
  const data = gradebook({
    assignments: [
      assignment({
        id: "loops",
        title: "Loops",
        courseUnit: { id: "u1", position: 0, name: "Mod 4", category: "MODULE" },
      }),
      assignment({
        id: "erd",
        title: "ERD",
        courseUnit: { id: "u2", position: 1, name: "Mod 4 Project", category: "PROJECT" },
      }),
      assignment({
        id: "coding",
        title: "Coding",
        courseUnit: { id: "u3", position: 2, name: "Mod 4 Assessment", category: "ASSESSMENT" },
      }),
    ],
    cells: [],
  });

  /*
    In column order, which is course order — unit position, then title. Asserted in that order
    rather than in the order the fixture declares them, because the whole point of this row is
    that it lines up with the columns as the file actually writes them.
  */
  it("names the unit and what kind of thing it is", () => {
    expect(headerRow(data0(data), "Unit").slice(4)).toEqual([
      "module: Mod 4",
      "project: Mod 4 Project",
      "assessment: Mod 4 Assessment",
    ]);
  });

  /*
    Never blank, which is the property the single-parent model bought. Every assignment belongs to
    exactly one unit, so a reader filtering this row in a spreadsheet partitions the columns
    rather than filtering some of them and leaving a remainder.
  */
  it("fills every field, because every assignment belongs to a unit", () => {
    expect(headerRow(data0(data), "Unit").slice(4).every((field) => field !== "")).toBe(true);
  });

  // The row has to line up with the titles above it, or it describes the wrong columns.
  it("has one field per assignment, in the same order as the titles", () => {
    const titles = headerRow(data0(data), "Student").slice(4);
    const units = headerRow(data0(data), "Unit").slice(4);
    expect(units).toHaveLength(titles.length);
  });
});

/** The file, so each assertion above reads as being about one export rather than three. */
function data0(input: GradebookCsvData): string {
  return gradebookCsv(input);
}
