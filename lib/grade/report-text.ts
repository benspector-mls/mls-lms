import { companionOf, isSectionType, SECTION_TYPE_REGISTRY } from "../section-types";

/**
 * Building a round's report from its parts, and reading facts back out of a report's prose.
 *
 * Kept free of database and network imports so the review interface can run these in the
 * browser. That matters more than it sounds: the interface previews the comment an instructor is
 * about to post, and the server writes that same comment when the edit is saved. If those two
 * used different rules, the preview would show one document and the student would receive
 * another.
 */

/**
 * One section of a round as the report is composed from it: what the assignment declared it
 * as, and what it scored.
 *
 * `scoreEarned` is null only while an instructor has emptied the box, which the review screen
 * refuses to release. Every stored section carries a number once it is scored.
 */
export type ReportSection = {
  /** "Question 2: is_even", or a checklist item copied from the README. */
  label: string;
  /**
   * The heading the section is listed under, such as "From Scratch" or "Section 3: Fetch
   * Helpers". Null for a section that is a heading of its own.
   */
  heading: string | null;
  /** The instrument that filled it: a type from lib/section-types.ts, or `manual`. */
  type: string;
  scoreEarned: number | null;
  scorePossible: number;
  /** What the student reads beneath the section. Empty for a section with nothing to say. */
  feedbackMarkdown: string;
};

/**
 * What a set of sections adds up to. The earned total is null while any section has no score,
 * because a total that silently counted an empty box as zero would be a grade nobody chose.
 */
export function rowTotals(rows: Pick<ReportSection, "scoreEarned" | "scorePossible">[]): {
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

/** A checklist item earns a ticked box only at full marks; half credit leaves the box empty. */
function isFullMarks(section: ReportSection): boolean {
  return section.scoreEarned !== null && section.scorePossible - section.scoreEarned < 0.001;
}

/**
 * The title of a round's report: the report title of the one type its sections share, or
 * "Score Report" for a hand-graded round or one that mixes types. A companion type counts as its
 * primary, so a short response's questions and its writing section share one title.
 */
export function reportTitle(sections: Pick<ReportSection, "type">[]): string {
  const types = new Set(
    sections.map((section) =>
      isSectionType(section.type) ? (companionOf(section.type) ?? section.type) : section.type,
    ),
  );
  if (types.size === 1) {
    const [type] = types;
    if (type !== undefined && isSectionType(type)) return SECTION_TYPE_REGISTRY[type].reportTitle;
  }
  return "Score Report";
}

/**
 * The document posted to the pull request for one round, built from the summary and the
 * sections in declared order.
 *
 * Every round has the same layout, so a student reading two reports finds the score in the same
 * place in both:
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
 * A section with a heading is listed under it: the heading is written once, as `## heading:
 * subtotal`, and each section beneath it as a `###` heading with its score — or, for a frontend
 * checklist, as a `- [x]` or `- [ ]` line with its feedback nested beneath it. Sections sharing a
 * heading are listed under the heading's first appearance.
 */
export function composeRound(params: {
  summaryMarkdown: string;
  sections: ReportSection[];
}): string {
  const sections = params.sections.map((section) =>
    section.heading?.trim() ? section : { ...section, heading: null },
  );
  const total = rowTotals(sections);
  const blocks: string[] = [
    `# ${reportTitle(sections)}: ${scoreText(total.earned, total.possible, true)}`,
  ];

  const summary = params.summaryMarkdown.trim();
  if (summary) blocks.push(summary, "---");

  const groups = new Map<string, ReportSection[]>();
  for (const section of sections) {
    if (section.heading !== null) {
      groups.set(section.heading, [...(groups.get(section.heading) ?? []), section]);
    }
  }

  const written = new Set<string>();
  for (const section of sections) {
    if (section.heading === null) {
      const heading = `## ${section.label}: ${scoreText(section.scoreEarned, section.scorePossible, false)}`;
      const feedback = section.feedbackMarkdown.trim();
      blocks.push(feedback ? `${heading}\n\n${feedback}` : heading);
      continue;
    }

    if (written.has(section.heading)) continue;
    written.add(section.heading);
    const members = groups.get(section.heading) ?? [];
    const subtotal = rowTotals(members);
    const lines = members.map((member) => {
      const feedback = member.feedbackMarkdown.trim();
      if (member.type === "coding_frontend") {
        const line = `- [${isFullMarks(member) ? "x" : " "}] ${member.label}`;
        return feedback ? `${line}\n${indent(feedback)}` : line;
      }
      const heading = `### ${member.label}: ${scoreText(member.scoreEarned, member.scorePossible, false)}`;
      return feedback ? `${heading}\n\n${feedback}` : heading;
    });
    const checklist = members.every((member) => member.type === "coding_frontend");
    blocks.push(
      `## ${section.heading}: ${scoreText(subtotal.earned, subtotal.possible, false)}\n\n` +
        lines.join(checklist ? "\n" : "\n\n"),
    );
  }

  return blocks.join("\n\n");
}

/**
 * One scored row of a report written before sections were scored units: what the model returned
 * for one question or checklist item, stored as JSON in `rubric_items`.
 *
 * Read by `convert:rounds`, which turns each row into a section, and by nothing else once every
 * round has been converted.
 */
export type ReportRow = {
  label: string;
  group: string | null;
  criterion: string;
  scoreEarned: number | null;
  scorePossible: number;
  feedbackMarkdown: string;
  modelReasoning: string | null;
};

/** The rows stored in `rubric_items` or `edited_rubric_items`, narrowed from JSON. */
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
 * The score a report's own text claims, or null if it states none.
 *
 * Matches the title the report carries its score in: "Coding Fluency Score Report: 23/39 = 59%"
 * and "Frontend Coding Report: 5.5/6 = 92%", with or without the percentage. A report the
 * application composed always agrees with its sections, so this matters for text a person wrote
 * whole on a round from before sections were scored units, where an instructor can change the
 * prose and the recorded number independently.
 */
/**
 * The text without the first heading line that states a score, which is the line
 * `statedScoreInText` reads. A report written whole before sections were scored units opened
 * with such a title; composed under a heading the application writes, the title would state a
 * second score, so the conversion removes it and the score the heading carries is the only one.
 * Only the first such line, because a later one is a sub-heading the instructor wrote to
 * structure the report, and its words are part of the feedback.
 */
export function withoutStatedScoreLines(markdown: string): string {
  const lines = markdown.split("\n");
  const title = lines.findIndex((line) =>
    /^#{1,3}\s.*?(?:Score|Report):\s*[\d.]+\s*\/\s*[\d.]+/i.test(line),
  );
  if (title === -1) return markdown;
  return [...lines.slice(0, title), ...lines.slice(title + 1)].join("\n").trim();
}

export function statedScoreInText(markdown: string): { earned: number; possible: number } | null {
  const match = markdown.match(/^#{1,3}\s.*?(?:Score|Report):\s*([\d.]+)\s*\/\s*([\d.]+)/im);
  return match ? { earned: Number(match[1]), possible: Number(match[2]) } : null;
}
