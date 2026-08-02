/**
 * Exercises the approval path against the real database, without posting anything.
 *
 * Run with `npm run verify:approve`.
 *
 * The case worth reading is the last one. An instructor can revise the report text and
 * the score independently, and the one edit that must never go out is a report saying
 * one number while the gradebook records another — the student reads the prose and
 * every other part of the system reads the column.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else console.log(`ok   ${label}`);
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { approveDraft, ApprovalError, buildFeedbackMarkdown, effectiveSection, statedScoreInText } =
    await import("../lib/grade/approve");

  // --- pure helpers ------------------------------------------------------
  check("an unedited section keeps the model's values",
    effectiveSection({
      sectionType: "short_response", reportMarkdown: "model text",
      scoreEarned: 9, scorePossible: 15,
      editedReportMarkdown: null, editedScoreEarned: null,
    }),
    { sectionType: "short_response", reportMarkdown: "model text", scoreEarned: 9, scorePossible: 15 });

  check("an edit wins over the model's values",
    effectiveSection({
      sectionType: "short_response", reportMarkdown: "model text",
      scoreEarned: 9, scorePossible: 15,
      editedReportMarkdown: "instructor text", editedScoreEarned: 11,
    }),
    { sectionType: "short_response", reportMarkdown: "instructor text", scoreEarned: 11, scorePossible: 15 });

  // A score of 0 is a real edit, not an absent one. `??` rather than `||` is what makes
  // the difference, and getting it wrong would silently restore the model's score every
  // time an instructor zeroed a section.
  check("an edited score of zero is honoured",
    effectiveSection({
      sectionType: "x", reportMarkdown: "t", scoreEarned: 9, scorePossible: 15,
      editedReportMarkdown: null, editedScoreEarned: 0,
    }).scoreEarned, 0);

  check("the score line is read out of the report text",
    statedScoreInText("# Report\n\n## Short Response Score: 11/15 = 73%"),
    { earned: 11, possible: 15 });
  check("a report with no score line states none",
    statedScoreInText("# Report\n\nNo score anywhere."), null);
  check("half credit in the text parses",
    statedScoreInText("## Score: 20.5/25 = 82%"), { earned: 20.5, possible: 25 });

  check("sections are joined with a rule between them",
    buildFeedbackMarkdown([
      { sectionType: "a", reportMarkdown: "first" },
      { sectionType: "b", reportMarkdown: "second" },
    ]),
    "first\n\n---\n\nsecond");
  check("a section with no report is skipped rather than leaving an empty block",
    buildFeedbackMarkdown([
      { sectionType: "a", reportMarkdown: "first" },
      { sectionType: "b", reportMarkdown: null },
    ]),
    "first");

  // --- against the database, still posting nothing -----------------------
  const approved = await db.gradingDraft.findFirst({
    where: { status: "APPROVED" },
    select: { id: true, approvedAt: true },
  });

  if (approved) {
    let message = "";
    try {
      await approveDraft({ draftId: approved.id, approvedByProfileId: "00000000-0000-0000-0000-000000000000" });
    } catch (err) {
      message = err instanceof ApprovalError ? "ApprovalError" : String(err);
    }
    check("approving an already-approved draft is refused", message, "ApprovalError");
  } else {
    console.log("skip approving an already-approved draft — none on record");
  }

  // THE case: text and score disagreeing must not reach a student. Exercised by
  // writing an edit, attempting approval, and rolling the edit back.
  const candidate = await db.gradingDraftSection.findFirst({
    where: { gradingDraft: { approvedAt: null }, reportMarkdown: { not: null } },
    select: { id: true, gradingDraftId: true, scoreEarned: true, scorePossible: true },
  });

  if (!candidate) {
    console.log("skip the text-versus-score case — no unapproved draft to edit");
  } else {
    await db.gradingDraftSection.update({
      where: { id: candidate.id },
      data: {
        editedReportMarkdown: `## Score: 1/${candidate.scorePossible} = 4%\n\nRevised.`,
        editedScoreEarned: candidate.scoreEarned,
      },
    });

    let disagreement = "";
    try {
      await approveDraft({
        draftId: candidate.gradingDraftId,
        approvedByProfileId: "00000000-0000-0000-0000-000000000000",
      });
    } catch (err) {
      disagreement = err instanceof ApprovalError && /report says 1\//.test(err.message)
        ? "refused"
        : `unexpected: ${err instanceof Error ? err.message : String(err)}`;
    }
    check("a report whose text contradicts the recorded score cannot be approved",
      disagreement, "refused");

    await db.gradingDraftSection.update({
      where: { id: candidate.id },
      data: { editedReportMarkdown: null, editedScoreEarned: null, editedAt: null, editedById: null },
    });

    const restored = await db.gradingDraftSection.findUnique({
      where: { id: candidate.id },
      select: { editedReportMarkdown: true, editedScoreEarned: true },
    });
    check("discarding an edit restores the model's version",
      restored, { editedReportMarkdown: null, editedScoreEarned: null });
  }

  await db.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error("\n", err); process.exit(1); });
