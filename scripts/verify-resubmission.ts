/**
 * Phase 5 verification items 4 to 6: what happens after a grade is issued.
 *
 *   npm run verify:resubmission -- <repo-substring>          # read-only
 *   npm run verify:resubmission -- <repo-substring> --post   # includes re-approval
 *
 * Item 4 (a push after grading leaves the status alone) is produced by pushing a real
 * commit and letting the webhook record it, so it is checked here rather than
 * performed. Items 5 and 6 are driven through the tRPC procedures as the student and
 * the instructor respectively, so authorization is exercised along with the behaviour.
 *
 * `--post` is required for the re-approval step because it puts a second comment on a
 * real pull request.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}${detail && `\n  ${detail}`}`);
  } else console.log(`ok   ${label}${detail && `  (${detail})`}`);
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  const target = process.argv[2];
  const post = process.argv.includes("--post");
  if (!target) {
    console.error("Usage: npm run verify:resubmission -- <repo-substring> [--post]");
    process.exit(1);
  }

  const submission = await db.submission.findFirst({
    where: { repoFullName: { contains: target } },
    select: {
      id: true, repoFullName: true, status: true, headSha: true, gradedHeadSha: true,
      studentId: true,
      assignment: { select: { courseId: true } },
    },
  });
  if (!submission) {
    console.error(`No submission matching "${target}".`);
    process.exit(1);
  }

  const instructor = await db.courseInstructor.findFirst({
    where: { courseId: submission.assignment.courseId },
    select: { userId: true },
  });
  if (!instructor) {
    console.error("No instructor on this course.");
    process.exit(1);
  }

  const createCaller = createCallerFactory(appRouter);
  // A caller per role, each carrying the identity the procedures authorize against.
  const asStudent = createCaller({ db, user: { id: submission.studentId } } as never);
  const asInstructor = createCaller({ db, user: { id: instructor.userId } } as never);

  console.log(`Submission  ${submission.repoFullName}\n`);

  // --- item 4: a push after grading -------------------------------------
  check("the status stayed GRADED through a push",
    submission.status === "GRADED" || submission.status === "RESUBMITTED",
    submission.status);
  check("the new commit was recorded",
    submission.headSha !== null && submission.headSha !== submission.gradedHeadSha,
    `head ${submission.headSha?.slice(0, 7)}, graded ${submission.gradedHeadSha?.slice(0, 7)}`);

  // --- item 5: the student declares readiness ---------------------------
  if (submission.status === "GRADED") {
    const declared = await asStudent.submissions.declareResubmission({
      submissionId: submission.id,
    });
    check("the student's declaration sets RESUBMITTED", declared.status === "RESUBMITTED",
      declared.status);
  } else {
    console.log(`skip the declaration — already ${submission.status}`);
  }

  // Another student must not be able to declare on someone else's submission.
  const stranger = await db.profile.findFirst({
    where: { id: { not: submission.studentId }, role: "STUDENT" },
    select: { id: true },
  });
  if (stranger) {
    const asStranger = createCaller({ db, user: { id: stranger.id } } as never);
    let code = "";
    try {
      await asStranger.submissions.declareResubmission({ submissionId: submission.id });
    } catch (err) {
      code = (err as { code?: string }).code ?? String(err);
    }
    check("another student cannot declare on this submission", code === "FORBIDDEN", code);
  } else {
    console.log("skip the cross-student check — only one student on record");
  }

  // The instructor's queue has to tell a revision from a first submission, and show
  // that there is newer code than the grade describes.
  const listed = await asInstructor.submissions.listForAssignment({
    assignmentId: (await db.submission.findUniqueOrThrow({
      where: { id: submission.id }, select: { assignmentId: true },
    })).assignmentId,
  });
  const row = listed.submissions.find((s) => s.id === submission.id);
  check("the queue shows it as a resubmission", row?.status === "RESUBMITTED", row?.status);
  check("the queue can see it is revised since grading",
    row?.gradedHeadSha !== null && row?.headSha !== row?.gradedHeadSha);

  // --- item 6: re-approval adds a second comment ------------------------
  const before = await db.gradingDraft.count({
    where: { submissionId: submission.id, status: "APPROVED" },
  });

  if (!post) {
    console.log(`\n${before} approved round(s) so far. Re-run with --post to generate a ` +
      `report for the new commit, approve it, and confirm a SECOND comment appears ` +
      `rather than the first being edited.`);
  } else {
    const draft = await asInstructor.gradingDrafts.generate({ submissionId: submission.id });
    check("a report was generated for the new commit",
      draft.status === "READY" || draft.status === "NEEDS_MANUAL_REVIEW", draft.status);

    const approved = await asInstructor.gradingDrafts.approve({ draftId: draft.id });
    check("the second approval posted its own comment",
      approved.postedPrCommentId !== null,
      approved.commentError ?? String(approved.postedPrCommentId));

    const rounds = await db.gradingDraft.findMany({
      where: { submissionId: submission.id, status: "APPROVED" },
      orderBy: { approvedAt: "asc" },
      select: { headSha: true, postedPrCommentId: true },
    });
    check("both rounds are on record", rounds.length === before + 1,
      rounds.map((r) => `${r.headSha?.slice(0, 7) ?? "no commit"}→${r.postedPrCommentId}`).join(", "));
    check("each round posted a distinct comment",
      new Set(rounds.map((r) => String(r.postedPrCommentId))).size === rounds.length);

    const after = await db.submission.findUniqueOrThrow({
      where: { id: submission.id },
      select: { status: true, headSha: true, gradedHeadSha: true },
    });
    check("approving cleared the revised-since-grading state",
      after.status === "GRADED" && after.headSha === after.gradedHeadSha,
      `${after.status}, head ${after.headSha?.slice(0, 7)}`);
  }

  await db.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error("\n", err); process.exit(1); });
