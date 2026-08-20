import "server-only";

import { TRPCError } from "@trpc/server";

import { isLinkSubmitted } from "../assignments/spec";
import type { AssignmentKind } from "../generated/prisma/enums";
import type { db as globalDb } from "../prisma";
import { handInState } from "../submissions/hand-in";
import { checkUpload } from "./file-types";
import { storeSubmissionUpload } from "./storage";

/**
 * Handing in work that has no repository.
 *
 * **This module exists so the rule about who may submit has one implementation.** A file
 * upload cannot go through tRPC — the transport is JSON and a 25MB file base64'd into a
 * mutation is a bad way to move bytes — so it arrives at a route handler instead. That is a
 * second entry point, and a second entry point is exactly how an authorization rule ends up
 * with two versions that drift. So the rule lives here, and both the route and
 * `submissions.submitWork` call it.
 *
 * It throws `TRPCError`, which the procedure propagates unchanged and the route maps to a
 * status code. One error vocabulary rather than one per transport.
 */

type Db = typeof globalDb | Parameters<Parameters<typeof globalDb.$transaction>[0]>[0];

export type HandInAssignment = {
  id: string;
  kind: string;
  courseId: string;
  dueAt: Date | null;
  acceptedFileTypes: string[];
};

/**
 * The assignment, if this caller may hand work in for it right now.
 *
 * Every check is here rather than split between the caller and this function, because a check
 * a caller is expected to have done first is a check one caller will not do.
 */
export async function assertCanHandIn(
  db: Db,
  params: {
    profileId: string;
    assignmentId: string;
    /**
     * How the caller collects work: `"link"` for a URL the student pastes, `"file"` for bytes
     * they upload. Named for the mechanism rather than for a kind, because two kinds are handed
     * in as a link and a third added later would otherwise have to be remembered here.
     */
    expect?: "link" | "file";
  },
): Promise<HandInAssignment> {
  const assignment = await db.assignment.findUnique({
    where: { id: params.assignmentId },
    select: {
      id: true,
      kind: true,
      courseId: true,
      dueAt: true,
      distributedAt: true,
      acceptedFileTypes: true,
    },
  });

  if (!assignment) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found." });
  }

  /*
    A repository assignment's submission signal is the pull request, and there is no version
    of this that should accept one. Letting a student declare a REPO assignment finished here
    would mark work submitted with no code to look at, and would make this a second authority
    on columns the webhook owns.
  */
  if (assignment.kind === "REPO") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This assignment is submitted by opening a pull request from your draft branch " +
        "into main. That is what puts it in your instructor's queue.",
    });
  }

  const collectedAs: "link" | "file" = isLinkSubmitted(assignment.kind as AssignmentKind)
    ? "link"
    : "file";

  if (params.expect && collectedAs !== params.expect) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        params.expect === "file"
          ? "This assignment is not handed in as a file."
          : "This assignment is not handed in as a link.",
    });
  }

  // An unpublished assignment is invisible to a student, and NOT_FOUND rather than FORBIDDEN
  // for the same reason `listForCourse` hides it: whether a draft assignment exists is not a
  // student's business.
  if (assignment.distributedAt === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That assignment is not available." });
  }

  /*
    Checked here rather than relying on having listed the course first: a mutation must not
    assume which query preceded it.

    `ACTIVE` deliberately, and this is one of the three checks that must *not* widen when the
    read checks do. A removed student can still open this assignment and read what they were
    given; handing new work in is what stops. The two clauses differ by one enum value, which
    is why the difference is named in `lib/courses/membership.ts` rather than left to be
    noticed here.
  */
  const enrollment = await db.enrollment.findFirst({
    where: { courseId: assignment.courseId, studentId: params.profileId, status: "ACTIVE" },
    select: { id: true },
  });

  if (!enrollment) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not enrolled in the course this assignment belongs to.",
    });
  }

  /*
    Work an instructor is part-way through reading is not work a student may replace.

    **This is the whole of the rule that makes updating a submission safe.** Handing in again is
    otherwise an overwrite — `submittedUrl` and the four upload columns are single-valued, so the
    previous link or file is gone — and doing that while somebody is writing feedback about it
    leaves a grade describing a document nobody can open. The repository kinds are protected from
    the same thing by `draftIsStale`, which compares the draft's commit against the submission's;
    a link or a file has no commit to compare, so the protection has to be this instead.

    Deliberately narrow. `SUPERSEDED` is a draft that has already been replaced and `FAILED` is a
    run that produced nothing, so neither is anybody's work in progress, and blocking on them
    would lock a student out over a pipeline error they cannot see or fix. An approved draft is
    not caught either, which is what leaves the ordinary resubmission path open after a grade.
  */
  const openDraft = await db.gradingDraft.findFirst({
    where: {
      submission: { assignmentId: assignment.id, studentId: params.profileId },
      approvedAt: null,
      status: { in: ["GENERATING", "READY", "NEEDS_MANUAL_REVIEW"] },
    },
    select: { id: true },
  });

  if (openDraft) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Your instructor is reviewing this now, so it cannot be changed. Wait for their " +
        "feedback — you can hand in revised work once it arrives.",
    });
  }

  return {
    id: assignment.id,
    kind: assignment.kind,
    courseId: assignment.courseId,
    dueAt: assignment.dueAt,
    acceptedFileTypes: assignment.acceptedFileTypes,
  };
}

/**
 * Stores an uploaded file and marks the submission handed in.
 *
 * The order is what matters, and it is chosen so no failure can leave a submission that reads
 * as handed in with nothing behind it:
 *
 *   1. Ensure the row exists, without touching its status. A `FILE_UPLOAD` assignment has no
 *      Accept, so uploading is often the first thing that ever happens to it and there may be
 *      no row at all — and the path the bytes go to is built from the row's id, so the row has
 *      to come first.
 *   2. Store the bytes.
 *   3. Write the status, the timestamps, and the four upload columns in one update.
 *
 * A failure at step 2 leaves a row that reads as not started, which is true. A failure at
 * step 3 leaves a stored object nothing points at, which is unreferenced bytes rather than a
 * wrong grade. The reverse order — mark it submitted, then store — would put work in the
 * instructor's queue with nothing to open, and there is no version of that which is better.
 */
export async function storeAndRecordUpload(
  db: Db,
  params: {
    profileId: string;
    assignment: HandInAssignment;
    filename: string;
    bytes: Buffer;
  },
) {
  const check = checkUpload({
    filename: params.filename,
    sizeBytes: params.bytes.byteLength,
    acceptedTypes: params.assignment.acceptedFileTypes,
  });

  if (!check.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
  }

  const submission = await db.submission.upsert({
    where: {
      assignmentId_studentId: {
        assignmentId: params.assignment.id,
        studentId: params.profileId,
      },
    },
    create: {
      assignmentId: params.assignment.id,
      studentId: params.profileId,
      status: "NOT_STARTED",
    },
    /*
      Nothing written, so what comes back is the row as it stands — which is what the hand-in
      rule below needs, and the reason no second read is made for it. On the create branch it
      is the row just made: no submission time, never late, and not yet started.
    */
    update: {},
    select: { id: true, status: true, submittedAt: true, isLate: true },
  });

  const { path } = await storeSubmissionUpload({
    submissionId: submission.id,
    extension: check.extension,
    /*
      The type the extension implies, not the one the browser reported.

      They are usually the same and the exceptions are the whole point: a `.docx` arrives as
      `application/octet-stream` on a machine without Word, and a `.ipynb` almost never arrives
      as anything Jupyter would recognise. The bucket has its own allow-list built from these
      same entries, so storing what the browser said means an upload the route accepted and the
      bucket refuses — on one student's machine and no other.
    */
    contentType: check.contentType,
    bytes: params.bytes,
  });

  const now = new Date();

  /*
    Status, submission time, and lateness together, by the same rule the link form and the pull
    request webhook use: a file uploaded on top of a released grade is a revision, and it does
    not move the time the work was first handed in.
  */
  const state = handInState({ current: submission, dueAt: params.assignment.dueAt, now });

  return db.submission.update({
    where: { id: submission.id },
    data: {
      ...state,
      // When the work last moved, which is what orders the instructor's queue. The submission
      // time inside `state` is the first hand-in and does not answer that.
      lastActivityAt: now,
      uploadPath: path,
      uploadFilename: params.filename,
      uploadSizeBytes: params.bytes.byteLength,
      uploadContentType: check.contentType,
    },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      isLate: true,
      uploadFilename: true,
      uploadSizeBytes: true,
    },
  });
}
