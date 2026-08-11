/**
 * The gradebook as a spreadsheet.
 *
 * **Browser-safe and pure**, in the manner of `lib/people.ts`: nothing here touches the database,
 * and the input is the payload `courses.gradebook` already returns. That is what lets the download
 * be built from the grid that is on screen rather than from a second query — a CSV assembled from
 * its own read of the database can disagree with the page it was downloaded from, and there is no
 * way for a reader holding the file to notice.
 *
 * **A score is a number and a gap is blank.** The grid draws four states — never accepted, accepted
 * but not graded, graded, and graded incomplete — and a spreadsheet flattens them, so the question
 * is which distinction survives. It is the number: a column of raw points sums and averages, and
 * `9/10` in a cell does neither. The two kinds of gap both become empty, which is the honest
 * flattening; writing a zero for either would turn work nobody has looked at yet into a score of
 * nothing, and that is the one error this file must not make.
 */

import { slugifyCohort } from "@/lib/courses/cohort-slug";
import { displayNameOf } from "@/lib/people";

/**
 * The parts of the gradebook payload a CSV reads, named structurally rather than taken from
 * `RouterOutputs`.
 *
 * The real payload satisfies these, so a `select` that stops returning `finalScore` is still a type
 * error at the call site. What it buys is a test that can build a two-student cohort in ten lines
 * instead of a whole router output.
 */
export type GradebookCsvAssignment = {
  id: string;
  title: string;
  pointValue: number;
  module: { position: number; name: string };
};

export type GradebookCsvPerson = {
  id: string;
  displayName: string | null;
  email: string | null;
  githubUsername: string | null;
  testStudentNumber: number | null;
};

/** One submission. `finalScore` is null while it exists but has not been graded. */
export type GradebookCsvCell = {
  assignmentId: string;
  studentId: string;
  finalScore: number | null;
};

export type GradebookCsvData = {
  assignments: readonly GradebookCsvAssignment[];
  activeEnrollments: readonly { student: GradebookCsvPerson }[];
  removedEnrollments: readonly { student: GradebookCsvPerson }[];
  cells: readonly GradebookCsvCell[];
  removedCells: readonly GradebookCsvCell[];
};

/**
 * Course order: `module.position`, which is the sequence an instructor set.
 *
 * Shared with the grid rather than written twice, and that is the point of exporting it. The
 * columns of the file have to be the columns of the table in the same order — a CSV whose third
 * column is a different assignment than the table's third column is wrong in a way that reads as
 * correct, because both are plausible orderings of the same assignments.
 */
export function sortGradebookAssignments<
  T extends { title: string; module: { position: number; name: string } },
>(assignments: readonly T[]): T[] {
  return [...assignments].sort((a, b) => {
    const byModule =
      a.module.position - b.module.position || a.module.name.localeCompare(b.module.name);
    return byModule !== 0 ? byModule : a.title.localeCompare(b.title);
  });
}

/**
 * Whether there is a grid to draw at all — no students, or no assignments.
 *
 * Read by the screen for its empty state and by the header for whether to offer the download, so
 * the two cannot come apart. A button beside "Nothing to show yet" that hands over a file of column
 * headings is an offer to export something the same screen has just said does not exist.
 */
export function gradebookIsEmpty(data: GradebookCsvData): boolean {
  const students = data.activeEnrollments.length + data.removedEnrollments.length;
  return students === 0 || data.assignments.length === 0;
}

/**
 * Text a spreadsheet cannot misread, and cannot execute.
 *
 * Two separate problems. Quoting is the CSV one: a comma, a quote, a newline, or an edge space
 * would otherwise split or shift a field, and a student who put a comma in their display name would
 * push their whole row one column to the right. Doubling the quote and wrapping is RFC 4180.
 *
 * The leading apostrophe is the other, and it is a security fix rather than a formatting one.
 * Display names are typed by people, and Excel and Google Sheets evaluate any cell beginning `=`,
 * `+`, `-`, or `@` as a formula when the file is opened — so a name of `=HYPERLINK("http://…"&A2)`
 * runs on an instructor's machine against the roster sitting beside it. Quoting alone does not stop
 * this; both spreadsheets parse the formula out of a quoted field. The apostrophe is what makes it
 * literal text, and it is applied only to fields that are text, so a negative number is untouched.
 */
const NEEDS_QUOTING = /[",\r\n]|^\s|\s$/;
const READS_AS_FORMULA = /^[=+\-@\t\r]/;

function csvText(value: string): string {
  const literal = READS_AS_FORMULA.test(value) ? `'${value}` : value;
  return NEEDS_QUOTING.test(literal) ? `"${literal.replace(/"/g, '""')}"` : literal;
}

/** One record. Numbers pass through unquoted so they arrive as numbers; null is an empty cell. */
function csvLine(fields: readonly (string | number | null)[]): string {
  return fields
    .map((field) => {
      if (field == null) return "";
      return typeof field === "number" ? String(field) : csvText(field);
    })
    .join(",");
}

/**
 * Whatever this student is best called, and whether they are real.
 *
 * The badge the grid draws beside a seeded student has to survive into the file, because the file
 * is where it matters most: a test row on screen is marked, and the same row in a spreadsheet of
 * cohort results is indistinguishable from a student who has fallen behind. In words rather than a
 * column of its own, since that is what the grid does — the mark belongs to the name.
 */
function csvStudentName(student: GradebookCsvPerson): string {
  const name = displayNameOf(student, "Unknown student");
  return student.testStudentNumber === null ? name : `${name} (test student)`;
}

/**
 * The whole grid, active students then removed ones, in the order the screen lists them.
 *
 * **One table, with an Enrollment column, where the screen has two.** A spreadsheet sorts and
 * filters, which is most of why somebody wants the file, and two tables stacked in one CSV survive
 * neither. The column carries what the second table's heading said, so a departed student can still
 * be excluded from any figure — and, unlike a heading, it survives being sorted.
 *
 * The point values are a second header row rather than a column, because they belong to the
 * assignment rather than to any student. Without them a raw-score export is uninterpretable: 7 is a
 * good result out of 8 and a poor one out of 20, and the grid never had to say which because every
 * cell on screen reads `7/8`.
 */
export function gradebookCsv(data: GradebookCsvData): string {
  const assignments = sortGradebookAssignments(data.assignments);

  /*
    Keyed lookup rather than a scan per cell, for the same reason the grid builds one: a cohort of
    twenty-five against fifty assignments is more than a thousand cells, and a linear search inside
    each is a million comparisons to write one file.

    Both lists into one map, which is safe because they are complements — `courses.gradebook`
    partitions the course's submissions by whether the student is still enrolled, so no key appears
    in both.
  */
  const scores = new Map<string, number | null>();
  for (const cell of [...data.cells, ...data.removedCells]) {
    scores.set(`${cell.assignmentId}:${cell.studentId}`, cell.finalScore);
  }

  function studentRow(student: GradebookCsvPerson, enrollment: string): string {
    return csvLine([
      csvStudentName(student),
      student.email,
      student.githubUsername,
      enrollment,
      /*
        Missing and present-but-ungraded both land here as an empty cell. `get` returns undefined
        for a student who never accepted the assignment and null for one whose submission is not
        graded yet, and `?? null` collapses the pair deliberately — see the note at the top of this
        file about why neither may become a zero.
      */
      ...assignments.map((assignment) => scores.get(`${assignment.id}:${student.id}`) ?? null),
    ]);
  }

  const lines = [
    csvLine([
      "Student",
      "Email",
      "GitHub username",
      "Enrollment",
      ...assignments.map((assignment) => assignment.title),
    ]),
    csvLine([
      "Points possible",
      null,
      null,
      null,
      ...assignments.map((assignment) => assignment.pointValue),
    ]),
    ...data.activeEnrollments.map((enrollment) => studentRow(enrollment.student, "Active")),
    ...data.removedEnrollments.map((enrollment) => studentRow(enrollment.student, "Removed")),
  ];

  // CRLF, which is what RFC 4180 specifies and what the spreadsheet applications on Windows still
  // want. Every reader that accepts a bare newline accepts this too, so it costs nothing.
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * What the downloaded file is called.
 *
 * The term and the group are both in it because a filtered download is a different file from an
 * unfiltered one, and two of them in a downloads folder are otherwise told apart only by the `(1)`
 * a browser appends. The date is there because a gradebook is a snapshot: the same cohort exported
 * twice in a term is two different sets of numbers, and the file is the only thing that records
 * which sitting it came from.
 *
 * `slugifyCohort` rather than a slugifier of its own — it already lowercases, collapses everything
 * else to single hyphens, and trims the ends, which is exactly what a filename wants. Its
 * twenty-four character ceiling is set by GitHub repository names and is merely a convenience here.
 */
export function gradebookCsvFilename(params: {
  cohortTerm: string;
  /** Null when the whole cohort is exported, which needs no qualifier in the name. */
  groupLabel: string | null;
  date: Date;
}): string {
  const stamp = [
    params.date.getFullYear(),
    String(params.date.getMonth() + 1).padStart(2, "0"),
    String(params.date.getDate()).padStart(2, "0"),
  ].join("-");

  // Filtered so that a term or a group name written entirely in a script `slugifyCohort` cannot
  // transliterate leaves a shorter name rather than a doubled hyphen.
  const parts = [
    "gradebook",
    slugifyCohort(params.cohortTerm),
    params.groupLabel === null ? "" : slugifyCohort(params.groupLabel),
    stamp,
  ].filter((part) => part !== "");

  return `${parts.join("-")}.csv`;
}
