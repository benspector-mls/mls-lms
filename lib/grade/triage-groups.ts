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

/** The parts of a triage row this reads. Structural, so a test can build a queue in a few lines. */
export type GroupableRow = {
  id: string;
  assignment: { id: string; courseId: string; title: string };
  student: { displayName: string | null; email: string | null };
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
   * subtext that named somebody twice would read as two people with the same name.
   */
  studentNames: string[];
};

/** What a student is called in the subtext, falling back the way every other screen does. */
export function triageStudentName(student: GroupableRow["student"]): string {
  return student.displayName ?? student.email ?? "Unknown student";
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
      const name = triageStudentName(row.student);
      if (!existing.studentNames.includes(name)) existing.studentNames.push(name);
      continue;
    }

    groups.set(row.assignment.id, {
      assignmentId: row.assignment.id,
      courseId: row.assignment.courseId,
      title: row.assignment.title,
      rows: [row],
      studentNames: [triageStudentName(row.student)],
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
