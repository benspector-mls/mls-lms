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
import { csvLine, csvPersonName } from "@/lib/csv";
import { CATEGORY_META, type CourseUnitCategory } from "@/lib/course-units";

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
  /** The unit this belongs to: a module, a project, or an assessment. */
  courseUnit: { id: string; name: string; position: number; category: CourseUnitCategory };
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
 * Course order: `courseUnit.position`, which is the sequence an instructor set — one sequence
 * across modules, projects, and assessments alike.
 *
 * Shared with the grid rather than written twice, and that is the point of exporting it. The
 * columns of the file have to be the columns of the table in the same order — a CSV whose third
 * column is a different assignment than the table's third column is wrong in a way that reads as
 * correct, because both are plausible orderings of the same assignments.
 */
export function sortGradebookAssignments<
  T extends { title: string; courseUnit: { position: number; name: string } },
>(assignments: readonly T[]): T[] {
  return [...assignments].sort((a, b) => {
    const byModule =
      a.courseUnit.position - b.courseUnit.position ||
      a.courseUnit.name.localeCompare(b.courseUnit.name);
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
 * Quoting, formula-injection escaping, and the test-student mark now live in `lib/csv.ts`.
 *
 * They moved when attendance gained an export of its own. A guard against a spreadsheet executing
 * a name somebody typed has to exist exactly once — a second copy is the one that falls behind —
 * and attendance's most dangerous field is worse than this file's, being a note a fellow wrote
 * that no instructor reviewed on the way through.
 */
function csvStudentName(student: GradebookCsvPerson): string {
  return csvPersonName(student, "Unknown student");
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

  /*
    Which unit each column belongs to, and what kind of unit it is.

    **A header row rather than a reordering of the columns.** The grid is four tabs now, so there
    is no single on-screen order for the file to match; keeping course order means the export
    stays one complete, stable table, which is what makes it sortable and filterable in a
    spreadsheet — the reason it is one table rather than two in the first place. A reader who
    wants the three categories apart sorts or filters on this row, which is the tool they already
    opened the file in.
  */
  const lines = [
    csvLine([
      "Student",
      "Email",
      "GitHub username",
      "Enrollment",
      ...assignments.map((assignment) => assignment.title),
    ]),
    csvLine([
      "Unit",
      null,
      null,
      null,
      /*
        One row rather than a category row and a name row. "project: Mod 4 Project" carries both,
        and every header row added here is a row a reader has to skip past before the data
        starts. Never blank: every assignment belongs to exactly one unit.
      */
      ...assignments.map(
        (assignment) =>
          `${CATEGORY_META[assignment.courseUnit.category].noun}: ${assignment.courseUnit.name}`,
      ),
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
