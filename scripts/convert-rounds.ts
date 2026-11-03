/**
 * Rewrites every grading round into the current shape — a summary on the round and one section
 * per scored unit, each carrying its declared key — and reports every round it leaves alone and
 * why.
 *
 *   npm run convert:rounds                       # says what it would convert, and converts nothing
 *   npm run convert:rounds -- --apply            # converts
 *   npm run convert:rounds:deployment            # the same, against the deployment's project
 *   npm run convert:rounds:deployment -- --apply
 *
 * **One run, once, after `convert:sections`.** A round's rows are matched to the declaration that
 * script writes, so the declaration goes first. Rounds in every state are converted, approved ones
 * included: the student's page reads a round's sections, and a released round left in the old
 * shape would read differently from one released after it. What was posted to the pull request is
 * a comment on GitHub and is not touched.
 *
 * **A model-graded section becomes one section per row.** Each row is matched to a declared unit
 * of the same type, by label where the labels agree and by position where they do not but the
 * counts do; the new section carries the unit's key and label, the row's score, feedback and
 * reasoning, and the instructor's edited score and feedback where the edited rows hold them. The
 * section's summary, flags, notes, confidence and process note move to the round. The writing row
 * of a short response becomes the writing section.
 *
 * **A hand-written section keeps its one row**, gaining the key of the declared unit it matches —
 * the unit whose legacy key is the label the section stored — and the round gains an empty
 * summary.
 *
 * **A round is listed rather than guessed at** when a row matches no declared unit, when the
 * rows and the units of a type differ in number and in labels, when a hand-written section's
 * label matches no declared unit, or when the units a hand-written section would have to split
 * into number more than one. Such a round keeps working in the old shape on every screen.
 */
import { config as loadEnv } from "dotenv";

import {
  declaredUnits,
  hasUnconvertedSections,
  normalizedLabel,
  type DeclaredUnit,
} from "../lib/assignments/spec";
import { readReportRows, withoutStatedScoreLines, type ReportRow } from "../lib/grade/report-text";
import { companionsOf, isSectionType } from "../lib/section-types";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

type StoredSection = {
  id: string;
  sectionType: string;
  reportMarkdown: string | null;
  scoreEarned: number | null;
  scorePossible: number | null;
  rubricItems: unknown;
  editedRubricItems: unknown;
  summaryMarkdown: string | null;
  editedSummaryMarkdown: string | null;
  flags: string[];
  instructorNotes: string[];
  confidence: "HIGH" | "LOW" | null;
  submissionProcessNote: string | null;
  editedReportMarkdown: string | null;
  editedScoreEarned: number | null;
  editedAt: Date | null;
  editedById: string | null;
};

/** A hand-written section as the conversion rewrites it in place. */
export type KeptSection = {
  sectionId: string;
  sectionKey: string;
  label: string;
  heading: string | null;
  skillId: string | null;
  sectionType: string;
  reportMarkdown: string | null;
  editedReportMarkdown: string | null;
};

export type NewSection = {
  sectionKey: string;
  label: string;
  heading: string | null;
  skillId: string | null;
  sectionType: string;
  reportMarkdown: string | null;
  scoreEarned: number | null;
  scorePossible: number;
  modelReasoning: string | null;
  editedReportMarkdown: string | null;
  editedScoreEarned: number | null;
  editedAt: Date | null;
  editedById: string | null;
};

export type RoundPlan =
  | {
      ok: true;
      summaryMarkdown: string;
      editedSummaryMarkdown: string | null;
      flags: string[];
      instructorNotes: string[];
      confidence: "HIGH" | "LOW" | null;
      submissionProcessNote: string | null;
      /** Sections to replace: the stored section's id, and what it becomes. */
      replace: { sectionId: string; sections: NewSection[] }[];
      /** Hand-written sections that keep their row and gain a key, their declared fields, and text without a stated score. */
      keep: KeptSection[];
    }
  | { ok: false; reason: string };

/**
 * Pairs a section's rows with the declared units of its type, by label or by position.
 *
 * The writing row of a short response pairs with the one `short_response_writing` unit; every
 * other row pairs with a unit of the section's own type.
 */
function pairRows(
  sectionType: string,
  rows: ReportRow[],
  units: DeclaredUnit[],
): { row: ReportRow; unit: DeclaredUnit }[] | string {
  const companions = isSectionType(sectionType) ? companionsOf(sectionType) : [];
  const own = units.filter((unit) => unit.type === sectionType);
  const writingUnits = units.filter((unit) => (companions as string[]).includes(unit.type));

  const technicalRows = rows.filter((row) => !row.criterion.toLowerCase().includes("writing"));
  const writingRows = rows.filter((row) => row.criterion.toLowerCase().includes("writing"));

  const pairs: { row: ReportRow; unit: DeclaredUnit }[] = [];

  if (writingRows.length > 0) {
    if (writingRows.length !== 1 || writingUnits.length !== 1) {
      return `${writingRows.length} writing row(s) against ${writingUnits.length} writing section(s)`;
    }
    pairs.push({ row: writingRows[0]!, unit: writingUnits[0]! });
  }

  const byLabel = new Map(own.map((unit) => [normalizedLabel(unit.label), unit]));
  const labelled = technicalRows.map((row) => byLabel.get(normalizedLabel(row.label)));
  if (labelled.every((unit) => unit !== undefined) && new Set(labelled).size === labelled.length) {
    technicalRows.forEach((row, index) => pairs.push({ row, unit: labelled[index]! }));
    return pairs;
  }
  if (technicalRows.length === own.length) {
    technicalRows.forEach((row, index) => pairs.push({ row, unit: own[index]! }));
    return pairs;
  }
  return `${technicalRows.length} row(s) against ${own.length} ${sectionType} section(s), and the labels do not match`;
}

/** The plan for one round, or the reason it is left alone. Pure, so it can be checked without a database. */
export function planRound(
  draft: { summaryMarkdown: string | null; sections: StoredSection[] },
  declaration: unknown,
): RoundPlan {
  // Keyed against a declaration `convert:sections` has not reached, a round would carry the
  // type or label as its key, which the keys that conversion then writes would never match.
  if (hasUnconvertedSections(declaration)) {
    return {
      ok: false,
      reason: "the assignment's sections have not been converted; run convert:sections first",
    };
  }
  const units = declaredUnits(declaration);
  const summaries: string[] = [];
  const editedSummaries: string[] = [];
  let anyEditedSummary = false;
  const flags = new Set<string>();
  const notes: string[] = [];
  let confidence: "HIGH" | "LOW" | null = null;
  let processNote: string | null = null;
  const replace: { sectionId: string; sections: NewSection[] }[] = [];
  const keep: KeptSection[] = [];

  for (const section of draft.sections) {
    for (const flag of section.flags) flags.add(flag);
    notes.push(...section.instructorNotes);
    if (section.confidence === "LOW" || (confidence === null && section.confidence === "HIGH")) {
      confidence = section.confidence;
    }
    processNote ??= section.submissionProcessNote;

    const rows = readReportRows(section.rubricItems);
    if (rows.length === 0) {
      // Hand-written: one row, keyed by the unit whose legacy key is what the section stored.
      const matches = units.filter(
        (unit) =>
          unit.key === section.sectionType ||
          normalizedLabel(unit.label) === normalizedLabel(section.sectionType),
      );
      if (matches.length !== 1) {
        return {
          ok: false,
          reason:
            `the hand-written "${section.sectionType}" section matches ${matches.length} declared ` +
            `section(s); a score written whole cannot be divided`,
        };
      }
      const unit = matches[0]!;
      /*
        Its text is the whole report the instructor wrote, which may open with a title stating
        the score. Keyed, the text is composed under a heading the application writes with the
        score beside it, so such a title would state the score a second time and, after a
        correction, a different one. The title line goes; the heading is where the score lives.
      */
      keep.push({
        sectionId: section.id,
        sectionKey: unit.key,
        label: unit.label,
        heading: unit.heading,
        skillId: unit.skillId,
        sectionType: unit.type,
        reportMarkdown:
          section.reportMarkdown === null ? null : withoutStatedScoreLines(section.reportMarkdown),
        editedReportMarkdown:
          section.editedReportMarkdown === null
            ? null
            : withoutStatedScoreLines(section.editedReportMarkdown),
      });
      continue;
    }

    const paired = pairRows(section.sectionType, rows, units);
    if (typeof paired === "string")
      return { ok: false, reason: `${section.sectionType}: ${paired}` };

    const edited = readReportRows(section.editedRubricItems);
    const editedByLabel = new Map(edited.map((row) => [normalizedLabel(row.label), row]));
    summaries.push(section.summaryMarkdown ?? "");
    if (section.editedSummaryMarkdown !== null) anyEditedSummary = true;
    editedSummaries.push(section.editedSummaryMarkdown ?? section.summaryMarkdown ?? "");

    replace.push({
      sectionId: section.id,
      sections: paired.map(({ row, unit }) => {
        const editedRow =
          edited.length === rows.length ? editedByLabel.get(normalizedLabel(row.label)) : undefined;
        const textEdited =
          editedRow !== undefined && editedRow.feedbackMarkdown !== row.feedbackMarkdown;
        const scoreEdited = editedRow !== undefined && editedRow.scoreEarned !== row.scoreEarned;
        return {
          sectionKey: unit.key,
          label: unit.label,
          heading: unit.heading,
          skillId: unit.skillId,
          sectionType: unit.type,
          reportMarkdown: row.feedbackMarkdown,
          scoreEarned: row.scoreEarned,
          scorePossible: row.scorePossible,
          modelReasoning: row.modelReasoning,
          editedReportMarkdown: textEdited ? editedRow!.feedbackMarkdown : null,
          editedScoreEarned: scoreEdited ? editedRow!.scoreEarned : null,
          // Stamped only on a row the instructor changed, so the history names them as the
          // reviser of the questions they revised and of no others.
          editedAt: textEdited || scoreEdited ? section.editedAt : null,
          editedById: textEdited || scoreEdited ? section.editedById : null,
        };
      }),
    });
  }

  /*
    One reading of the test evidence for the round, by the rule a generated round follows: a
    section that expected tests speaks for the round, and "no tests by design" is kept only when
    no section expected any, so a converted checkpoint does not carry both.
  */
  if (["TEST_EVIDENCE", "TEST_RUN_MISSING", "TEST_MATCH_MISSING"].some((flag) => flags.has(flag))) {
    flags.delete("NO_TESTS_EXPECTED");
  }

  const summaryMarkdown = summaries.filter((s) => s.trim() !== "").join("\n\n");
  const editedSummaryMarkdown = anyEditedSummary
    ? editedSummaries.filter((s) => s.trim() !== "").join("\n\n")
    : null;

  return {
    ok: true,
    summaryMarkdown: draft.summaryMarkdown ?? summaryMarkdown,
    editedSummaryMarkdown,
    flags: [...flags],
    instructorNotes: notes,
    confidence,
    submissionProcessNote: processNote,
    replace,
    keep,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { db } = await import("../lib/prisma");

  const drafts = await db.gradingDraft.findMany({
    where: { sections: { some: { sectionKey: null } } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      summaryMarkdown: true,
      submission: {
        select: {
          student: { select: { displayName: true, email: true } },
          assignment: {
            select: { title: true, sections: true, course: { select: { name: true } } },
          },
        },
      },
      sections: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          sectionType: true,
          reportMarkdown: true,
          scoreEarned: true,
          scorePossible: true,
          rubricItems: true,
          editedRubricItems: true,
          summaryMarkdown: true,
          editedSummaryMarkdown: true,
          flags: true,
          instructorNotes: true,
          confidence: true,
          submissionProcessNote: true,
          editedReportMarkdown: true,
          editedScoreEarned: true,
          editedAt: true,
          editedById: true,
        },
      },
    },
  });

  let converted = 0;
  const refused: string[] = [];

  for (const draft of drafts) {
    const who = draft.submission.student.displayName ?? draft.submission.student.email ?? "?";
    const where = `${draft.submission.assignment.course.name} › ${draft.submission.assignment.title} › ${who}`;
    const plan = planRound(draft, draft.submission.assignment.sections);
    if (!plan.ok) {
      refused.push(`${where} (${draft.status}): ${plan.reason}`);
      continue;
    }

    console.log(
      `${where} (${draft.status}): ${plan.replace.reduce((n, r) => n + r.sections.length, 0)} ` +
        `section(s) from rows, ${plan.keep.length} kept`,
    );
    if (apply) {
      await db.$transaction(async (tx) => {
        await tx.gradingDraft.update({
          where: { id: draft.id },
          data: {
            summaryMarkdown: plan.summaryMarkdown,
            editedSummaryMarkdown: plan.editedSummaryMarkdown,
            flags: plan.flags,
            instructorNotes: plan.instructorNotes,
            confidence: plan.confidence,
            submissionProcessNote: plan.submissionProcessNote,
          },
        });
        for (const kept of plan.keep) {
          await tx.gradingDraftSection.update({
            where: { id: kept.sectionId },
            data: {
              sectionKey: kept.sectionKey,
              label: kept.label,
              heading: kept.heading,
              skillId: kept.skillId,
              sectionType: kept.sectionType,
              reportMarkdown: kept.reportMarkdown,
              editedReportMarkdown: kept.editedReportMarkdown,
            },
          });
        }
        for (const replaced of plan.replace) {
          await tx.gradingDraftSection.delete({ where: { id: replaced.sectionId } });
          for (const section of replaced.sections) {
            await tx.gradingDraftSection.create({
              data: { gradingDraftId: draft.id, ...section },
            });
          }
        }
      });
    }
    converted += 1;
  }

  console.log("");
  console.log(
    `${apply ? "Converted" : "Would convert"} ${converted} round(s); ${refused.length} left alone.`,
  );
  for (const line of refused) console.log(`  ! ${line}`);
  if (!apply && converted > 0) console.log("\nRun again with --apply to write these.");

  await db.$disconnect();
}

if (process.argv[1] && /convert-rounds\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
