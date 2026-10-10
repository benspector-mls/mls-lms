import { isSectionType, SECTION_TYPE_REGISTRY } from "../section-types";

/**
 * Building a report's text from its parts, and reading facts back out of a report's prose.
 *
 * Kept free of database and network imports so the review interface can run these in the
 * browser. That matters more than it sounds: the interface previews the comment an instructor is
 * about to post, and the server writes that same comment when the edit is saved. If those two
 * used different rules, the preview would show one document and the student would receive
 * another.
 */

/**
 * One scored row of a report: what the model returned for one question or checklist item, with
 * the instructor's edits applied.
 *
 * `scoreEarned` is null only while an instructor has emptied the box, which the review screen
 * refuses to save or release. Every stored row carries a number.
 */
export type ReportRow = {
  /** "Question 2: is_even", or a checklist item copied from the README. */
  label: string;
  /**
   * The heading a checklist item is listed under, such as "Section 3: Fetch Helpers". Null for
   * a row that is a heading of its own, which is every row outside the frontend and SQL reports.
   */
  group: string | null;
  criterion: string;
  scoreEarned: number | null;
  scorePossible: number;
  /** What the student reads beneath the row. Empty for a row with nothing to say. */
  feedbackMarkdown: string;
  /** Why the model gave this score. For the instructor, and never part of the posted comment. */
  modelReasoning: string | null;
};

/**
 * The rows stored in `rubric_items` or `edited_rubric_items`, narrowed from JSON.
 *
 * A row written before reports were assembled from parts has no `feedbackMarkdown` and calls
 * its reasoning `note`. Both are read, so the conversion script and the review screen can tell
 * such a row apart without a second reader.
 */
export function readReportRows(value: unknown): ReportRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.label !== "string") return [];
    const reasoning = row.modelReasoning ?? row.note;
    return [
      {
        label: row.label,
        group: typeof row.group === "string" && row.group.trim() !== "" ? row.group : null,
        criterion: typeof row.criterion === "string" ? row.criterion : "",
        scoreEarned: typeof row.scoreEarned === "number" ? row.scoreEarned : null,
        scorePossible: typeof row.scorePossible === "number" ? row.scorePossible : 0,
        feedbackMarkdown: typeof row.feedbackMarkdown === "string" ? row.feedbackMarkdown : "",
        modelReasoning: typeof reasoning === "string" ? reasoning : null,
      },
    ];
  });
}

/**
 * What a set of rows adds up to. The earned total is null while any row has no score, because a
 * total that silently counted an empty box as zero would be a grade nobody chose.
 */
export function rowTotals(rows: Pick<ReportRow, "scoreEarned" | "scorePossible">[]): {
  earned: number | null;
  possible: number;
} {
  let earned: number | null = 0;
  let possible = 0;
  for (const row of rows) {
    possible += row.scorePossible;
    earned = earned === null || row.scoreEarned === null ? null : earned + row.scoreEarned;
  }
  return {
    earned: earned === null ? null : roundPoints(earned),
    possible: roundPoints(possible),
  };
}

/**
 * Rounded to two decimal places, because half points are added together in floating point and
 * 0.1 + 0.2 is not 0.3. A student reading "17.499999999999996/25" would rightly distrust the
 * rest of the report.
 */
function roundPoints(points: number): number {
  return Math.round(points * 100) / 100;
}

/** "5/10 = 50%". A score not yet entered reads as a question mark in the preview. */
function scoreText(earned: number | null, possible: number, withPercentage: boolean): string {
  const fraction = `${earned ?? "?"}/${possible}`;
  if (!withPercentage || earned === null || possible <= 0) return fraction;
  return `${fraction} = ${Math.round((earned / possible) * 100)}%`;
}

/** Two spaces before every line, so a block of bullets nests under the checklist item above it. */
function indent(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `  ${line}`))
    .join("\n");
}

/** A row earns a ticked box only at full marks; half credit leaves the box empty. */
function isFullMarks(row: ReportRow): boolean {
  return row.scoreEarned !== null && row.scorePossible - row.scoreEarned < 0.001;
}

/**
 * The document posted to the pull request for one section, built from the summary and the rows.
 *
 * Every section type has the same layout, so a student reading two reports finds the score in
 * the same place in both:
 *
 * ```
 * # Coding Fluency Score Report: 23/39 = 59%
 *
 * <summary>
 *
 * ---
 *
 * ## Question 1: calculate_area: 3/3
 *
 * <feedback>
 * ```
 *
 * A row with a `group` is a checklist item. It is written as a `- [x]` or `- [ ]` line under a
 * `## group: subtotal` heading, with its feedback nested beneath it. Rows sharing a group are
 * listed under the group's first appearance.
 */
export function composeReport(params: {
  sectionType: string;
  summaryMarkdown: string;
  rows: ReportRow[];
}): string {
  const title = isSectionType(params.sectionType)
    ? SECTION_TYPE_REGISTRY[params.sectionType].reportTitle
    : "Score Report";
  /*
    A blank group is no group. The model returns rows straight into this at generation, and a row
    whose group came back as "" would otherwise open a checklist under a heading with no name.
  */
  const rows = params.rows.map((row) => (row.group?.trim() ? row : { ...row, group: null }));
  const total = rowTotals(rows);
  const blocks: string[] = [`# ${title}: ${scoreText(total.earned, total.possible, true)}`];

  const summary = params.summaryMarkdown.trim();
  if (summary) blocks.push(summary, "---");

  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    if (row.group !== null) groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
  }

  const written = new Set<string>();
  for (const row of rows) {
    if (row.group === null) {
      const heading = `## ${row.label}: ${scoreText(row.scoreEarned, row.scorePossible, false)}`;
      const feedback = row.feedbackMarkdown.trim();
      blocks.push(feedback ? `${heading}\n\n${feedback}` : heading);
      continue;
    }

    if (written.has(row.group)) continue;
    written.add(row.group);
    const members = groups.get(row.group) ?? [];
    const subtotal = rowTotals(members);
    const items = members.map((member) => {
      const line = `- [${isFullMarks(member) ? "x" : " "}] ${member.label}`;
      const feedback = member.feedbackMarkdown.trim();
      return feedback ? `${line}\n${indent(feedback)}` : line;
    });
    blocks.push(
      `## ${row.group}: ${scoreText(subtotal.earned, subtotal.possible, false)}\n\n${items.join("\n")}`,
    );
  }

  return blocks.join("\n\n");
}

/**
 * The score a report's own text claims, or null if it states none.
 *
 * Matches the title the report carries its score in: "Coding Fluency Score Report: 23/39 = 59%"
 * and "Frontend Coding Report: 5.5/6 = 92%", with or without the percentage. A report the
 * application assembled always agrees with its rows, so this matters for text a person wrote
 * whole — a hand grade, or a correction — where an instructor can change the prose and the
 * recorded number independently, and editing "28/30" into the text while the column still says
 * 30 would hand the student one figure and the gradebook another.
 */
export function statedScoreInText(markdown: string): { earned: number; possible: number } | null {
  const match = markdown.match(/^#{1,3}\s.*?(?:Score|Report):\s*([\d.]+)\s*\/\s*([\d.]+)/im);
  return match ? { earned: Number(match[1]), possible: Number(match[2]) } : null;
}
