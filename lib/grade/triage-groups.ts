/**
 * Triage, by assignment rather than by submission.
 *
 * **What an instructor sits down to do is an assignment, not a submission.** Grading twelve
 * pull requests against one rubric is one task; the same twelve spread across four assignments is
 * four, and the list that names each submission separately hides which of those it is. Grouping
 * turns a column of forty names into "Recursion — 12 waiting", which is the sentence somebody
 * plans an afternoon around.
 *
 * **Pure, and computed from the payload the screen already holds.** The rows it groups are the
 * rows the heading counts, so "N submissions left to grade" and the counts beneath it cannot come
 * to disagree — which is exactly what a second query for per-assignment totals would eventually
 * allow. `triageBucket` itself is untouched and gains no bucket: this is a way of drawing the
 * rows, not a new reading of them.
 */

/** What somebody is called, wherever a name comes from. */
type Named = { displayName: string | null; email: string | null };

/** The parts of a triage row this reads. Structural, so a test can build a queue in a few lines. */
export type GroupableRow = {
  id: string;
  assignment: { id: string; courseId: string; title: string };
  student: Named;
  /**
   * The team this work was handed in by, with every member on it. Absent or null for work a
   * student did alone.
   *
   * Optional so a caller with no teams to describe passes nothing, which is what keeps the tests
   * that build a queue in three lines building it in three lines.
   */
  team?: { members: Named[] } | null;
};

export type AssignmentGroup<R extends GroupableRow> = {
  assignmentId: string;
  courseId: string;
  title: string;
  /** Every row in this bucket for this assignment, in the order the payload had them. */
  rows: R[];
  /**
   * Who is waiting, in the order their rows appear, without repeats.
   *
   * A student can hold two rows in one bucket only if they have two submissions against one
   * assignment, which the schema forbids — but the deduplication is here anyway, because a
   * subtext that named somebody twice would read as two people with the same name. A team's row
   * contributes every member, and a set is a partition, so no two rows for one assignment can
   * name the same person either.
   */
  studentNames: string[];
};

/** What a student is called in the subtext, falling back the way every other screen does. */
export function triageStudentName(student: Named): string {
  return student.displayName ?? student.email ?? "Unknown student";
}

/**
 * Everybody one row is waiting on: one student, or every member of a team.
 *
 * **A team's row is work belonging to several people, so it names all of them.** The subtext
 * exists for recognition — an instructor scanning for whether a particular student is in the pile
 * — and naming only the member who happens to hold the team's row answers that question wrongly
 * for everybody else on it. It is also the member the pile is least about: which of them claimed
 * the row is an accident of who pressed Accept first.
 *
 * The team's own name is deliberately not among them. It belongs on the queue and the review
 * header, where the question is which piece of work this is; here the question is who, and three
 * names is already the budget.
 */
export function rowNames(row: GroupableRow): string[] {
  if (!row.team) return [triageStudentName(row.student)];
  return row.team.members.map(triageStudentName);
}

/**
 * One bucket's rows, grouped into the assignments they belong to.
 *
 * Ordered by how many are waiting, most first, with the title as a tie-break so the order is
 * total and two renders put the groups in the same places. Most-first because the question the
 * screen answers is what to pick up, and the biggest pile is the usual answer — an alphabetical
 * list would put that decision back on the reader.
 */
export function groupByAssignment<R extends GroupableRow>(
  rows: readonly R[],
): AssignmentGroup<R>[] {
  const groups = new Map<string, AssignmentGroup<R>>();

  for (const row of rows) {
    const existing = groups.get(row.assignment.id);

    if (existing) {
      existing.rows.push(row);
      for (const name of rowNames(row)) {
        if (!existing.studentNames.includes(name)) existing.studentNames.push(name);
      }
      continue;
    }

    groups.set(row.assignment.id, {
      assignmentId: row.assignment.id,
      courseId: row.assignment.courseId,
      title: row.assignment.title,
      rows: [row],
      studentNames: rowNames(row),
    });
  }

  return [...groups.values()].sort(
    (a, b) => b.rows.length - a.rows.length || a.title.localeCompare(b.title),
  );
}

/** How many names fit on one line of subtext before the rest become a count. */
const NAMES_SHOWN = 3;

/**
 * The names under an assignment's title: the first few, then how many more.
 *
 * "Ada, Grace, Katherine and 9 more" rather than a list of twelve. The point of the names is
 * recognition — an instructor scanning for whether a particular student is in the pile — and past
 * three they stop being scannable and start being a paragraph.
 *
 * The remainder is counted rather than shown as a bare ellipsis, because "and 9 more" says how
 * much is behind it and "…" does not. A group of exactly `NAMES_SHOWN` or fewer gets no
 * remainder at all, so the common case reads as a plain list.
 */
export function nameSubtext(names: readonly string[], shown: number = NAMES_SHOWN): string {
  if (names.length === 0) return "";
  if (names.length <= shown) return names.join(", ");

  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}
