/**
 * Approves the most recent grading draft for a submission, from the terminal.
 *
 *   npm run approve -- <repo-substring>          # show what would happen
 *   npm run approve -- <repo-substring> --post   # actually do it
 *
 * **This posts a comment to a real pull request**, which a student reads. That is why
 * `--post` is required and why the default prints the plan and stops: every other
 * script in this repository is safe to run twice while poking at something, and this
 * one is not.
 *
 * Calls the same function the tRPC mutation calls. Needs --conditions=react-server, as
 * the modules it reaches import "server-only".
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

async function main() {
  const { db } = await import("../lib/prisma");
  const { approveDraft, buildFeedbackMarkdown } = await import("../lib/grade/approve");

  const target = process.argv[2];
  const post = process.argv.includes("--post");

  if (!target) {
    console.error("Usage: npm run approve -- <repo-substring> [--post]");
    process.exit(1);
  }

  const submission = await db.submission.findFirst({
    where: { repoFullName: { contains: target } },
    orderBy: { lastActivityAt: "desc" },
    select: {
      id: true,
      repoFullName: true,
      prNumber: true,
      headSha: true,
      status: true,
      assignment: { select: { title: true, completionThreshold: true } },
    },
  });

  if (!submission) {
    console.error(`No submission matching "${target}".`);
    process.exit(1);
  }

  const draft = await db.gradingDraft.findFirst({
    where: { submissionId: submission.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      headSha: true,
      status: true,
      sections: {
        select: {
          sectionType: true,
          reportMarkdown: true,
          scoreEarned: true,
          scorePossible: true,
        },
      },
    },
  });

  if (!draft) {
    console.error(`No grading draft for ${submission.repoFullName}. Run npm run grade first.`);
    process.exit(1);
  }

  const earned = draft.sections.reduce((total, s) => total + (s.scoreEarned ?? 0), 0);
  const possible = draft.sections.reduce((total, s) => total + (s.scorePossible ?? 0), 0);
  const threshold = submission.assignment.completionThreshold;

  console.log(`Submission  ${submission.repoFullName} — ${submission.status}`);
  console.log(`Pull req    #${submission.prNumber} @ ${submission.headSha?.slice(0, 7)}`);
  // "no commit" rather than a blank: a hand-graded draft has none, and this line is read to
  // confirm the draft describes the code that is there.
  console.log(`Draft       ${draft.status} @ ${draft.headSha?.slice(0, 7) ?? "no commit"}`);
  console.log(`Sections    ${draft.sections.map((s) => s.sectionType).join(", ")}`);
  console.log(
    `Score       ${earned}/${possible}` +
      (possible > 0
        ? ` = ${Math.round((earned / possible) * 100)}%  →  ` +
          `${earned / possible >= threshold ? "complete" : "below threshold"} ` +
          `(threshold ${Math.round(threshold * 100)}%)`
        : ""),
  );

  const body = buildFeedbackMarkdown(draft.sections);
  console.log(`Comment     ${body.length} characters, ${body.split("\n").length} lines`);

  if (!post) {
    console.log(
      `\nNothing was written. Re-run with --post to record the grade and put ` +
        `this comment on the pull request, where the student will read it.`,
    );
    await db.$disconnect();
    return;
  }

  const instructor = await db.profile.findFirst({
    where: { role: { in: ["INSTRUCTOR", "ADMIN"] } },
    select: { id: true, email: true },
  });
  if (!instructor) {
    console.error("No instructor profile to record as the grader.");
    process.exit(1);
  }

  console.log(`\nApproving as ${instructor.email}…`);
  const result = await approveDraft({ draftId: draft.id, approvedByProfileId: instructor.id });

  console.log(
    `\nGrade recorded: ${result.finalScore}/${result.finalScorePossible}` +
      `  complete=${result.isComplete}`,
  );
  console.log(
    result.commentError
      ? `Comment NOT posted: ${result.commentError}\n` +
          `  The grade is recorded and the student can see it on their assignment page.\n` +
          `  Use the "Post the comment now" button, or gradingDrafts.retryComment.`
      : `Comment posted: id ${result.postedPrCommentId}`,
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
