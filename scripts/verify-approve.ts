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
import type { Db } from "../lib/prisma";

import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();

async function main() {
  const { db } = await import("../lib/prisma");
  const {
    approveDraft,
    ApprovalError,
    buildFeedbackMarkdown,
    deliveryOutcome,
    effectiveSection,
    statedScoreInText,
    undeliveredApprovalWhere,
  } = await import("../lib/grade/approve");

  // --- what became of the comment ----------------------------------------
  //
  // Three outcomes, because `postedPrCommentId` being null means two opposite things: a
  // comment that failed to send, and one there was never anywhere to send. Collapsing them
  // put a fault on every finished hand-graded submission — a retry that could not succeed,
  // and a triage entry nothing could clear.
  const withPr = { prNumber: 7, repoFullName: "org/repo-student" };
  const noPr = { prNumber: null, repoFullName: null };

  check(
    "a comment on a pull request is posted",
    deliveryOutcome({ postedPrCommentId: BigInt(123) }, withPr),
    "posted",
  );
  check(
    "no comment where there is a pull request is a failure",
    deliveryOutcome({ postedPrCommentId: null }, withPr),
    "failed",
  );
  check(
    "no comment where there is no pull request is not applicable",
    deliveryOutcome({ postedPrCommentId: null }, noPr),
    "not_applicable",
  );
  // A repository assignment can be graded before the student opens a pull request, so both
  // columns are read rather than only one.
  check(
    "half a pull request is still nowhere to post",
    deliveryOutcome({ postedPrCommentId: null }, { prNumber: null, repoFullName: "org/repo" }),
    "not_applicable",
  );

  /*
    The query that finds undelivered approvals has to carry the same deliverability test the
    function above applies to a loaded row. Asserted as a shape because the failure is a
    silent omission: without the submission condition every hand-graded submission matches,
    and `triageBucket` reads `comment_not_posted` ahead of every other bucket.
  */
  check(
    "the undelivered query requires somewhere to have posted to",
    undeliveredApprovalWhere({ assignment: { courseId: "c" } }),
    {
      status: "APPROVED",
      postedPrCommentId: null,
      submission: {
        assignment: { courseId: "c" },
        prNumber: { not: null },
        repoFullName: { not: null },
      },
    },
  );

  // --- pure helpers ------------------------------------------------------
  check(
    "an unedited section keeps the model's values",
    effectiveSection({
      sectionType: "short_response",
      reportMarkdown: "model text",
      scoreEarned: 9,
      scorePossible: 15,
      editedReportMarkdown: null,
      editedScoreEarned: null,
    }),
    {
      sectionType: "short_response",
      reportMarkdown: "model text",
      scoreEarned: 9,
      scorePossible: 15,
    },
  );

  check(
    "an edit wins over the model's values",
    effectiveSection({
      sectionType: "short_response",
      reportMarkdown: "model text",
      scoreEarned: 9,
      scorePossible: 15,
      editedReportMarkdown: "instructor text",
      editedScoreEarned: 11,
    }),
    {
      sectionType: "short_response",
      reportMarkdown: "instructor text",
      scoreEarned: 11,
      scorePossible: 15,
    },
  );

  // A score of 0 is a real edit, not an absent one. `??` rather than `||` is what makes
  // the difference, and getting it wrong would silently restore the model's score every
  // time an instructor zeroed a section.
  check(
    "an edited score of zero is honoured",
    effectiveSection({
      sectionType: "x",
      reportMarkdown: "t",
      scoreEarned: 9,
      scorePossible: 15,
      editedReportMarkdown: null,
      editedScoreEarned: 0,
    }).scoreEarned,
    0,
  );

  check(
    "the score line is read out of the report text",
    statedScoreInText("# Report\n\n## Short Response Score: 11/15 = 73%"),
    { earned: 11, possible: 15 },
  );
  check(
    "a report with no score line states none",
    statedScoreInText("# Report\n\nNo score anywhere."),
    null,
  );
  check("half credit in the text parses", statedScoreInText("## Score: 20.5/25 = 82%"), {
    earned: 20.5,
    possible: 25,
  });

  check(
    "sections are joined with a rule between them",
    buildFeedbackMarkdown([
      { sectionType: "a", reportMarkdown: "first" },
      { sectionType: "b", reportMarkdown: "second" },
    ]),
    "first\n\n---\n\nsecond",
  );
  check(
    "a section with no report is skipped rather than leaving an empty block",
    buildFeedbackMarkdown([
      { sectionType: "a", reportMarkdown: "first" },
      { sectionType: "b", reportMarkdown: null },
    ]),
    "first",
  );

  // --- which pile a submission lands in ----------------------------------
  //
  // Kept here rather than in its own script because the first rule below is the one that
  // makes delivery and triage the same subject: an approval with nowhere to post must not
  // read as work, and `comment_not_posted` is checked ahead of every other bucket.
  const { triageBucket } = await import("../lib/grade/triage");
  const { isManualOnly } = await import("../lib/assignments/spec");

  check(
    "submitted work with no report needs one",
    triageBucket("SUBMITTED", null, false, false, false),
    "needs_report",
  );
  check(
    "submitted work on a hand-graded assignment needs a grade, not a report",
    triageBucket("SUBMITTED", null, false, false, true),
    "needs_manual_grade",
  );
  check(
    "a report waiting to be read is ready whichever way it was made",
    triageBucket("SUBMITTED", { status: "READY" }, false, false, false),
    "draft_ready",
  );
  // The bucket that must not appear on hand-graded work. With the deliverability test in
  // place the flag is false, and a graded submission with an approved draft is finished.
  check(
    "a delivered grade is nobody's work",
    triageBucket("GRADED", { status: "APPROVED" }, false, false, false),
    null,
  );
  check(
    "a hand-graded submission is finished once approved",
    triageBucket("GRADED", { status: "APPROVED" }, false, false, true),
    null,
  );
  check(
    "an undelivered comment outranks every other bucket",
    triageBucket("GRADED", { status: "APPROVED" }, false, true, false),
    "comment_not_posted",
  );
  // A draft describing code the student has replaced is not a report on the work in front
  // of the instructor, so it falls through to needing one — as the right kind.
  check(
    "a stale draft falls through to needing a report",
    triageBucket("RESUBMITTED", { status: "READY" }, true, false, false),
    "needs_report",
  );
  check(
    "a stale draft on a hand-graded assignment falls through to needing a grade",
    triageBucket("RESUBMITTED", { status: "READY" }, true, false, true),
    "needs_manual_grade",
  );

  // The flag itself, read off stored `sections` JSON rather than a parsed spec, because
  // that is the only shape the three callers hold.
  check(
    "all-manual sections are manual-only",
    isManualOnly([{ grading: "manual", label: "Reflection", pointValue: 10 }]),
    true,
  );
  check(
    "a mix is not manual-only",
    isManualOnly([{ grading: "ai", type: "short_response" }, { grading: "manual" }]),
    false,
  );
  check("no sections is not manual-only", isManualOnly([]), false);
  check("a malformed column is not manual-only", isManualOnly(null), false);
  // Pre-migration rows had no `grading` at all. Counting them as AI keeps the generate
  // button on assignments that have always had it.
  check(
    "a section with no grading mode counts as AI",
    isManualOnly([{ type: "coding_algorithm" }]),
    false,
  );

  // --- against the database, still posting nothing -----------------------
  const approved = await db.gradingDraft.findFirst({
    where: { status: "APPROVED" },
    select: { id: true, approvedAt: true },
  });

  if (approved) {
    let message = "";
    try {
      await approveDraft({
        draftId: approved.id,
        approvedByProfileId: "00000000-0000-0000-0000-000000000000",
      });
    } catch (err) {
      message = err instanceof ApprovalError ? "ApprovalError" : String(err);
    }
    check("approving an already-approved draft is refused", message, "ApprovalError");
  } else {
    console.log("skip approving an already-approved draft — none on record");
  }

  // THE case: text and score disagreeing must not reach a student. Exercised by
  // writing an edit, attempting approval, and rolling the edit back.
  // The draft must describe the commit the pull request is currently at, or approval
  // refuses for staleness before it ever reaches the check being exercised here.
  // Prisma cannot compare two columns across a relation in a `where`, so the filtering
  // happens in code.
  const candidates = await db.gradingDraftSection.findMany({
    where: { gradingDraft: { approvedAt: null }, reportMarkdown: { not: null } },
    select: {
      id: true,
      gradingDraftId: true,
      scoreEarned: true,
      scorePossible: true,
      gradingDraft: {
        select: { headSha: true, submission: { select: { headSha: true } } },
      },
    },
  });
  const candidate = candidates.find(
    (section) => section.gradingDraft.headSha === section.gradingDraft.submission.headSha,
  );

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
      disagreement =
        err instanceof ApprovalError && /report says 1\//.test(err.message)
          ? "refused"
          : `unexpected: ${err instanceof Error ? err.message : String(err)}`;
    }
    check(
      "a report whose text contradicts the recorded score cannot be approved",
      disagreement,
      "refused",
    );

    await db.gradingDraftSection.update({
      where: { id: candidate.id },
      data: {
        editedReportMarkdown: null,
        editedScoreEarned: null,
        editedAt: null,
        editedById: null,
      },
    });

    const restored = await db.gradingDraftSection.findUnique({
      where: { id: candidate.id },
      select: { editedReportMarkdown: true, editedScoreEarned: true },
    });
    check("discarding an edit restores the model's version", restored, {
      editedReportMarkdown: null,
      editedScoreEarned: null,
    });
  }

  await handGradedLifecycle(db);
  await oneRunAtATime(db);

  await db.$disconnect();

  finish();
}

/**
 * A Google Drive assignment from authoring to a released grade, through the tRPC callers.
 *
 * The strongest check available for hand grading, because every part of it is a seam rather
 * than a function: an instructor authors it, a student accepts and submits it, triage decides
 * it is waiting on a person, an instructor opens an empty draft and writes into it, and
 * approving releases it. None of that can be checked in pieces — the failure this exists to
 * catch is a finished hand-graded submission that still reads as work, which only appears when
 * the whole sequence has run.
 *
 * Inside a transaction that is rolled back, so it runs against live data without leaving any.
 */
async function handGradedLifecycle(db: Db) {
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  const course = await db.course.findFirst({
    where: { archivedAt: null },
    select: { id: true },
  });
  const instructor = course
    ? await db.courseInstructor.findFirst({
        where: { courseId: course.id },
        select: { userId: true },
      })
    : null;
  /*
    Any status. This lifecycle hands work in, which needs an *active* student — so the enrollment is
    restored inside the transaction below rather than required to be active here. Requiring it meant
    removing a student in the running application silently stopped this whole group, while the
    script went on reporting a pass.
  */
  const student = course
    ? await db.enrollment.findFirst({
        where: { courseId: course.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, studentId: true, status: true },
      })
    : null;

  // A module row rather than a tag off the course. An assignment belongs to a module and the
  // foreign key says so, so a course with none cannot hold one — which is a skip, not a failure.
  const firstModule = course
    ? await db.courseUnit.findFirst({
        where: { courseId: course.id },
        orderBy: { position: "asc" },
        select: { id: true },
      })
    : null;
  const courseUnitId = firstModule?.id;

  if (!course || !instructor || !student || !courseUnitId) {
    skip(
      "the hand-graded lifecycle — no seeded course with an instructor, a student, and a module",
    );
    return;
  }

  const createCaller = createCallerFactory(appRouter);

  try {
    await db.$transaction(
      async (tx) => {
        const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
        const asStudent = createCaller({ db: tx, user: { id: student.studentId } } as never);

        // Inside the transaction, so it is undone with everything else. Accepting and submitting
        // need an active student, and the seeded one may have been removed in the application.
        if (student.status !== "ACTIVE") {
          await asInstructor.enrollments.restore({ enrollmentId: student.id });
        }

        // --- authored, published, accepted, submitted ------------------------
        const { assignment } = await asInstructor.assignments.create({
          courseId: course.id,
          draft: {
            kind: "GOOGLE_DRIVE",
            title: "Reflection (verify:approve)",
            courseUnitId,
            dueAt: null,
            templateDriveUrl: "https://docs.google.com/document/d/1AbC_dEF-123/view",
            submissionInstructions: "Take a copy, write your reflection, submit the link.",
            sections: [{ grading: "manual", label: "Reflection", pointValue: 20 }],
          },
        });
        check("a Google Drive assignment can be authored", assignment.pointValue, 20);

        await asInstructor.assignments.publish({ assignmentId: assignment.id });

        // Accepting is being sent to Google's copy prompt, and nothing more. No repository is
        // generated and no GitHub call is made, which is why this runs with no network at all.
        const accepted = await asStudent.assignments.accept({ assignmentId: assignment.id });
        check(
          "accepting a Drive assignment returns the copy prompt",
          accepted.copyUrl,
          "https://docs.google.com/document/d/1AbC_dEF-123/copy",
        );
        check(
          "...and creates no repository",
          [accepted.submission.repoFullName, accepted.submission.status],
          [null, "ACCEPTED"],
        );

        const submitted = await asStudent.submissions.submitWork({
          assignmentId: assignment.id,
          submittedUrl: "https://docs.google.com/document/d/student-copy-1/edit",
        });
        check(
          "submitting is what enters the queue",
          [submitted.status, submitted.isLate, submitted.submittedAt !== null],
          ["SUBMITTED", false, true],
        );

        // --- triage says a person has to grade it ----------------------------
        const queued = await asInstructor.submissions.listForAssignment({
          assignmentId: assignment.id,
        });
        const row = queued.submissions.find((entry) => entry.id === submitted.id);
        check(
          "the queue knows this assignment is graded by hand",
          queued.assignment.manualOnly,
          true,
        );
        check(
          "submitted hand-graded work needs a grade, not a report",
          row?.bucket,
          "needs_manual_grade",
        );

        // --- an empty draft, refused until it is filled in -------------------
        const drafts = await asInstructor.gradingDrafts.listForSubmission({
          submissionId: submitted.id,
        });
        check(
          "no report can be generated for it",
          [drafts.canGenerate, drafts.canGradeByHand, drafts.manualOnly],
          [false, true, true],
        );

        const opened = await asInstructor.gradingDrafts.startManual({ submissionId: submitted.id });
        // Pressing the button twice must not leave two blank drafts, one of which the
        // instructor's writing is not in.
        const again = await asInstructor.gradingDrafts.startManual({ submissionId: submitted.id });
        check("starting twice opens the same draft", again.id, opened.id);

        const blank = await asInstructor.gradingDrafts.get({ draftId: opened.id });
        check(
          "the draft has one blank section per declared section",
          blank.sections.map((s) => [
            s.sectionType,
            s.scoreEarned,
            s.scorePossible,
            s.reportMarkdown,
          ]),
          [["Reflection", null, 20, null]],
        );
        check("and no model wrote it", blank.modelMetadata, null);

        // Releasing a blank section would record a real zero for work nobody assessed and show
        // the student an empty report. The two are indistinguishable once written.
        let blankApproval = "";
        try {
          await asInstructor.gradingDrafts.approve({ draftId: opened.id });
        } catch (err) {
          blankApproval =
            err instanceof Error && /has no score/.test(err.message)
              ? "refused"
              : `unexpected: ${err instanceof Error ? err.message : String(err)}`;
        }
        check("approving a blank draft is refused", blankApproval, "refused");

        // --- written, released -----------------------------------------------
        await asInstructor.gradingDrafts.updateSection({
          sectionId: blank.sections[0].id,
          reportMarkdown: "## Reflection Score: 17/20 = 85%\n\nClear and specific throughout.",
          scoreEarned: 17,
        });

        const released = await asInstructor.gradingDrafts.approve({ draftId: opened.id });
        check(
          "releasing records the grade",
          [released.finalScore, released.finalScorePossible, released.isComplete],
          [17, 20, true],
        );
        /*
        The point of the whole exercise. There is no pull request, so there was never a comment
        to post: `not_applicable` rather than a failed delivery, with no error message attached.
      */
        check(
          "delivery is not applicable rather than failed",
          [released.delivery, released.commentError],
          ["not_applicable", null],
        );

        const afterRelease = await asInstructor.gradingDrafts.listForSubmission({
          submissionId: submitted.id,
        });
        check(
          "the review screen reports it the same way",
          afterRelease.grade?.delivery,
          "not_applicable",
        );

        /*
        And it is finished everywhere. This is the bug the deliverability test in
        `undeliveredApprovalWhere` exists to prevent: without it every hand-graded submission
        sits in `comment_not_posted` forever, in triage, the queue, and the gradebook alike,
        and nothing an instructor can do clears it.
      */
        const afterQueue = await asInstructor.submissions.listForAssignment({
          assignmentId: assignment.id,
        });
        check(
          "a released hand-graded submission is in no bucket",
          afterQueue.submissions.find((entry) => entry.id === submitted.id)?.bucket,
          null,
        );

        const triage = await asInstructor.submissions.triage({ courseId: course.id });
        check(
          "...and is not outstanding on the triage screen",
          triage.submissions.some((entry) => entry.id === submitted.id),
          false,
        );

        const gradebook = await asInstructor.courses.gradebook({ courseId: course.id });
        check(
          "...nor in the gradebook",
          gradebook.cells.find((cell) => cell.id === submitted.id)?.bucket,
          null,
        );

        // The student reads the feedback from their own screen, with no comment involved.
        const asStudentAfter = createCaller({ db: tx, user: { id: student.studentId } } as never);
        const forStudent = await asStudentAfter.assignments.listForCourse({ courseId: course.id });
        const mine = forStudent.find((entry) => entry.id === assignment.id);
        check(
          "the student sees the released grade",
          [mine?.submissions[0]?.finalScore, mine?.submissions[0]?.isComplete],
          [17, true],
        );

        // --- correcting a grade that has already gone out --------------------
        //
        // The instructor's own mistake, with no new work from the student. Previously there was
        // no way to act on it at all: editing an approved draft is refused, and the only other
        // round was the one a resubmission started — so a wrong grade waited on the student.
        const correction = await asInstructor.gradingDrafts.reviseReleased({
          submissionId: submitted.id,
        });
        check(
          "a correction is a new round, not the released one",
          correction.id !== opened.id,
          true,
        );

        const sameCorrection = await asInstructor.gradingDrafts.reviseReleased({
          submissionId: submitted.id,
        });
        check("opening one twice opens the same round", sameCorrection.id, correction.id);

        const prefilled = await asInstructor.gradingDrafts.get({ draftId: correction.id });
        check(
          "it opens holding the score that was sent, so one number is one edit",
          prefilled.sections.map((s) => [s.sectionType, s.scoreEarned, s.scorePossible]),
          [["Reflection", 17, 20]],
        );
        check(
          "...and the text, rather than making the instructor retype the report",
          prefilled.sections[0].reportMarkdown?.includes("Clear and specific throughout."),
          true,
        );
        // The copied round is a person's work, whatever wrote the one before it.
        check("...and no model is credited with it", prefilled.modelMetadata, null);

        const correcting = await asInstructor.submissions.listForAssignment({
          assignmentId: assignment.id,
        });
        check(
          "an open correction is work waiting on the instructor",
          correcting.submissions.find((entry) => entry.id === submitted.id)?.bucket,
          "draft_ready",
        );

        /*
          Changing the score alone leaves the copied report still stating the old one, and that
          is the one edit that must not go out — so the guard that catches it has to catch it
          here too, on text this procedure wrote rather than a model.
        */
        await asInstructor.gradingDrafts.updateSection({
          sectionId: prefilled.sections[0].id,
          reportMarkdown: null,
          scoreEarned: 19,
        });
        let halfCorrected = "";
        try {
          await asInstructor.gradingDrafts.approve({ draftId: correction.id });
        } catch (err) {
          halfCorrected =
            err instanceof Error &&
            /says 17\/20 but the score being recorded is 19/.test(err.message)
              ? "refused"
              : `unexpected: ${err instanceof Error ? err.message : String(err)}`;
        }
        check("correcting the score and not the report is refused", halfCorrected, "refused");

        await asInstructor.gradingDrafts.updateSection({
          sectionId: prefilled.sections[0].id,
          reportMarkdown: "## Reflection Score: 19/20 = 95%\n\nBetter than I first credited.",
          scoreEarned: 19,
        });
        const corrected = await asInstructor.gradingDrafts.approve({ draftId: correction.id });
        check("releasing the correction records the new score", corrected.finalScore, 19);

        const bothRounds = await asInstructor.gradingDrafts.listForSubmission({
          submissionId: submitted.id,
        });
        check(
          "both rounds are on record rather than one being rewritten",
          bothRounds.drafts.map((entry) => entry.status),
          ["APPROVED", "APPROVED"],
        );
        check(
          "and the grade on the submission is the corrected one",
          bothRounds.grade?.finalScore,
          19,
        );

        // --- a round opened and then not wanted -------------------------------
        //
        // The way back out. Without it, opening a correction on a grade that turns out to be
        // right leaves a finished submission reading as work forever, and the only exit is
        // approving something — which sends the student a second comment for no reason.
        const spare = await asInstructor.gradingDrafts.reviseReleased({
          submissionId: submitted.id,
        });
        const setAside = await asInstructor.gradingDrafts.discard({ draftId: spare.id });
        check("a round can be put aside without releasing it", setAside.status, "SUPERSEDED");
        check(
          "putting it aside twice is not an error",
          (await asInstructor.gradingDrafts.discard({ draftId: spare.id })).status,
          "SUPERSEDED",
        );

        const afterAside = await asInstructor.submissions.listForAssignment({
          assignmentId: assignment.id,
        });
        check(
          "a submission whose open round was put aside is finished again",
          afterAside.submissions.find((entry) => entry.id === submitted.id)?.bucket,
          null,
        );

        let releaseAside = "";
        try {
          await asInstructor.gradingDrafts.approve({ draftId: spare.id });
        } catch (err) {
          releaseAside =
            err instanceof Error && /set aside/.test(err.message)
              ? "refused"
              : `unexpected: ${err instanceof Error ? err.message : String(err)}`;
        }
        check("a round that was put aside cannot be released", releaseAside, "refused");

        // A round the student has read is not something this can unsay.
        check(
          "a released round cannot be put aside",
          await refusal(() => asInstructor.gradingDrafts.discard({ draftId: correction.id })),
          "BAD_REQUEST",
        );

        throw new Error("ROLLBACK");
      },
      /*
        Sixty seconds rather than thirty. This lifecycle is now three rounds of grading driven
        through the real procedures, and the gradebook read near the end of it was occasionally
        crossing the old cap on its own — a timeout that reports as a failure of whatever
        statement happened to be in flight.
      */
      { timeout: 60_000 },
    );
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  const leftovers = await db.assignment.count({
    where: { title: "Reflection (verify:approve)" },
  });
  check("the rollback left nothing behind", leftovers, 0);
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});

/**
 * Two attempts to grade one submission produce one run, not two.
 *
 * **The only check here that is about what two callers do at once**, which is why it drives
 * `claimRun` directly rather than the procedure above it. Going through `gradingDrafts.generate`
 * would mean actually generating a report — a sandbox, a model call, and a couple of minutes —
 * to observe a decision made in a single statement before any of that. So the statement is
 * exercised on its own, against real rows, inside a transaction that is rolled back.
 *
 * What it is guarding is money. Before this existed, `generateReportForSubmission` created its
 * draft unconditionally, so two instructors on one queue — or one instructor pressing a batch
 * button twice — graded every submission twice over, and only the later report was ever read.
 */
async function oneRunAtATime(db: Db) {
  const { claimRun, CLAIM_EXPIRY_MS } = await import("../lib/grade/generate-report");
  const { ReportGenerationError } = await import("../lib/grade/generate-report");

  const submission = await db.submission.findFirst({
    // A commit, because the interesting comparison is against `head_sha`. The null case is
    // checked below on the same row, since it is the one a plain `=` gets wrong.
    where: { headSha: { not: null } },
    select: { id: true, headSha: true },
  });

  if (!submission?.headSha) {
    skip("no submission with a commit to claim against");
    return;
  }

  await inOwnTransaction(db, async (tx) => {
    const first = await claimRun(tx, submission.id, submission.headSha);
    check("a run can be claimed", first.status, "GENERATING");

    let second = "";
    try {
      await claimRun(tx, submission.id, submission.headSha);
      second = "claimed twice";
    } catch (err) {
      second = err instanceof ReportGenerationError ? "refused" : `unexpected: ${String(err)}`;
    }
    check("...and not claimed again while it is in flight", second, "refused");

    // A different commit is different work. Blocking it would refuse to grade a resubmission
    // while the previous commit's run was still going.
    const other = await claimRun(tx, submission.id, "0000000000000000000000000000000000000000");
    check("...while another commit is a separate run", other.status, "GENERATING");

    /*
      The null-commit case, which is hand-graded work with nothing to compare against. `=` would
      make every one of these claimable forever, because NULL = NULL is not true — so a Google
      Doc submission would be gradable twice at once and this is the check that says otherwise.
    */
    await claimRun(tx, submission.id, null);
    let nullSecond = "";
    try {
      await claimRun(tx, submission.id, null);
      nullSecond = "claimed twice";
    } catch (err) {
      nullSecond = err instanceof ReportGenerationError ? "refused" : `unexpected: ${String(err)}`;
    }
    check("a run with no commit is claimed once too", nullSecond, "refused");

    /*
      An abandoned claim is takeable, or a crashed run would block its submission forever — and
      nothing in the interface clears a stuck GENERATING row.
    */
    await tx.gradingDraft.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - CLAIM_EXPIRY_MS - 60_000) },
    });
    const afterExpiry = await claimRun(tx, submission.id, submission.headSha);
    check("an abandoned claim can be taken", afterExpiry.status, "GENERATING");
  });
}
