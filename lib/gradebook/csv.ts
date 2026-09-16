/**
 * The gradebook as a spreadsheet.
 *
 * **Browser-safe and pure**, in the manner of `lib/people.ts`: nothing here touches the database,
 * and the input is the payload `courses.gradebook` already returns. That is what lets the download
 * be built from the grid that is on screen rather than from a second query — a CSV assembled from
 * its own read of the database can disagree with the page it was downloaded from, and there is no
 * way for a reader holding the file to notice.
 *
 * **A score is a number, and every cell without one says which kind of gap it is.** There are three
 * words, and they are exhaustive:
 *
 * - `Missing` — past the deadline with nothing handed in. The one gap with a verdict in it.
 * - `Submitted` — handed in, not yet graded. The work arrived; the number has not.
 * - `Not submitted` — nothing handed in, and not yet past the deadline (or never given one).
 *
 * **No cell is left blank**, because a blank cell in a spreadsheet is a question its reader cannot
 * answer: a gap that means "arrived, ungraded" looks exactly like one that means "never started",
 * and the two call for opposite responses from an instructor. A word costs a column of text where
 * a blank cost nothing, and it buys a file that can be read without the screen it came from.
 *
 * **The one error this file must not make is turning a gap into a zero**, and that rule is
 * untouched by the words above: text drops out of a SUM or AVERAGE exactly the way a blank does,
 * where a zero would turn work nobody has looked at yet into a score of nothing.
 *
 * Drafts have no column here at all — the gradebook payload holds released work only, so there is
 * nothing to filter and no column of empty cells for an assignment nobody has been given.
 */

import { slugifyCourse } from "@/lib/courses/course-slug";
import { csvLine, csvPersonName } from "@/lib/csv";
import { CATEGORY_META, type CourseUnitCategory } from "@/lib/course-units";
import { isMissing, lateByStudent, missingByStudent } from "@/lib/gradebook/summary";
import { handedIn } from "@/lib/status";
import type { SubmissionStatus } from "@/lib/generated/prisma/enums";

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
  dueAt: Date | string | null;
  /** Null means a draft, which cannot be missing however far past its due date. */
  distributedAt: Date | string | null;
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
  status: SubmissionStatus;
  finalScore: number | null;
  /** Whether the first hand-in came after the deadline, or null where nothing was handed in. */
  isLate: boolean | null;
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
 *
 * **"Handed in late" and "Missing" are counts, and they are the two columns here that are not
 * scores.** They sit with the identity columns rather than after the assignments, both because
 * they describe the student rather than any one piece of work and because a figure fifty columns
 * to the right of the name is one nobody scrolls to. Lateness is not also written per assignment:
 * that would mean a second column beside every existing one, doubling the width of the file and
 * putting text in among the numbers that make it worth having. Missing *is* written per assignment
 * — as the word "Missing" in the assignment's own cell — because that cell was blank anyway, so
 * the word displaces nothing and says which work the count is counting.
 *
 * `at` is the instant "past due" is judged against — the render the download was built in, so the
 * file and the screen it came from agree on which deadlines have passed.
 */
export function gradebookCsv(data: GradebookCsvData, at: Date): string {
  const assignments = sortGradebookAssignments(data.assignments);

  /*
    Keyed lookup rather than a scan per cell, for the same reason the grid builds one: a cohort of
    twenty-five against fifty assignments is more than a thousand cells, and a linear search inside
    each is a million comparisons to write one file.

    Both lists into one map, which is safe because they are complements — `courses.gradebook`
    partitions the course's submissions by whether the student is still enrolled, so no key appears
    in both.
  */
  const cellByKey = new Map<string, GradebookCsvCell>();
  for (const cell of [...data.cells, ...data.removedCells]) {
    cellByKey.set(`${cell.assignmentId}:${cell.studentId}`, cell);
  }

  /*
    **`lateByStudent` rather than a count written here**, which is the same rule the grid's column
    is drawn from: `isLate === true`, with null meaning nothing was handed in rather than handed in
    on time. A second implementation of that test is exactly how a file downloaded from a screen
    comes to disagree with the screen about which student missed what.

    **Over every assignment in the course, where the grid's column counts one tab.** The file is one
    table across all four, so a student with two late modules and one late project reads as three
    here and as two or one there. Both are right about what they count; only this one is a total.
  */
  const late = lateByStudent([...data.cells, ...data.removedCells]);

  /*
    **`missingByStudent` rather than a count written here**, for the late column's reason: it is
    the same rule the grid's Missing column and red rings are drawn from, and a second
    implementation is how the file comes to disagree with the screen. Course-wide like the late
    count, over both rosters, where the grid's column counts one tab.
  */
  const missing = missingByStudent(
    [...data.activeEnrollments, ...data.removedEnrollments].map(({ student }) => student.id),
    data.assignments,
    [...data.cells, ...data.removedCells],
    at,
  );

  function studentRow(student: GradebookCsvPerson, enrollment: string): string {
    return csvLine([
      csvStudentName(student),
      student.email,
      student.githubUsername,
      enrollment,
      /*
        **A zero here, where an ungraded assignment leaves a blank.** The rule against writing a
        zero for a gap is about scores, and it holds because a missing score is unknown. These
        figures are never unknown: every student has a number of late hand-ins and a number of
        missing assignments, and for most of them it is none. A blank would drop those students
        out of an average rather than counting them as the zeros they are.
      */
      late.get(student.id) ?? 0,
      missing.get(student.id) ?? 0,
      /*
        The three words and the number, in the order the questions are asked. "Missing" comes
        first and is `isMissing` — the same predicate the count column left of here is built from,
        and the same one the screen draws its red ring from, so the word appears exactly as many
        times in a row as that column claims.

        Then the score, which is what a graded cell holds. A resubmission keeps the score it was
        already given, so revising work does not blank out the grade it has: `finalScore` is only
        null while nothing has been graded yet.

        `handedIn` from `lib/status.ts` separates the last two, and it is the same predicate
        `isMissing` uses to decide the opposite question — so a cell cannot read "Missing" and
        "Submitted" by two rules that disagree. An absent cell is "Not submitted" for the reason
        `isMissing` gives: the row exists only once a student has taken the work up.
      */
      ...assignments.map((assignment) => {
        const cell = cellByKey.get(`${assignment.id}:${student.id}`);
        if (isMissing(assignment, cell?.status, at)) return "Missing";
        if (cell?.finalScore != null) return cell.finalScore;
        return handedIn(cell?.status) ? "Submitted" : "Not submitted";
      }),
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
      // The same words the grid's columns use, so the file and the screen name each fact once.
      "Handed in late",
      "Missing",
      ...assignments.map((assignment) => assignment.title),
    ]),
    csvLine([
      "Unit",
      null,
      null,
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
      // Blank rather than totals: a count of late or missing assignments is not out of anything.
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
 * `slugifyCourse` rather than a slugifier of its own — it already lowercases, collapses everything
 * else to single hyphens, and trims the ends, which is exactly what a filename wants. Its
 * twenty-four character ceiling is set by GitHub repository names and is merely a convenience here.
 */
export function gradebookCsvFilename(params: {
  term: string;
  /** Null when the whole roster is exported, which needs no qualifier in the name. */
  cohortLabel: string | null;
  date: Date;
}): string {
  const stamp = [
    params.date.getFullYear(),
    String(params.date.getMonth() + 1).padStart(2, "0"),
    String(params.date.getDate()).padStart(2, "0"),
  ].join("-");

  // Filtered so that a term or a cohort name written entirely in a script `slugifyCourse` cannot
  // transliterate leaves a shorter name rather than a doubled hyphen.
  const parts = [
    "gradebook",
    slugifyCourse(params.term),
    params.cohortLabel === null ? "" : slugifyCourse(params.cohortLabel),
    stamp,
  ].filter((part) => part !== "");

  return `${parts.join("-")}.csv`;
}
