import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { isManualOnly } from "@/lib/assignments/spec";
import { Prisma } from "@/lib/generated/prisma/client";
import { groupSelectionInput, parseGroupSelection } from "@/lib/courses/groups";
import {
  activeStudentWork,
  assertOwnsOrTeaches,
  removedStudentIds,
  selectedStudentIds,
} from "@/lib/courses/membership";
import { teachableAssignment } from "@/lib/courses/scope";
import { undeliveredApprovalWhere } from "@/lib/grade/approve";
import { triageBucket } from "@/lib/grade/triage";
import { linkHost } from "@/lib/status";
import { handInState } from "@/lib/submissions/hand-in";
import { signedDownloadUrl } from "@/lib/uploads/storage";
import { assertCanHandIn } from "@/lib/uploads/submit";

import { courseProcedure, createTRPCRouter, instructorProcedure, profileProcedure } from "../init";
import { courseUnitSummarySelect, personSelect } from "../selects";

/**
 * Everything the review surface needs from a submission, in one place.
 *
 * Shared by the two procedures that feed it — `listForAssignment` reads one assignment across
 * students, `listForStudent` reads one student across assignments — because both render the same
 * `GradingReview` component. Spelled out twice, a field added for one screen would be missing on
 * the other, and the failure is a crash in the review pane rather than a visible difference.
 */
const reviewableSubmissionSelect = {
  id: true,
  status: true,
  repoFullName: true,
  repoUrl: true,
  prUrl: true,
  prNumber: true,
  headSha: true,
  // What the instructor opens when there is no pull request: the document the student
  // submitted, or the file they uploaded. Hand grading needs somewhere to read the
  // work from. The path is deliberately not selected — a download is a signed URL from
  // `uploadUrl`, minted per request, and sending the path to the browser would suggest
  // otherwise.
  submittedUrl: true,
  uploadFilename: true,
  uploadSizeBytes: true,
  submittedAt: true,
  isLate: true,
  lastActivityAt: true,
  // The grade, and the commit it describes. `headSha !== gradedHeadSha` is how
  // the queue shows that a student has pushed since being graded — two columns,
  // no API call, true the instant the push lands.
  finalScore: true,
  finalScorePossible: true,
  isComplete: true,
  gradedAt: true,
  gradedHeadSha: true,
  student: { select: personSelect },
  // Enough of the most recent draft to label a row. The review pane loads the draft in full
  // when a row is selected; a list of forty students does not need forty reports in it.
  gradingDrafts: {
    /*
      Never a discarded round. `SUPERSEDED` means a round nobody was sent and nobody has to act
      on, so treating one as the current round put "Report out of date" on a finished submission's
      row — a stale flag about a report that had already been rejected. Excluded here rather than
      filtered by each reader, so this screen and the review pane agree on which round is the
      current one.
    */
    where: { status: { not: "SUPERSEDED" } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, status: true, headSha: true, approvedAt: true },
  },
} as const;

/**
 * A row as selected above, derived from the select rather than described again.
 *
 * Written by hand this widened the draft's `status` to `string`, which `triageBucket` refuses —
 * and would have been a silent loss of the enum everywhere else. Prisma's own payload type cannot
 * drift from the select it is built from.
 */
type ReviewableSubmission = Prisma.SubmissionGetPayload<{
  select: typeof reviewableSubmissionSelect;
}>;

/**
 * Attaches the three derived fields every submission list carries.
 *
 * `bucket` is the same value triage sorts on, computed by the same function, so a submission
 * cannot be outstanding work on one screen and finished on another. `draftIsStale` is two columns
 * compared rather than a query. `activeDraft` is the most recent run, flattened off the relation
 * so the browser never has to know it was an array of one.
 */
function decorateSubmission<T extends ReviewableSubmission>(
  submission: T,
  options: { manualOnly: boolean; undeliveredIds: Set<string> },
) {
  const { gradingDrafts, ...rest } = submission;
  const draft = gradingDrafts[0] ?? null;
  const draftIsStale = draft != null && rest.headSha != null && draft.headSha !== rest.headSha;

  return {
    ...rest,
    bucket: triageBucket(rest.status, draft, {
      draftIsStale,
      hasUndeliveredApproval: options.undeliveredIds.has(rest.id),
      isManualOnly: options.manualOnly,
      mirrorsAnotherSubmission: false,
    }),
    draftIsStale,
    activeDraft: draft,
  };
}

export const submissionsRouter = createTRPCRouter({
  /**
   * A student saying they have read the feedback they were given.
   *
   * **It gates nothing, and that is deliberate.** Resubmitting does not require it and
   * `assertCanHandIn` has never heard of it. What it buys is a dashboard that can stop showing a
   * report the student has already been through, which is the difference between a list of things
   * to do and a list of things that exist.
   *
   * One timestamp, read against `gradedAt` rather than merely checked for null — see
   * `feedbackIsUnread`. That is what makes a second round of feedback unread again without a
   * second column, and it is why this writes the clock rather than a boolean.
   */
  markFeedbackReviewed: profileProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const submission = await ctx.db.submission.findUnique({
        where: { id: input.submissionId },
        select: { id: true, studentId: true, status: true },
      });

      if (!submission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found." });
      }

      // Scoped to the caller's own submission. Prisma bypasses row level security, so
      // this comparison is the only thing stopping one student acting on another's.
      if (submission.studentId !== ctx.profile.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your submission." });
      }

      /*
        Refused rather than recorded, because a read timestamp on ungraded work would be a
        claim about a report that does not exist — and once `gradedAt` arrived it would sit
        earlier than the grade, which `feedbackIsUnread` correctly reads as unread anyway. The
        row would be harmless and meaningless, which is worse than an error a caller can see.
      */
      if (submission.status !== "GRADED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "There is no feedback on this submission yet.",
        });
      }

      /*
        No `lastActivityAt`, unlike every other student write in this file. That column drives
        the instructor's queue ordering, and a student reading their feedback is not activity on
        the work — it would move a submission up a grading pile nobody needed to look at again.
      */
      return ctx.db.submission.update({
        where: { id: submission.id },
        data: { feedbackReviewedAt: new Date() },
        select: { id: true, feedbackReviewedAt: true },
      });
    }),

  /**
   * A student declaring that work with no pull request is finished.
   *
   * For a repository assignment, opening the pull request is that declaration and the
   * webhook records it — status, `submittedAt`, and `isLate` all follow from the event. The
   * other two kinds have no webhook and nothing to observe, so this procedure does the same
   * job: without it, hand-graded work would never enter triage and would read as never
   * started rather than as waiting, which is the difference between an instructor seeing it
   * and not.
   *
   * The URL is where the student's own copy of the document is. A `FILE_UPLOAD` assignment is
   * refused here and hands in through `POST /api/submissions/upload` instead: storing the file
   * *is* the act of submitting, so letting this procedure mark one submitted would put work in
   * the instructor's queue with nothing to open, and would make two things authorities on the
   * same columns. The authorization rule is shared with that route rather than written twice.
   */
  submitWork: profileProcedure
    .input(
      z.object({
        // The assignment rather than the submission, because a submission row may not exist
        // yet: for a kind with no Accept, submitting is the first thing that happens to it.
        assignmentId: z.string().uuid(),
        /**
         * The student's copy of the document, for GOOGLE_DRIVE.
         *
         * `linkHost` rather than Zod's `.url()` alone, because the two ask different questions.
         * `.url()` asks whether the string parses, and `javascript:alert(1)` parses — it is a
         * script that would later be rendered as an anchor on an instructor's signed-in page.
         * The same function the row draws with decides here, so nothing can be stored that the
         * screen would then refuse to open.
         */
        submittedUrl: z
          .string()
          .max(2000)
          .refine(
            (url) => linkHost(url) !== null,
            "That is not a web address. Paste a link beginning with https://",
          )
          .nullable()
          .default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const assignment = await assertCanHandIn(ctx.db, {
        profileId: ctx.profile.id,
        assignmentId: input.assignmentId,
        expect: "link",
      });

      if (!input.submittedUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Paste the link to your copy of the document before submitting, so your " +
            "instructor can open the right one.",
        });
      }

      const now = new Date();

      /*
        Read before written, because what this hand-in means depends on the state the
        submission is already in. Work handed in on top of a released grade is a revision and
        has to enter the queue as one, and the time the work was first handed in is not
        something a later hand-in may move. `handInState` is that rule, shared with the upload
        route and the pull request webhook so the three ways work arrives cannot disagree
        about it.

        The row may not exist yet. A student can reach this without having pressed Accept, so
        an upsert is what keeps a missing row from being an error the student cannot act on,
        and a null `current` is what tells the rule this is a first submission.
      */
      const current = await ctx.db.submission.findUnique({
        where: {
          assignmentId_studentId: { assignmentId: assignment.id, studentId: ctx.profile.id },
        },
        select: { status: true, submittedAt: true, isLate: true },
      });

      const state = handInState({ current, dueAt: assignment.dueAt, now });

      return ctx.db.submission.upsert({
        where: {
          assignmentId_studentId: { assignmentId: assignment.id, studentId: ctx.profile.id },
        },
        create: {
          assignmentId: assignment.id,
          studentId: ctx.profile.id,
          ...state,
          submittedUrl: input.submittedUrl,
          lastActivityAt: now,
        },
        update: {
          ...state,
          submittedUrl: input.submittedUrl,
          // Now, not `submittedAt`: this is when the work last moved, and it is what orders
          // the instructor's queue. A revision that carried the original submission time here
          // would sit at the bottom of the pile it had just been added to.
          lastActivityAt: now,
        },
        select: { id: true, status: true, submittedUrl: true, submittedAt: true, isLate: true },
      });
    }),

  /**
   * A short-lived link to one uploaded file.
   *
   * **A mutation rather than a query, though it reads nothing.** The URL it returns expires in
   * minutes, so caching it — which is what a query does — would hand back a dead link on the
   * second press. This way the link is minted when the button is pressed, and a list of forty
   * students does not mint forty URLs nobody clicked.
   *
   * Reachable by the student who owns the submission and by an instructor who teaches the
   * course, and nobody else. That check is the *whole* of the access control on stored files:
   * the bucket is private with no policies, so there is no other route to the bytes.
   */
  uploadUrl: profileProcedure
    .input(
      z.object({
        submissionId: z.string().uuid(),
        /**
         * `inline` is for an embedded preview and `attachment` saves the file. Both go through
         * the same authorization, because they are the same bytes — the disposition decides
         * what the browser does with them, not who may have them.
         */
        disposition: z.enum(["attachment", "inline"]).default("attachment"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const submission = await ctx.db.submission.findUnique({
        where: { id: input.submissionId },
        select: {
          id: true,
          studentId: true,
          uploadPath: true,
          uploadFilename: true,
          assignment: { select: { courseId: true } },
        },
      });

      if (!submission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found." });
      }

      /*
        The student who owns this, or an instructor of its course. Holding the INSTRUCTOR role
        is not enough, for the reason every authoring procedure checks the same thing: it says
        nothing about *which* courses, so without this one cohort's instructor could read
        another cohort's submissions.
      */
      await assertOwnsOrTeaches(ctx, {
        studentId: submission.studentId,
        courseId: submission.assignment.courseId,
      });

      if (!submission.uploadPath) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "There is no uploaded file on this submission.",
        });
      }

      return {
        url: await signedDownloadUrl({
          path: submission.uploadPath,
          filename: submission.uploadFilename,
          disposition: input.disposition,
        }),
      };
    }),

  /**
   * A student declaring that revised work is ready for another look.
   *
   * The deliberate half of resubmission. A push is recorded automatically and means
   * only that newer code exists; students commit while they work and a commit is not a
   * claim of completion. This is the act that says "look again", and it is what
   * distinguishes a student still working from one who finished and is waiting.
   */
  declareResubmission: profileProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const submission = await ctx.db.submission.findUnique({
        where: { id: input.submissionId },
        select: { id: true, studentId: true, status: true, headSha: true, gradedHeadSha: true },
      });

      if (!submission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found." });
      }

      // Scoped to the caller's own submission. Prisma bypasses row level security, so
      // this comparison is the only thing stopping one student acting on another's.
      if (submission.studentId !== ctx.profile.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your submission." });
      }

      if (submission.status !== "GRADED" && submission.status !== "RESUBMITTED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This submission has not been graded yet, so there is nothing to resubmit. " +
            "Your work is already in the queue.",
        });
      }

      // Nothing new to look at. Told plainly rather than accepted quietly, because a
      // student who pressed this expecting to send something would otherwise wait on a
      // review of the code that was already graded.
      if (submission.headSha && submission.headSha === submission.gradedHeadSha) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No new commits since this was graded. Push your changes first, then " +
            "declare it ready.",
        });
      }

      return ctx.db.submission.update({
        where: { id: submission.id },
        data: { status: "RESUBMITTED", lastActivityAt: new Date() },
        select: { id: true, status: true },
      });
    }),

  /**
   * Everything in one course that is waiting on the caller. Instructors only.
   *
   * The landing screen for an instructor, so it answers "what do I do next" rather than
   * "what exists". Taken together the buckets are the whole of the outstanding grading:
   * every submission a student has declared finished and nobody has approved appears in
   * exactly one of them, whether or not a report has been generated for it yet.
   *
   * One course, not all of them. The course is required rather than optional: an
   * instructor teaching two cohorts at once was shown both piles interleaved, and "what do
   * I do next" is not a question that can be answered across cohorts — the answer depends
   * on which one you are teaching this hour. There is no unscoped mode to fall back into,
   * because leaving one available is how the screen came to use it.
   *
   * Which bucket is decided by the submission's most recent grading draft, not by
   * `submission.status`. Generating a report writes the draft's status and leaves the
   * submission's alone — only approving moves a submission to GRADED — so `DRAFT_READY`,
   * `NEEDS_MANUAL_REVIEW`, and `GRADING_FAILED` are values nothing ever writes. Reading
   * them here would leave every bucket permanently empty.
   *
   * Two buckets exist because the work is otherwise invisible. `comment_not_posted` is a
   * grade recorded whose comment never reached the pull request: the submission reads as
   * finished from every other angle, but the student was never told. And a draft
   * describing a commit the student has since pushed past is deliberately not "ready to
   * review" — approving it is refused — so it falls back to `needs_report`.
   */
  /*
    Deliberately **not** `courseProcedure`, and the one instructor read that is not.

    Its `visible` check below answers two questions at once — may this caller see the pile, and
    is the cohort archived — and answers the first with an empty result rather than a refusal,
    because on this screen the two reasons to see nothing are not worth telling apart: a cohort
    somebody else teaches and a cohort that has finished both have nothing waiting on you.
    `courseProcedure` would turn that into a FORBIDDEN, which is a different answer to a
    question this screen deliberately does not ask.
  */
  triage: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), group: groupSelectionInput }))
    .query(async ({ ctx, input }) => {
      /*
        Narrowed on the server rather than in the browser, which is what keeps this screen
        agreeing with the assignments list: that one aggregates its counts before sending them
        and cannot filter afterwards, so one server-side rule is what stops the two from
        describing different sets of students under the same group name.
      */
      const selection = parseGroupSelection(input.group);
      /*
        Whether the caller may see this course's pile at all. An admin may see any course;
        an instructor only the ones they are listed on. This is also the access check —
        everything below is scoped by the ids it returns, and it deliberately crosses both
        students and assignments, so nothing narrower could stand in for it.

        Archived either way. An archived cohort is readable and its work is finished, so it
        has nothing waiting on anyone; leaving it here is how a term that ended keeps
        appearing in "what do I do next" for as long as the account exists. The admin branch
        has always filtered it and the instructor branch never did, which meant the rule held
        for the one reader who does not teach and failed for every reader who does.
      */
      const visible =
        ctx.profile.role === "ADMIN"
          ? await ctx.db.course.findMany({
              where: { id: input.courseId, archivedAt: null },
              select: { id: true },
            })
          : await ctx.db.courseInstructor.findMany({
              where: {
                userId: ctx.profile.id,
                courseId: input.courseId,
                course: { archivedAt: null },
              },
              select: { courseId: true },
            });

      // Empty rather than a refusal, because the two reasons to be here are not worth
      // telling apart on this screen: a course that is archived and a course somebody else
      // teaches both have nothing in them waiting on the caller.
      if (visible.length === 0) {
        return { submissions: [], gradedCount: 0 };
      }

      const submissions = await ctx.db.submission.findMany({
        where: {
          assignment: { courseId: input.courseId },
          /*
            Students currently in the cohort. A removed student's unfinished work is not
            waiting on anybody — nobody is going to grade a submission from somebody who has
            left the program — and left in, it sits here permanently, in a count that is
            supposed to answer whether the instructor is caught up. It is not deleted: the
            gradebook shows it, in its own table, which is where a departed student's record
            belongs. Restoring them puts it straight back, because this reads live status.
          */
          ...activeStudentWork(input.courseId, selection),
          OR: [
            // Open work, whether or not a run has happened yet.
            { status: { in: ["SUBMITTED", "RESUBMITTED"] } },
            // A run that reached some state a person has to act on. Included
            // independently of the submission's status, because a student can push after
            // being graded and have a new draft waiting while the submission still reads
            // GRADED.
            {
              gradingDrafts: {
                some: { status: { in: ["READY", "NEEDS_MANUAL_REVIEW", "FAILED", "GENERATING"] } },
              },
            },
            // Approved, but the comment never reached the pull request. Recoverable —
            // there is a retry — and worth finding without being looked for. Not the same
            // as a submission that never had a pull request to post to, which is every
            // hand-graded one: `undeliveredApprovalWhere` is what keeps those out.
            { gradingDrafts: { some: undeliveredApprovalWhere() } },
          ],
        },
        orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          status: true,
          isLate: true,
          headSha: true,
          gradedHeadSha: true,
          submittedAt: true,
          lastActivityAt: true,
          // Deliberately narrower than `personSelect` — a pile of work to grade names people and
          // does not need their GitHub handles. `testStudentNumber` is here because the row has to
          // be able to say it is a rehearsal rather than somebody's work.
          student: {
            select: { id: true, displayName: true, email: true, testStudentNumber: true },
          },
          // `sections` for the grading mode: an assignment the pipeline cannot grade lands
          // in a different bucket, because the action waiting on the instructor is
          // different and generating a report is not one of the things they can do.
          assignment: {
            select: { id: true, title: true, courseId: true, sections: true },
          },
          /*
            The most recent round that was not discarded. A discarded one is a round nobody was
            sent and nobody has to act on, so reading it as the current round flagged finished
            work as having an out-of-date report. The same exclusion as
            `reviewableSubmissionSelect`, so triage and the review pane cannot disagree about
            which round is current.
          */
          gradingDrafts: {
            where: { status: { not: "SUPERSEDED" } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              headSha: true,
              approvedAt: true,
              sections: {
                select: {
                  flags: true,
                  confidence: true,
                  scoreEarned: true,
                  editedScoreEarned: true,
                  scorePossible: true,
                },
              },
            },
          },
        },
      });

      // Counted rather than fetched. The screen shows how many are done, not which.
      // Same restriction as the pile above, so the two halves of "3 left, 12 approved"
      // describe the same set of students.
      const gradedCount = await ctx.db.submission.count({
        where: {
          assignment: { courseId: input.courseId },
          ...activeStudentWork(input.courseId, selection),
          status: "GRADED",
        },
      });

      /*
        Which of these have a grade that was approved but never reached the pull request.
        Asked as its own question rather than read off the most recent draft, because the
        undelivered one is frequently not the most recent: the usual sequence is approve,
        the comment fails, the student pushes, a new draft is generated on top.
      */
      const undelivered = await ctx.db.gradingDraft.findMany({
        where: undeliveredApprovalWhere({ id: { in: submissions.map((s) => s.id) } }),
        select: { submissionId: true },
        distinct: ["submissionId"],
      });
      const undeliveredIds = new Set(undelivered.map((draft) => draft.submissionId));

      const rows = submissions.map(({ gradingDrafts, assignment, ...submission }) => {
        const draft = gradingDrafts[0] ?? null;
        // Read for the bucket and then dropped: the section mapping is what decides how
        // this row is graded, and nothing on the screen renders it.
        const { sections, ...assignmentFields } = assignment;

        // The draft describes a commit the student has pushed past. Approval refuses a
        // stale draft, so the row must not be offered as ready to approve.
        const draftIsStale =
          draft != null && submission.headSha != null && draft.headSha !== submission.headSha;

        return {
          ...submission,
          assignment: assignmentFields,
          bucket: triageBucket(submission.status, draft, {
            draftIsStale,
            hasUndeliveredApproval: undeliveredIds.has(submission.id),
            isManualOnly: isManualOnly(sections),
            mirrorsAnotherSubmission: false,
          }),
          draftIsStale,
          // Flattened here rather than in the interface. Delivery is deliberately not on
          // this object: whether a grade reached the student is answered by the bucket,
          // and a second copy of the answer here would be one that could disagree.
          activeDraft: draft
            ? {
                id: draft.id,
                status: draft.status,
                headSha: draft.headSha,
                approvedAt: draft.approvedAt,
                sections: draft.sections,
              }
            : null,
        };
      });

      // A row matching the query but landing in no bucket has nothing for a person to
      // do — a superseded draft on a graded submission, say. Dropped here so the
      // interface never has to decide what to do with one.
      return { submissions: rows.filter((row) => row.bucket != null), gradedCount };
    }),

  /**
   * Every submission for one assignment. Instructors only.
   *
   * One of two procedures that read a grid of submissions along one axis: this one is a fixed
   * assignment across many students, and `listForStudent` below is a fixed student across many
   * assignments. They share `reviewableSubmissionSelect` and `decorateSubmission` rather than
   * each spelling the shape out, because the review surface is the same component either way and
   * a field present on one screen and missing on the other is a crash rather than a difference.
   *
   * Gated on the caller teaching the course rather than on `instructorProcedure` alone, because
   * this deliberately reads across students.
   *
   * Each row carries the same `bucket` the triage screen sorts on, computed the same
   * way. The grading queue's "needs review" filter is then the same question triage
   * answers — a submission cannot be work to do on one screen and finished on the other.
   */
  listForAssignment: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid(), group: groupSelectionInput }))
    .query(async ({ ctx, input }) => {
      const selection = parseGroupSelection(input.group);
      const assignment = await teachableAssignment(ctx, input.assignmentId, {
        id: true,
        title: true,
        courseId: true,
        dueAt: true,
        kind: true,
        sections: true,
      });

      /*
        Read once for the whole queue rather than per row: every submission here belongs to
        this one assignment, so how it is graded is a property of the page. The review
        surface reads it too — it decides whether the screen offers to generate a report or
        an empty draft to type into.
      */
      const manualOnly = isManualOnly(assignment.sections);

      const submissions = await ctx.db.submission.findMany({
        where: { assignmentId: assignment.id },
        orderBy: [{ status: "asc" }, { submittedAt: "asc" }],
        select: reviewableSubmissionSelect,
      });

      const undelivered = await ctx.db.gradingDraft.findMany({
        where: undeliveredApprovalWhere({ id: { in: submissions.map((s) => s.id) } }),
        select: { submissionId: true },
        distinct: ["submissionId"],
      });
      const undeliveredIds = new Set(undelivered.map((draft) => draft.submissionId));
      const removed = await removedStudentIds(ctx.db, assignment.courseId);

      // Null when nothing is selected — see `selectedStudentIds`, which is shared with the
      // gradebook and the assignments list so a group means the same set of students on all three.
      const inSelection = await selectedStudentIds(ctx.db, assignment.courseId, selection);

      const decorate = (submission: (typeof submissions)[number]) =>
        decorateSubmission(submission, { manualOnly, undeliveredIds });

      /**
       * Why a submission is out of the pile, or null when it is in it.
       *
       * Removal is checked first because it is the stronger fact: somebody who has left the
       * cohort is not work to be done whichever group they were in, and telling an instructor
       * they are merely outside the current filter would read as something a picker can fix.
       */
      const asideReason = (studentId: string): "removed" | "outside_group" | null => {
        if (removed.has(studentId)) return "removed";
        if (inSelection && !inSelection.has(studentId)) return "outside_group";
        return null;
      };

      return {
        // Spelled out rather than spread, so `sections` does not travel to the browser as a
        // second copy of a question `manualOnly` has already answered.
        assignment: {
          id: assignment.id,
          title: assignment.title,
          courseId: assignment.courseId,
          dueAt: assignment.dueAt,
          kind: assignment.kind,
          manualOnly,
        },
        /**
         * The queue itself: students currently in the cohort, and in the selected group.
         *
         * A removed student is not work to be done, so they are not in the pile an instructor
         * works down — the same reason they are out of grading triage. A student outside the
         * selected group is out for a different and much weaker reason, which is why the two
         * are told apart below rather than merged into "not here".
         */
        submissions: submissions
          .filter((row) => asideReason(row.student.id) === null)
          .map(decorate),
        /**
         * Work this queue does not list and will still open when a link names one.
         *
         * One array with a reason rather than two arrays, because these are *read* identically —
         * never listed, opened when the query string asks for one, and banner-ed above the
         * report — and it is only the sentence in the banner that differs. Splitting them would
         * mean the review pane searching a third place every time a reason is added.
         *
         * Both cases are links that must not break. The gradebook's Removed table links straight
         * to a departed student's submission, and a colleague's link or a stale tab can name
         * somebody outside the group now selected. Falling back to the first row of the list
         * instead would quietly show a different student's report under a URL that named one —
         * which is worse than an empty pane, because nothing about it looks wrong.
         *
         * Partitioned from one query so the two sets are exhaustive. A filter and its complement
         * written as separate queries can each miss a row and nothing would say so.
         */
        asideSubmissions: submissions
          .map((row) => ({ row, reason: asideReason(row.student.id) }))
          .filter((entry) => entry.reason !== null)
          .map((entry) => ({ ...decorate(entry.row), asideReason: entry.reason! })),
      };
    }),

  /**
   * One student's submissions in one course. Instructors only.
   *
   * The other axis of `listForAssignment`: a fixed student across many assignments rather than a
   * fixed assignment across many students. The same rows, the same `bucket`, the same review
   * surface — which is why both go through `reviewableSubmissionSelect` and `decorateSubmission`
   * rather than describing the shape twice.
   *
   * **Every assignment, not every submission.** A row is returned for an assignment the student
   * has not started, with `submission: null`, because "has not begun this" is a fact about the
   * student worth reading and a list of only what exists cannot say it. That is the difference
   * between this and the grading queue, where a student who never accepted is deliberately absent:
   * there the question is what is left to grade, here it is how somebody is doing.
   *
   * Unpublished assignments are included. An instructor reading a student's record is entitled to
   * see the ones the cohort cannot: leaving them out would make the list disagree with the
   * gradebook beside it for no reason a reader could work out.
   *
   * Any enrollment status. A removed student's record is exactly what this screen is for.
   */
  listForStudent: courseProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      /*
        The enrollment is what proves the student belongs to this course, so it is the access
        check as well as a fact for the header. Without it, any student id plus a course the
        caller teaches would return an empty list rather than a refusal — which reads as "this
        student has done nothing" instead of "this student is not in this cohort".
      */
      const enrollment = await ctx.db.enrollment.findFirst({
        where: { courseId: input.courseId, studentId: input.studentId },
        select: {
          status: true,
          student: {
            select: personSelect,
          },
          course: { select: { id: true, name: true, cohortTerm: true, archivedAt: true } },
        },
      });

      if (!enrollment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That student is not in this course.",
        });
      }

      const assignments = await ctx.db.assignment.findMany({
        where: { courseId: input.courseId },
        // Course order — the sequence the instructor set — because reading a student's record is
        // reading it in the order they met the work.
        orderBy: [{ courseUnit: { position: "asc" } }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          kind: true,
          dueAt: true,
          pointValue: true,
          completionThreshold: true,
          distributedAt: true,
          courseUnit: { select: courseUnitSummarySelect },
          // Read for the grading mode and not returned whole: `manualOnly` is the answer the
          // review pane needs, and `sections` is a large object a screen has no use for.
          sections: true,
          // Scoped to this one student, so the relation is their submission or nothing.
          submissions: {
            where: { studentId: input.studentId },
            select: reviewableSubmissionSelect,
            take: 1,
          },
        },
      });

      const submissionIds = assignments.flatMap((row) => row.submissions.map((sub) => sub.id));

      const undelivered = await ctx.db.gradingDraft.findMany({
        where: undeliveredApprovalWhere({ id: { in: submissionIds } }),
        select: { submissionId: true },
        distinct: ["submissionId"],
      });
      const undeliveredIds = new Set(undelivered.map((draft) => draft.submissionId));

      /*
        Which cohorts this student is in that the caller also teaches, so the screen can offer to
        look at the same person in another course.

        Asked here rather than by a second procedure, because it is one query and the screen is
        useless without it: a student repeating a module has two sets of submissions, and a page
        that could only show the one in its own URL would make finding the other a guess. Scoped
        by what the caller teaches, so it does not report the existence of cohorts they cannot open.
      */
      const otherEnrollments = await ctx.db.enrollment.findMany({
        where: {
          studentId: input.studentId,
          ...(ctx.profile.role === "ADMIN"
            ? {}
            : { course: { instructors: { some: { userId: ctx.profile.id } } } }),
        },
        orderBy: { course: { createdAt: "desc" } },
        select: {
          status: true,
          course: { select: { id: true, name: true, cohortTerm: true } },
        },
      });

      return {
        student: enrollment.student,
        course: enrollment.course,
        /** So the screen can say they have left, the way every other reader of this does. */
        enrollmentStatus: enrollment.status,
        /** Includes the course being read, so the selector holds the full set rather than the rest. */
        courses: otherEnrollments.map((row) => ({ ...row.course, enrolledAs: row.status })),
        rows: assignments.map(({ sections, submissions, ...assignment }) => {
          const manualOnly = isManualOnly(sections);
          const submission = submissions[0] ?? null;

          return {
            assignment: {
              ...assignment,
              /** Whether it is graded by hand, which decides what the review pane offers. */
              manualOnly,
            },
            submission: submission
              ? decorateSubmission(submission, { manualOnly, undeliveredIds })
              : null,
          };
        }),
      };
    }),
});
