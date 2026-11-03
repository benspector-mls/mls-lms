/**
 * Skills: what each graded section is evidence of, and the arithmetic over that evidence.
 *
 * **The taxonomies live in three tables**, one taxonomy per discipline, groups under it, skills
 * under the groups, which admins author on the Skills screen. A section of an assignment names
 * the skill it is evidence of by id in `assignments.sections`. This module holds the pure
 * functions the Skills tabs need over evidence they have been handed.
 *
 * **Evidence is read, never stored.** A fellow's figure for a skill is computed at request time
 * from the latest approved round of each of their submissions (`lib/skills/evidence.ts` reads
 * them), so a grade corrected in the review screen is read correctly the next time the tab opens,
 * a re-tagged section moves every fellow's figure at once, and a renamed skill renames every
 * column.
 *
 * **No bars, no bands, no minimum.** The tabs render each figure as earned over possible and
 * nothing judges it: a skill share is a grade, and a low grade already shows as incomplete work
 * on the Performance tab, so coloring it here would count the same shortfall twice.
 *
 * Browser-safe and importing nothing, in the manner of `lib/competencies.ts`.
 */

/**
 * The two writing flags that mark a slip of attention rather than of thought: spelling and
 * grammar, and markdown that does not render. Counted beside Technical Writing as a rough signal,
 * because the rubric scores attention to detail as half of one writing band rather than on its
 * own. A count of assignments flagged, not a score.
 */
export const DETAIL_FLAGS = ["MECHANICAL", "MARKDOWN"] as const;

/** The canonical id of the skill the proofreading count is shown beside. */
export const WRITING_SKILL = "technical-writing";

/** One approved section, as the loader hands it over: what was scored, for whom, and when. */
export type SkillEvidence = {
  studentId: string;
  assignmentId: string;
  assignmentTitle: string;
  /** The assignment's course, which addresses the fellow's work on it. */
  courseId: string;
  /** The fellow's own submission row, which the record's history links to. */
  submissionId: string;
  /** The class deadline, which orders the record's history. */
  dueAt: Date;
  sectionType: string;
  /** The instructor's score where they edited, otherwise the model's. */
  scoreEarned: number | null;
  scorePossible: number | null;
  /** The round's flags, which are what the run raised about the whole piece of work. */
  flags: string[];
  /** The skill the section's declaration on the assignment names, or null when it names none. */
  skillId: string | null;
};

export type SkillFigure = {
  earned: number;
  possible: number;
  /** How many sections contributed. */
  sections: number;
  /**
   * Of the assignments with a section counted toward this skill, how many raised a detail flag.
   * Kept on the Technical Writing figure and zero on every other.
   */
  flagged: number;
  flaggable: number;
};

/** The columns of a skill row the arithmetic reads. */
export type SkillRow = { id: string; canonicalId: string };

/** The figure a fellow with no evidence has: nothing earned over nothing, so the tab says so. */
export const EMPTY_FIGURE: SkillFigure = {
  earned: 0,
  possible: 0,
  sections: 0,
  flagged: 0,
  flaggable: 0,
};

/**
 * The skill one piece of evidence counts toward, or null.
 *
 * A section counts its effective score toward the skill its declaration names. A section that
 * names no skill, names one that is not in the taxonomy being read, or has no score counts toward
 * nothing.
 */
function countsToward(evidence: SkillEvidence, known: ReadonlySet<string>): string | null {
  if (evidence.skillId === null || !known.has(evidence.skillId)) return null;
  if (evidence.scoreEarned === null || evidence.scorePossible === null) return null;
  return evidence.skillId;
}

function hasDetailFlag(evidence: SkillEvidence): boolean {
  return evidence.flags.some((flag) => (DETAIL_FLAGS as readonly string[]).includes(flag));
}

/**
 * One fellow's figure for every skill, keyed by skill id. Every skill gets an entry, so a column
 * with nothing behind it reads as empty rather than missing.
 */
export function skillFigures(
  evidence: readonly SkillEvidence[],
  skills: readonly SkillRow[],
): Map<string, SkillFigure> {
  const known = new Set(skills.map((skill) => skill.id));
  const figures = new Map<string, SkillFigure>(
    skills.map((skill) => [skill.id, { ...EMPTY_FIGURE }]),
  );

  for (const item of evidence) {
    const skillId = countsToward(item, known);
    if (skillId === null) continue;
    const figure = figures.get(skillId)!;
    figure.earned = roundPoints(figure.earned + item.scoreEarned!);
    figure.possible = roundPoints(figure.possible + item.scorePossible!);
    figure.sections += 1;
  }

  /*
    Assignments flagged for proofreading, counted per assignment rather than per section: the
    flags belong to the round, so every section of a round carries them, and one piece of work is
    one thing to be flagged. Only assignments with a section counted toward Technical Writing are
    counted, since that is the figure the count sits beside.
  */
  const writing = skills.find((skill) => skill.canonicalId === WRITING_SKILL);
  if (writing !== undefined) {
    const flaggedBy = new Map<string, boolean>();
    for (const item of evidence) {
      if (countsToward(item, known) !== writing.id) continue;
      flaggedBy.set(
        item.assignmentId,
        (flaggedBy.get(item.assignmentId) ?? false) || hasDetailFlag(item),
      );
    }
    const figure = figures.get(writing.id)!;
    figure.flaggable = flaggedBy.size;
    figure.flagged = [...flaggedBy.values()].filter(Boolean).length;
  }

  return figures;
}

/** One contributing section on the record's history, under the skill it counted toward. */
export type SkillHistoryLine = {
  skillId: string;
  assignmentId: string;
  assignmentTitle: string;
  courseId: string;
  submissionId: string;
  dueAt: Date;
  earned: number;
  possible: number;
  /** A section counted toward Technical Writing whose round raised a detail flag. */
  flagged: boolean;
};

/** Every contributing section, oldest due date first, for the reading of development over a term. */
export function skillHistory(
  evidence: readonly SkillEvidence[],
  skills: readonly SkillRow[],
): SkillHistoryLine[] {
  const known = new Set(skills.map((skill) => skill.id));
  const writingId = skills.find((skill) => skill.canonicalId === WRITING_SKILL)?.id ?? null;
  const lines: SkillHistoryLine[] = [];
  for (const item of evidence) {
    const skillId = countsToward(item, known);
    if (skillId === null) continue;
    lines.push({
      skillId,
      assignmentId: item.assignmentId,
      assignmentTitle: item.assignmentTitle,
      courseId: item.courseId,
      submissionId: item.submissionId,
      dueAt: item.dueAt,
      earned: roundPoints(item.scoreEarned!),
      possible: roundPoints(item.scorePossible!),
      flagged: skillId === writingId && hasDetailFlag(item),
    });
  }
  return lines.sort(
    (a, b) =>
      a.dueAt.getTime() - b.dueAt.getTime() || a.assignmentTitle.localeCompare(b.assignmentTitle),
  );
}

/**
 * One figure per group: its skills' figures added together, which is what the Fellows grid draws
 * a column of. The flag counts are the Technical Writing skill's, carried onto its group alone.
 */
export function groupFigures(
  figures: ReadonlyMap<string, SkillFigure>,
  groups: readonly { id: string; skills: readonly { id: string }[] }[],
): Map<string, SkillFigure> {
  const result = new Map<string, SkillFigure>();
  for (const group of groups) {
    const total: SkillFigure = { ...EMPTY_FIGURE };
    for (const skill of group.skills) {
      const figure = figures.get(skill.id);
      if (!figure) continue;
      total.earned = roundPoints(total.earned + figure.earned);
      total.possible = roundPoints(total.possible + figure.possible);
      total.sections += figure.sections;
      total.flagged += figure.flagged;
      total.flaggable += figure.flaggable;
    }
    result.set(group.id, total);
  }
  return result;
}

/** Earned over possible, or null with nothing behind it. */
export function skillShare(figure: SkillFigure): number | null {
  return figure.possible > 0 ? figure.earned / figure.possible : null;
}

/** Rounded to two decimal places, so half points added in floating point do not print as 17.4999. */
function roundPoints(points: number): number {
  return Math.round(points * 100) / 100;
}
