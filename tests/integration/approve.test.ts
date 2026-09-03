/**
 * Releasing a grade: the moment a draft stops being a suggestion and becomes the student's grade.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * The case worth reading is the one about a report whose text contradicts its score. An instructor
 * can revise the prose and the number independently, and the one edit that must never go out is a
 * report saying one figure while the gradebook records another — the student reads the prose and
 * every other part of the system reads the column.
 *
 * The longest group is the hand-graded lifecycle, and it is long on purpose. Every part of it is a
 * seam rather than a function: an instructor authors a Google Drive assignment, a fellow accepts and
 * hands it in, triage decides it is waiting on a person, an instructor opens an empty draft and
 * writes into it, releasing it records the grade, and a correction opens a second round beside the
 * first. None of that can be established in pieces — the failure it exists to catch is a finished
 * hand-graded submission that still reads as outstanding work, which only appears once the whole
 * sequence has run.
 *
 * **Nothing here reaches GitHub, a sandbox, or a model.** That is a property of the subject rather
 * than a compromise: a Google Drive assignment generates no repository, so there is nowhere to post
 * a comment and nothing to run tests against, and `claimRun` is exercised as the single statement it
 * is rather than by generating a report around it.
 *
 * Carries the 42 assertions of `verify:approve` that need a database. Its other 28 were pure
 * functions and are already covered by `tests/lib/grade/delivery.test.ts`,
 * `tests/lib/grade/triage.test.ts`, and `tests/lib/assignments/sections.test.ts`, which need nothing
 * and run on every save.
 *
 * **The script ran 62 of its 70.** Three of its checks looked for an already-released draft and an
 * unapproved draft describing the commit its pull request is at, and quietly did nothing when the
 * database held neither; five more stood down for want of a submission with a commit on it. All
 * eight are built here, so all eight always run.
 *
 * Two checks are stronger than the script's. "Not outstanding on the triage screen" and "nor in the
 * gradebook" both passed against an empty answer, which is also what a broken query returns — so a
 * second fellow hands the same assignment in and is never graded, and the released submission has to
 * be absent from a pile that demonstrably still holds somebody.
 */
import { db } from "@/lib/prisma";
import { approveDraft, ApprovalError } from "@/lib/grade/approve";
import { claimRun, CLAIM_EXPIRY_MS, ReportGenerationError } from "@/lib/grade/generate-report";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  makeAssignment,
  makeCourse,
  makeProgram,
  makeSubmission,
  makeUnit,
  makeWorld,
  type World,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);

/** The procedures as one person would reach them, bound to this group's transaction. */
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/**
 * What a call refused with, as a string to compare against.
 *
 * The literal `"accepted"` is what comes back when the call did *not* refuse, which is what makes a
 * missing guard a visible failure rather than a passing test.
 */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/** A commit, long enough to be sliced for a message the way a real one is. */
const HEAD_SHA = "1111111111111111111111111111111111111111";

describe("a draft that has already been released", () => {
  const tx = withRollback();
  let world: World;
  let draftId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      pointValue: 20,
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: assignment.id,
      studentId: world.student.studentId,
      graded: { score: 17, possible: 20, isComplete: true },
    });
    const draft = await tx().gradingDraft.create({
      data: {
        submissionId: submission.id,
        status: "APPROVED",
        approvedAt: new Date("2026-02-01T12:00:00Z"),
        approvedById: world.instructorId,
        sections: {
          create: [
            { sectionType: "Overall", reportMarkdown: "Good.", scoreEarned: 17, scorePossible: 20 },
          ],
        },
      },
      select: { id: true },
    });
    draftId = draft.id;
  });

  /*
    Approving twice would post the same feedback to the pull request a second time. Comments
    accumulate by design, so a duplicate is not overwritten by the next approval — it sits in the
    history looking like a second round of review that never happened.
  */
  it("approving an already-approved draft is refused", async () => {
    await expect(
      approveDraft({
        draftId,
        approvedByProfileId: world.instructorId,
        client: tx(),
      }),
    ).rejects.toBeInstanceOf(ApprovalError);
  });
});

/**
 * The case the whole two-column design exists for.
 *
 * An instructor can revise the report text and the score independently, and a report that states
 * one figure while the recorded score is another hands the student and the gradebook different
 * answers. Refused rather than silently reconciled, because only the instructor knows which of the
 * two they meant.
 *
 * The draft has to describe the commit the pull request is currently at, or approval refuses for
 * staleness before it ever reaches the comparison being exercised here.
 */
describe("a report whose text contradicts the recorded score", () => {
  const tx = withRollback();
  let world: World;
  let draftId: string;
  let sectionId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      pointValue: 20,
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: assignment.id,
      studentId: world.student.studentId,
      status: "SUBMITTED",
    });
    await tx().submission.update({ where: { id: submission.id }, data: { headSha: HEAD_SHA } });

    const draft = await tx().gradingDraft.create({
      data: {
        submissionId: submission.id,
        headSha: HEAD_SHA,
        status: "READY",
        sections: {
          create: [
            {
              sectionType: "short_response",
              reportMarkdown: "## Short Response Score: 17/20 = 85%\n\nClear throughout.",
              scoreEarned: 17,
              scorePossible: 20,
            },
          ],
        },
      },
      select: { id: true, sections: { select: { id: true } } },
    });
    draftId = draft.id;
    sectionId = draft.sections[0]!.id;
  });

  it("cannot be approved", async () => {
    // The score stays at 17 while the revised prose claims 1, which is the edit an instructor makes
    // by rewriting a paragraph and forgetting the number beside it.
    await createCaller(tx(), world.instructorId).gradingDrafts.updateSection({
      sectionId,
      reportMarkdown: "## Short Response Score: 1/20 = 5%\n\nRevised.",
      scoreEarned: 17,
    });

    await expect(
      approveDraft({ draftId, approvedByProfileId: world.instructorId, client: tx() }),
    ).rejects.toThrow(/report says 1\//);
  });

  /*
    Passing null for both fields is how the interface offers a way back to what the model wrote. The
    two `edited*` columns are cleared, and so are the two that record who revised it — a section
    restored to the model's version must not go on claiming it was revised.
  */
  it("and discarding the edit restores the model's version", async () => {
    await createCaller(tx(), world.instructorId).gradingDrafts.updateSection({
      sectionId,
      reportMarkdown: null,
      scoreEarned: null,
    });

    const restored = await tx().gradingDraftSection.findUnique({
      where: { id: sectionId },
      select: {
        editedReportMarkdown: true,
        editedScoreEarned: true,
        editedAt: true,
        editedById: true,
      },
    });

    expect(restored).toEqual({
      editedReportMarkdown: null,
      editedScoreEarned: null,
      editedAt: null,
      editedById: null,
    });
  });
});

/**
 * A Google Drive assignment from authoring to a released grade, and then to a correction.
 *
 * Three hundred seconds rather than the default, because this is three rounds of grading driven
 * through the real procedures and the gradebook read in the middle of it is a broad query.
 */
describe("a hand-graded assignment, from authoring to a released grade", () => {
  const tx = withRollback(300_000);

  let world: World;
  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asStudent = () => createCaller(tx(), world.students[0]!.studentId);

  let assignmentId: string;
  let assignmentPointValue: number;
  /** The fellow whose work this group follows all the way to a corrected grade. */
  let submissionId: string;
  /**
   * A second fellow who hands the same assignment in and is never graded.
   *
   * Their row is what makes "this submission is not in the pile" mean something: an empty pile
   * satisfies that claim for the opposite reason, and a query that returned nothing at all would
   * pass every one of the checks below without the comparison it is supposed to make.
   */
  let ungradedSubmissionId: string;

  let openedDraftId: string;
  let blankSectionId: string;
  let correctionDraftId: string;
  let correctionSectionId: string;
  let spareDraftId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
  });

  describe("authored, published, accepted, handed in", () => {
    let accepted: Awaited<ReturnType<ReturnType<typeof asStudent>["assignments"]["accept"]>>;
    let submitted: Awaited<ReturnType<ReturnType<typeof asStudent>["submissions"]["submitWork"]>>;

    beforeAll(async () => {
      const created = await asInstructor().assignments.create({
        courseId: world.courseId,
        draft: {
          kind: "GOOGLE_DRIVE",
          title: "Reflection (integration)",
          courseUnitId: world.unitId,
          dueAt: null,
          templateDriveUrl: "https://docs.google.com/document/d/1AbC_dEF-123/view",
          submissionInstructions: "Take a copy, write your reflection, submit the link.",
          sections: [{ grading: "manual", label: "Reflection", pointValue: 20 }],
        },
      });
      assignmentId = created.assignment.id;
      assignmentPointValue = created.assignment.pointValue;

      await asInstructor().assignments.publish({ assignmentId });

      accepted = await asStudent().assignments.accept({ assignmentId });
      submitted = await asStudent().submissions.submitWork({
        assignmentId,
        submittedUrl: "https://docs.google.com/document/d/student-copy-1/edit",
      });
      submissionId = submitted.id;

      const other = createCaller(tx(), world.students[1]!.studentId);
      await other.assignments.accept({ assignmentId });
      const otherSubmitted = await other.submissions.submitWork({
        assignmentId,
        submittedUrl: "https://docs.google.com/document/d/student-copy-2/edit",
      });
      ungradedSubmissionId = otherSubmitted.id;
    });

    it("a Google Drive assignment can be authored", () => {
      expect(assignmentPointValue).toBe(20);
    });

    /*
      Accepting is recording that the fellow started, and nothing more. No repository is generated
      and no GitHub call is made, which is why this whole file runs with no network at all.

      Where the fellow is sent is deliberately not asserted here. The copy prompt is built in the
      browser out of the template URL the assignment already carries, so that the control can be a
      real link rather than a script-opened window; `verify:authoring` is what checks that
      substitution, over seven URL shapes rather than this one.
    */
    it("accepting a Drive assignment records it and creates no repository", () => {
      expect([accepted.submission.repoFullName, accepted.submission.status]).toEqual([
        null,
        "ACCEPTED",
      ]);
    });

    it("handing it in is what enters the queue", () => {
      expect([submitted.status, submitted.isLate, submitted.submittedAt !== null]).toEqual([
        "SUBMITTED",
        false,
        true,
      ]);
    });
  });

  describe("triage says a person has to grade it", () => {
    it("the queue knows this assignment is graded by hand", async () => {
      const queued = await asInstructor().submissions.listForAssignment({ assignmentId });
      expect(queued.assignment.manualOnly).toBe(true);
    });

    /*
      The same pile of work as `needs_report`, distinguished because the action differs and only one
      of the two exists: `needs_report` offers a button that must not appear on an assignment
      nothing can generate a report for.
    */
    it("handed-in hand-graded work needs a grade, not a report", async () => {
      const queued = await asInstructor().submissions.listForAssignment({ assignmentId });
      expect(queued.submissions.find((entry) => entry.id === submissionId)?.bucket).toBe(
        "needs_manual_grade",
      );
    });
  });

  describe("an empty draft, refused until it is filled in", () => {
    let againId: string;
    let blank: Awaited<ReturnType<ReturnType<typeof asInstructor>["gradingDrafts"]["get"]>>;

    beforeAll(async () => {
      const opened = await asInstructor().gradingDrafts.startManual({ submissionId });
      openedDraftId = opened.id;
      // Pressing the button twice must not leave two blank drafts, one of which the instructor's
      // writing is not in.
      againId = (await asInstructor().gradingDrafts.startManual({ submissionId })).id;

      blank = await asInstructor().gradingDrafts.get({ draftId: openedDraftId });
      blankSectionId = blank.sections[0]!.id;
    });

    it("no report can be generated for it", async () => {
      const drafts = await asInstructor().gradingDrafts.listForSubmission({ submissionId });
      expect([drafts.canGenerate, drafts.canGradeByHand, drafts.manualOnly]).toEqual([
        false,
        true,
        true,
      ]);
    });

    it("starting twice opens the same draft", () => {
      expect(againId).toBe(openedDraftId);
    });

    it("the draft has one blank section per declared section", () => {
      expect(
        blank.sections.map((section) => [
          section.sectionType,
          section.scoreEarned,
          section.scorePossible,
          section.reportMarkdown,
        ]),
      ).toEqual([["Reflection", null, 20, null]]);
    });

    it("and no model wrote it", () => {
      expect(blank.modelMetadata).toBeNull();
    });

    /*
      Releasing a blank section would record a real zero for work nobody assessed and show the
      student an empty report. The two are indistinguishable once written.
    */
    it("approving a blank draft is refused", async () => {
      await expect(
        asInstructor().gradingDrafts.approve({ draftId: openedDraftId }),
      ).rejects.toThrow(/has no score/);
    });
  });

  describe("written, released", () => {
    let released: Awaited<ReturnType<ReturnType<typeof asInstructor>["gradingDrafts"]["approve"]>>;

    beforeAll(async () => {
      await asInstructor().gradingDrafts.updateSection({
        sectionId: blankSectionId,
        reportMarkdown: "## Reflection Score: 17/20 = 85%\n\nClear and specific throughout.",
        scoreEarned: 17,
      });
      released = await asInstructor().gradingDrafts.approve({ draftId: openedDraftId });
    });

    it("releasing records the grade", () => {
      expect([released.finalScore, released.finalScorePossible, released.isComplete]).toEqual([
        17,
        20,
        true,
      ]);
    });

    /*
      The point of the whole exercise. There is no pull request, so there was never a comment to
      post: `not_applicable` rather than a failed delivery, and no error message attached to a step
      that was never owed.
    */
    it("delivery is not applicable rather than failed", () => {
      expect([released.delivery, released.commentError]).toEqual(["not_applicable", null]);
    });

    it("the review screen reports it the same way", async () => {
      const afterRelease = await asInstructor().gradingDrafts.listForSubmission({ submissionId });
      expect(afterRelease.grade?.delivery).toBe("not_applicable");
    });

    /*
      And it is finished everywhere. This is the bug the deliverability test in
      `undeliveredApprovalWhere` exists to prevent: without it every hand-graded submission sits in
      `comment_not_posted` forever — in triage, in the queue, and in the gradebook alike — and
      nothing an instructor can do clears it.
    */
    it("a released hand-graded submission is in no bucket", async () => {
      const afterQueue = await asInstructor().submissions.listForAssignment({ assignmentId });
      expect(afterQueue.submissions.map((entry) => [entry.id, entry.bucket])).toContainEqual([
        submissionId,
        null,
      ]);
    });

    it("...and is not outstanding on the triage screen", async () => {
      const triage = await asInstructor().submissions.triage({ courseId: world.courseId });
      const ids = triage.submissions.map((entry) => entry.id);
      expect(ids).toContain(ungradedSubmissionId);
      expect(ids).not.toContain(submissionId);
    });

    it("...nor in the gradebook", async () => {
      const gradebook = await asInstructor().courses.gradebook({ courseId: world.courseId });
      expect(gradebook.cells.map((cell) => [cell.id, cell.bucket])).toContainEqual([
        submissionId,
        null,
      ]);
    });

    // The fellow reads the feedback from their own screen, with no comment involved.
    it("the student sees the released grade", async () => {
      const forStudent = await asStudent().assignments.listForCourse({ courseId: world.courseId });
      const mine = forStudent.find((entry) => entry.id === assignmentId);
      expect([mine?.submissions[0]?.finalScore, mine?.submissions[0]?.isComplete]).toEqual([
        17,
        true,
      ]);
    });
  });

  /**
   * Correcting a grade that has already gone out.
   *
   * The instructor's own mistake, with no new work from the fellow. There was previously no way to
   * act on it at all: editing an approved draft is refused, and the only other round was the one a
   * resubmission started — so a wrong grade waited on the student to do something about it, which
   * is the wrong person entirely.
   */
  describe("correcting a grade that has already gone out", () => {
    let sameCorrectionId: string;
    let prefilled: Awaited<ReturnType<ReturnType<typeof asInstructor>["gradingDrafts"]["get"]>>;

    beforeAll(async () => {
      correctionDraftId = (await asInstructor().gradingDrafts.reviseReleased({ submissionId })).id;
      sameCorrectionId = (await asInstructor().gradingDrafts.reviseReleased({ submissionId })).id;

      prefilled = await asInstructor().gradingDrafts.get({ draftId: correctionDraftId });
      correctionSectionId = prefilled.sections[0]!.id;
    });

    it("a correction is a new round, not the released one", () => {
      expect(correctionDraftId).not.toBe(openedDraftId);
    });

    it("opening one twice opens the same round", () => {
      expect(sameCorrectionId).toBe(correctionDraftId);
    });

    it("it opens holding the score that was sent, so one number is one edit", () => {
      expect(
        prefilled.sections.map((section) => [
          section.sectionType,
          section.scoreEarned,
          section.scorePossible,
        ]),
      ).toEqual([["Reflection", 17, 20]]);
    });

    it("...and the text, rather than making the instructor retype the report", () => {
      expect(prefilled.sections[0]!.reportMarkdown).toContain("Clear and specific throughout.");
    });

    // The copied round is a person's work, whatever wrote the one before it.
    it("...and no model is credited with it", () => {
      expect(prefilled.modelMetadata).toBeNull();
    });

    it("an open correction is work waiting on the instructor", async () => {
      const correcting = await asInstructor().submissions.listForAssignment({ assignmentId });
      expect(correcting.submissions.find((entry) => entry.id === submissionId)?.bucket).toBe(
        "draft_ready",
      );
    });

    /*
      Changing the score alone leaves the copied report still stating the old one, and that is the
      one edit that must not go out — so the guard that catches it has to catch it here too, on text
      this procedure wrote rather than a model.
    */
    it("correcting the score and not the report is refused", async () => {
      await asInstructor().gradingDrafts.updateSection({
        sectionId: correctionSectionId,
        reportMarkdown: null,
        scoreEarned: 19,
      });

      await expect(
        asInstructor().gradingDrafts.approve({ draftId: correctionDraftId }),
      ).rejects.toThrow(/says 17\/20 but the score being recorded is 19/);
    });

    it("releasing the correction records the new score", async () => {
      await asInstructor().gradingDrafts.updateSection({
        sectionId: correctionSectionId,
        reportMarkdown: "## Reflection Score: 19/20 = 95%\n\nBetter than I first credited.",
        scoreEarned: 19,
      });

      const corrected = await asInstructor().gradingDrafts.approve({ draftId: correctionDraftId });
      expect(corrected.finalScore).toBe(19);
    });

    it("both rounds are on record rather than one being rewritten", async () => {
      const bothRounds = await asInstructor().gradingDrafts.listForSubmission({ submissionId });
      expect(bothRounds.drafts.map((entry) => entry.status)).toEqual(["APPROVED", "APPROVED"]);
    });

    it("and the grade on the submission is the corrected one", async () => {
      const bothRounds = await asInstructor().gradingDrafts.listForSubmission({ submissionId });
      expect(bothRounds.grade?.finalScore).toBe(19);
    });
  });

  /**
   * A round opened and then not wanted.
   *
   * The way back out. Without it, opening a correction on a grade that turns out to be right leaves
   * a finished submission reading as work forever, and the only exit is approving something — which
   * sends the fellow a second comment for no reason.
   */
  describe("a round opened and then not wanted", () => {
    let discardedStatus: string;
    let discardedAgainStatus: string;

    beforeAll(async () => {
      spareDraftId = (await asInstructor().gradingDrafts.reviseReleased({ submissionId })).id;
      discardedStatus = (await asInstructor().gradingDrafts.discard({ draftId: spareDraftId }))
        .status;
      discardedAgainStatus = (await asInstructor().gradingDrafts.discard({ draftId: spareDraftId }))
        .status;
    });

    it("a round can be discarded without releasing it", () => {
      expect(discardedStatus).toBe("SUPERSEDED");
    });

    // Pressing the button twice is not an error, and the second press wants the same outcome.
    it("discarding it twice is not an error", () => {
      expect(discardedAgainStatus).toBe("SUPERSEDED");
    });

    it("a submission whose open round was discarded is finished again", async () => {
      const afterAside = await asInstructor().submissions.listForAssignment({ assignmentId });
      expect(afterAside.submissions.map((entry) => [entry.id, entry.bucket])).toContainEqual([
        submissionId,
        null,
      ]);
    });

    it("a discarded round cannot be released", async () => {
      await expect(asInstructor().gradingDrafts.approve({ draftId: spareDraftId })).rejects.toThrow(
        /was discarded and cannot be released/,
      );
    });

    // A round the fellow has read is not something this can unsay.
    it("a released round cannot be discarded", async () => {
      const code = await refusal(() =>
        asInstructor().gradingDrafts.discard({ draftId: correctionDraftId }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    /*
      Nor can a run that is still writing. `generateReportForSubmission` sets the round it claimed to
      READY when it finishes, so discarding one mid-run would not stick — the round would rise again
      as work waiting on somebody, minutes after being dismissed. The row is made directly rather
      than by running the pipeline, which is a sandbox, a model call and a couple of minutes to
      observe a guard that reads one column.
    */
    it("a run still in flight cannot be discarded", async () => {
      const inFlight = await tx().gradingDraft.create({
        data: { submissionId, status: "GENERATING" },
        select: { id: true },
      });

      const code = await refusal(() =>
        asInstructor().gradingDrafts.discard({ draftId: inFlight.id }),
      );
      expect(code).toBe("CONFLICT");
    });
  });
});

/**
 * That a rolled-back transaction really leaves nothing behind.
 *
 * The property every other group in every one of these files rests on, and the only one that cannot
 * be established from inside such a transaction — the assertion has to be made after the rollback,
 * by a reader that was never in it. So this group opens its own transaction rather than using
 * `withRollback`, and counts afterwards through the ordinary client.
 */
describe("what a rolled-back transaction leaves behind", () => {
  it("nothing", async () => {
    const title = `Integration Approve Rollback ${crypto.randomUUID()}`;

    await db
      .$transaction(
        async (tx) => {
          const program = await makeProgram(tx);
          const course = await makeCourse(tx, { programId: program.id });
          const unit = await makeUnit(tx, { courseId: course.id });
          await makeAssignment(tx, { courseId: course.id, courseUnitId: unit.id, title });
          throw new Error("ROLLBACK");
        },
        { timeout: 60_000, maxWait: 30_000 },
      )
      .catch((err: unknown) => {
        if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
      });

    expect(await db.assignment.count({ where: { title } })).toBe(0);
  });
});

/**
 * Two attempts to grade one submission produce one run, not two.
 *
 * **The only group here about what two callers do at once**, which is why it drives `claimRun`
 * directly rather than the procedure above it. Going through `gradingDrafts.generate` would mean
 * actually generating a report — a sandbox, a model call, and a couple of minutes — to observe a
 * decision made in a single statement before any of that.
 *
 * What it is guarding is money. Before this existed, `generateReportForSubmission` created its draft
 * unconditionally, so two instructors on one queue — or one instructor pressing a batch button twice
 * — graded every submission twice over, and only the later report was ever read.
 *
 * The script skipped this whole group whenever the database held no submission with a commit on it,
 * which on a database built from the migrations is every run. The submission is made here instead.
 */
describe("two attempts to grade one submission", () => {
  const tx = withRollback();
  let submissionId: string;
  let firstDraftId: string;

  beforeAll(async () => {
    const world = await makeWorld(tx());
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: assignment.id,
      studentId: world.student.studentId,
      status: "SUBMITTED",
    });
    submissionId = submission.id;
    // A commit, because the interesting comparison is against `head_sha`. The null case is checked
    // below on the same row, since it is the one a plain `=` gets wrong.
    await tx().submission.update({ where: { id: submissionId }, data: { headSha: HEAD_SHA } });
  });

  it("a run can be claimed", async () => {
    const first = await claimRun(tx(), submissionId, HEAD_SHA);
    firstDraftId = first.id;
    expect(first.status).toBe("GENERATING");
  });

  it("...and not claimed again while it is in flight", async () => {
    await expect(claimRun(tx(), submissionId, HEAD_SHA)).rejects.toBeInstanceOf(
      ReportGenerationError,
    );
  });

  // A different commit is different work. Blocking it would refuse to grade a resubmission while
  // the previous commit's run was still going.
  it("...while another commit is a separate run", async () => {
    const other = await claimRun(tx(), submissionId, "0000000000000000000000000000000000000000");
    expect(other.status).toBe("GENERATING");
  });

  /*
    The null-commit case, which is hand-graded work with nothing to compare against. `=` would make
    every one of these claimable forever, because NULL = NULL is not true — so a Google Doc
    submission would be gradable twice at once, and this is the check that says otherwise.
  */
  it("a run with no commit is claimed once too", async () => {
    await claimRun(tx(), submissionId, null);
    await expect(claimRun(tx(), submissionId, null)).rejects.toBeInstanceOf(ReportGenerationError);
  });

  /*
    An abandoned claim is takeable, or a crashed run would block its submission forever — and
    nothing in the interface clears a stuck GENERATING row.
  */
  it("an abandoned claim can be taken", async () => {
    /*
      Aged by the database's own clock rather than by handing it a `Date` from this process. The
      expiry `claimRun` applies is measured against `now()`, so "longer ago than the expiry" has to
      be said in those terms — a timestamp computed here would additionally be asserting that the
      two clocks agree, and would be off by the session's time zone offset besides.
    */
    await tx().$executeRaw`
      UPDATE grading_drafts
         SET created_at = now() - make_interval(secs => ${(CLAIM_EXPIRY_MS + 60_000) / 1000})
       WHERE id = ${firstDraftId}::uuid`;

    const afterExpiry = await claimRun(tx(), submissionId, HEAD_SHA);
    expect(afterExpiry.status).toBe("GENERATING");
  });
});
