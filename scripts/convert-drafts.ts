/**
 * Splits open model-generated drafts written as one block of text into the summary and rows the
 * review screen now edits, and reports every section it leaves alone and why.
 *
 *   npm run convert:drafts                       # says what it would convert, and converts nothing
 *   npm run convert:drafts -- --apply            # converts
 *   npm run convert:drafts:deployment            # the same, against the deployment's project
 *   npm run convert:drafts:deployment -- --apply
 *
 * **One run, once.** Reports are now generated as parts, so after this has converted the drafts
 * that were waiting for review there is nothing left for it to find.
 *
 * **Which sections.** A section of an open draft (READY or NEEDS_MANUAL_REVIEW) that has rubric
 * rows — so the model wrote it — and no summary yet. Approved drafts are left alone: the student
 * has read them, and the released view reads their stored text. Hand grades have no rows.
 *
 * **How a report is split.** The text above the first scored heading is the summary, less the
 * title, any `---` rule and the old `## Coding Problems Scores` heading, which the assembled
 * layout writes back in its own places. Each `## Label: x/y` or `**Label: x/y**` heading opens a
 * row, and the lines beneath it are that row's feedback. In a frontend or SQL report each
 * `## Section: x/y` heading names a group, and each `- [x]` or `- [ ]` line beneath it is a row
 * whose indented lines are its feedback. Rows are matched to the stored rubric rows by position,
 * and the heading's own label becomes the row's label, because that is what the student would
 * have read.
 *
 * **Where an instructor has edited the text**, the edited text is split too, and the score in
 * each edited heading becomes that row's score. The edited section total is ignored: it is the
 * one figure an instructor was most likely to forget to update, and the total is now computed
 * from the rows.
 *
 * **A section is skipped rather than guessed at** when the headings and the rows differ in
 * number, when an unedited heading states a different score than its row, when a heading is out
 * of a different maximum than its row, when a heading that is not a scored row appears after the
 * first one (its text would belong to no row), or when a frontend section's edited subtotal
 * differs from its rows (a checkbox does not say which item a half point moved to). A skipped
 * section keeps working in the old single-box editor, and regenerating it gives it rows.
 */
import { config as loadEnv } from "dotenv";

import { composeReport, readReportRows, rowTotals, type ReportRow } from "../lib/grade/report-text";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const EPSILON = 0.001;

type Split =
  { ok: true; summaryMarkdown: string; rows: ReportRow[] } | { ok: false; reason: string };

/** "## Question 2: is_even: 1/3" or "**Question 2: is_even: 1/3**". */
const SCORED_HEADING = /^(?:##\s+(.+?)|\*\*(.+?)):\s*([\d.]+)\s*\/\s*([\d.]+)\s*(?:\*\*)?\s*$/;
const CHECKBOX = /^- \[([ xX])\]\s+(.*)$/;
/** Lines the assembled layout writes itself, so they are dropped rather than kept as text. */
const DROPPED = [/^#\s/, /^---\s*$/, /^##\s+Coding Problems Scores\s*$/i];

/**
 * Splits one report's text into a summary and rows, taking labels and feedback from the text and
 * everything else from the stored rows.
 *
 * `trustHeadings` is true for text an instructor edited: a heading's score is then the row's
 * score. For the model's own text the stored row is the score, and a heading that disagrees with
 * it is a reason to stop.
 */
export function splitReport(params: {
  text: string;
  stored: ReportRow[];
  checklist: boolean;
  trustHeadings: boolean;
}): Split {
  const lines = params.text.split("\n");
  const summary: string[] = [];
  type Block = { label: string; earned: number; possible: number; body: string[] };
  const blocks: Block[] = [];

  for (const line of lines) {
    const heading = line.match(SCORED_HEADING);
    if (heading) {
      blocks.push({
        label: (heading[1] ?? heading[2]).trim(),
        earned: Number(heading[3]),
        possible: Number(heading[4]),
        body: [],
      });
      continue;
    }
    const current = blocks.at(-1);
    if (!current) {
      if (!DROPPED.some((pattern) => pattern.test(line))) summary.push(line);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      return { ok: false, reason: `a heading that is not a scored row: "${line.trim()}"` };
    }
    current.body.push(line);
  }

  const rows: ReportRow[] = [];
  if (!params.checklist) {
    if (blocks.length !== params.stored.length) {
      return {
        ok: false,
        reason: `${blocks.length} scored headings but ${params.stored.length} rubric rows`,
      };
    }
    for (const [index, block] of blocks.entries()) {
      const row = params.stored[index];
      const mismatch = checkScore(block, row, params.trustHeadings);
      if (mismatch) return { ok: false, reason: mismatch };
      rows.push({
        ...row,
        label: block.label,
        group: null,
        scoreEarned: params.trustHeadings ? block.earned : row.scoreEarned,
        feedbackMarkdown: trimBlankLines(block.body)
          .join("\n")
          .replace(/\n?---\s*$/, "")
          .trim(),
      });
    }
  } else {
    let index = 0;
    for (const block of blocks) {
      const start = index;
      let item: ReportRow | null = null;
      let feedback: string[] = [];
      const finish = () => {
        if (item)
          rows.push({ ...item, feedbackMarkdown: trimBlankLines(feedback).join("\n").trim() });
      };
      for (const line of block.body) {
        const box = line.match(CHECKBOX);
        if (box) {
          finish();
          const row = params.stored[index];
          if (!row) return { ok: false, reason: `more checklist items than rubric rows` };
          item = { ...row, label: box[2].trim(), group: block.label };
          feedback = [];
          index += 1;
        } else if (item) {
          feedback.push(line.replace(/^ {2}/, ""));
        } else if (line.trim() !== "" && !/^---\s*$/.test(line)) {
          return {
            ok: false,
            reason: `text under "${block.label}" before its first checklist item`,
          };
        }
      }
      finish();
      const members = params.stored.slice(start, index);
      const subtotal = rowTotals(members);
      if (
        Math.abs((subtotal.earned ?? 0) - block.earned) > EPSILON ||
        Math.abs(subtotal.possible - block.possible) > EPSILON
      ) {
        return {
          ok: false,
          reason:
            `"${block.label}" says ${block.earned}/${block.possible} but its rubric rows add up to ` +
            `${subtotal.earned}/${subtotal.possible}`,
        };
      }
    }
    if (index !== params.stored.length) {
      return {
        ok: false,
        reason: `${index} checklist items but ${params.stored.length} rubric rows`,
      };
    }
  }

  return { ok: true, summaryMarkdown: trimBlankLines(summary).join("\n").trim(), rows };
}

function checkScore(
  block: { label: string; earned: number; possible: number },
  row: ReportRow,
  trustHeadings: boolean,
): string | null {
  if (Math.abs(block.possible - row.scorePossible) > EPSILON) {
    return `"${block.label}" is out of ${block.possible} but its rubric row is out of ${row.scorePossible}`;
  }
  if (block.earned - block.possible > EPSILON) {
    return `"${block.label}" scores ${block.earned}, above its maximum of ${block.possible}`;
  }
  if (!trustHeadings && Math.abs(block.earned - (row.scoreEarned ?? 0)) > EPSILON) {
    return `"${block.label}" says ${block.earned} but its rubric row says ${row.scoreEarned}`;
  }
  return null;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

async function main() {
  const applying = process.argv.includes("--apply");
  const { db } = await import("../lib/prisma");

  try {
    const sections = await db.gradingDraftSection.findMany({
      where: {
        summaryMarkdown: null,
        gradingDraft: { status: { in: ["READY", "NEEDS_MANUAL_REVIEW"] } },
      },
      select: {
        id: true,
        sectionType: true,
        reportMarkdown: true,
        rubricItems: true,
        editedReportMarkdown: true,
        editedScoreEarned: true,
        gradingDraft: {
          select: {
            id: true,
            submission: {
              select: {
                student: { select: { displayName: true, email: true } },
                assignment: { select: { title: true } },
              },
            },
          },
        },
      },
    });

    const modelWritten = sections.filter(
      (section) => readReportRows(section.rubricItems).length > 0,
    );
    console.log(
      `${modelWritten.length} model-generated section(s) on open drafts are written as one block ` +
        `of text.${applying ? "" : " Dry run: nothing will be written. Pass --apply to convert."}\n`,
    );

    let converted = 0;
    for (const section of modelWritten) {
      const who = section.gradingDraft.submission;
      const name = `${who.assignment.title} — ${who.student.displayName ?? who.student.email ?? "unknown"} — ${section.sectionType}`;
      const stored = readReportRows(section.rubricItems);
      const checklist =
        section.sectionType === "coding_frontend" || section.sectionType === "coding_sql";

      const model = splitReport({
        text: section.reportMarkdown ?? "",
        stored,
        checklist,
        trustHeadings: false,
      });
      if (!model.ok) {
        console.log(`  skipped   ${name}\n            the model's text: ${model.reason}`);
        continue;
      }

      const edited =
        section.editedReportMarkdown === null
          ? null
          : splitReport({
              text: section.editedReportMarkdown,
              stored,
              checklist,
              trustHeadings: true,
            });
      if (edited && !edited.ok) {
        console.log(`  skipped   ${name}\n            your edited text: ${edited.reason}`);
        continue;
      }

      const notes: string[] = [];
      const editedTotal = edited?.ok ? rowTotals(edited.rows).earned : null;
      if (section.editedScoreEarned !== null) {
        const total = editedTotal ?? rowTotals(model.rows).earned;
        if (Math.abs((section.editedScoreEarned ?? 0) - (total ?? 0)) > EPSILON) {
          notes.push(
            `the stored section score ${section.editedScoreEarned} is replaced by the questions' ` +
              `sum, ${total}`,
          );
        }
      }

      console.log(
        `  ${applying ? "converted" : "would convert"} ${name}` +
          `${edited ? " (with your edits)" : ""}` +
          notes.map((note) => `\n            ${note}`).join(""),
      );
      converted += 1;
      if (!applying) continue;

      await db.gradingDraftSection.update({
        where: { id: section.id },
        data: {
          summaryMarkdown: model.summaryMarkdown,
          rubricItems: model.rows,
          reportMarkdown: composeReport({
            sectionType: section.sectionType,
            summaryMarkdown: model.summaryMarkdown,
            rows: model.rows,
          }),
          scoreEarned: rowTotals(model.rows).earned,
          ...(edited?.ok
            ? {
                editedSummaryMarkdown: edited.summaryMarkdown,
                editedRubricItems: edited.rows,
                editedReportMarkdown: composeReport({
                  sectionType: section.sectionType,
                  summaryMarkdown: edited.summaryMarkdown,
                  rows: edited.rows,
                }),
                editedScoreEarned: rowTotals(edited.rows).earned,
              }
            : // A score edited without the text: the questions are trusted, so the edit goes.
              { editedScoreEarned: null }),
        },
      });
    }

    console.log(
      `\n${converted} of ${modelWritten.length} section(s) ${applying ? "converted" : "can be converted"}.`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("convert-drafts.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
