import "server-only";

import { TRPCError } from "@trpc/server";

import { handInMethodsFor } from "../assignments/spec";
import { HandInMethod } from "../generated/prisma/enums";
import type { AssignmentKind } from "../generated/prisma/enums";
import type { db as globalDb } from "../prisma";
import { handInState } from "../submissions/hand-in";
import {
  claimTeamWork,
  syncTeamRows,
  recordHandIn,
  teamForStudent,
  teamSubmissionFor,
  type ResolvedTeam,
} from "../submissions/team";
import { checkUpload, extensionOf } from "./file-types";
import {
  removeSubmissionUpload,
  signedUploadUrl,
  submissionUploadPath,
  uploadedObjectInfo,
} from "./storage";

/**
 * Handing in work that has no repository.
 *
 * **This module exists so the rule about who may submit has one implementation.** Work arrives
 * three ways — a link a student pastes, a file they upload, a task they mark done — and each is
 * its own procedure with its own columns to write. The question they all have to ask first is the
 * same one, and an authorization rule written out three times is an authorization rule with three
 * versions that drift. So it is written here, as `assertCanHandIn`, and each of them calls it.
 *
 * **A file is handed in with two calls rather than one**, because the bytes no longer travel
 * through this application at all: `beginUpload` authorizes and returns an address, the browser
 * sends the file straight to the bucket, and `recordUpload` writes down what arrived. See
 * `signedUploadUrl` for why, and for what the browser can and cannot do with that address.
 *
 * Everything here throws `TRPCError`, which the procedures propagate unchanged.
 */

type Db = typeof globalDb | Parameters<Parameters<typeof globalDb.$transaction>[0]>[0];

export type HandInAssignment = {
  id: string;
  kind: AssignmentKind;
  courseId: string;
  dueAt: Date | null;
  acceptedFileTypes: string[];
  handInMethods: HandInMethod[];
  /**
   * Whether a fellow may mark this task done themselves. Null for every kind but `TASK`.
   *
   * Selected here rather than read again by `markTask`, because this function has already fetched
   * the assignment and a second query would be a second answer to the same question. Read through
   * `taskIsSelfMarked` — the refusal it drives is the mutation's own, not this function's: nothing
   * about handing work in depends on it.
   */
  studentMayMarkDone: boolean | null;
  /**
   * The team this caller hands in with, or null for work they do alone.
   *
   * Resolved here so no caller decides which row the work goes on. It is the difference between
   * "your submission" and "your team's", and every write below reads it rather than asking again.
   */
  team: ResolvedTeam | null;
  /**
   * The row already holding this team's work, or null before anybody has started.
   *
   * Read rather than claimed, because this function only refuses — the claim is a write and
   * belongs to whichever act is about to hand something in. What it is for is the open-draft lock
   * below, which has to ask about the team's drafts rather than the caller's.
   */
  teamSubmissionId: string | null;
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
     * How the caller collects work: `LINK` for a URL the student pastes, `FILE` for bytes they
     * upload. The same vocabulary the assignment itself is written in, so there is no pair of
     * spellings that have to be kept in step — this is compared straight against what
     * `handInMethodsFor` returns.
     */
    expect?: HandInMethod;
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
      handInMethods: true,
      studentMayMarkDone: true,
      teamSetId: true,
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

  /*
    Whether this assignment takes work this way at all.

    A membership test rather than an equality, because an assignment may name more than one way
    in — and the caller knows only how *it* collects work. The two halves of an upload ask about
    FILE and the link form about LINK, and an assignment that accepts both answers yes to each.
  */
  if (params.expect && !handInMethodsFor(assignment).includes(params.expect)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        params.expect === HandInMethod.FILE
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
    where: {
      // Reached through the program, because that is where an enrollment lives. The course is
      // still what identifies which roster to look on.
      program: { courses: { some: { id: assignment.courseId } } },
      studentId: params.profileId,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  if (!enrollment) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not enrolled in the program this assignment belongs to.",
    });
  }

  /*
    Which team this caller hands in with, when the assignment is handed in by teams at all.

    Read from their own membership, so there is no team id anywhere for a caller to substitute —
    the same reason `accept` resolves it this way. A fellow on no team of the set is refused
    rather than given a submission of their own: the assignment is one piece of work per team,
    and a team of one nobody meant to create is worse than being told to ask.
  */
  let team: ResolvedTeam | null = null;
  let teamSubmissionId: string | null = null;

  if (assignment.teamSetId) {
    team = await teamForStudent(db, {
      teamSetId: assignment.teamSetId,
      studentId: params.profileId,
    });

    if (!team) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This assignment is handed in by teams, and you have not been placed on one yet. " +
          "Ask your instructor to add you to a team.",
      });
    }

    const held = await teamSubmissionFor(db, { assignmentId: assignment.id, teamId: team.id });
    teamSubmissionId = held?.id ?? null;
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
  /*
    On a team assignment it asks about **the team's** drafts, not the caller's. Drafts hang off
    the one row holding the work, so a lock scoped to whoever is pressing the button would never
    fire for a team at all — and the failure it exists to prevent is exactly the one a team makes
    easiest: one member replacing the file while an instructor writes feedback about it.

    Before anybody has handed in there is no row and therefore no draft, which is why a null
    `teamSubmissionId` is not a special case.
  */
  const openDraft = await db.gradingDraft.findFirst({
    where: {
      submission: teamSubmissionId
        ? { id: teamSubmissionId }
        : { assignmentId: assignment.id, studentId: params.profileId },
      approvedAt: null,
      status: { in: ["GENERATING", "READY", "NEEDS_MANUAL_REVIEW"] },
    },
    select: { id: true },
  });

  if (openDraft) {
    throw new TRPCError({
      code: "CONFLICT",
      message: team
        ? `Your instructor is reviewing ${team.name}'s work now, so it cannot be changed. Wait ` +
          `for their feedback — your team can hand in revised work once it arrives.`
        : "Your instructor is reviewing this now, so it cannot be changed. Wait for their " +
          "feedback — you can hand in revised work once it arrives.",
    });
  }

  return {
    id: assignment.id,
    kind: assignment.kind,
    courseId: assignment.courseId,
    dueAt: assignment.dueAt,
    acceptedFileTypes: assignment.acceptedFileTypes,
    handInMethods: assignment.handInMethods,
    studentMayMarkDone: assignment.studentMayMarkDone,
    team,
    teamSubmissionId,
  };
}

/**
 * Removes the object a submission used to point at, once it has stopped pointing at it — unless
 * a grade describes it.
 *
 * **Two acts make an unreferenced object, and this clears up after both.** Uploading a second file
 * writes a *new* object rather than overwriting the first, because the path carries a generated
 * segment — so the moment `uploadPath` is rewritten, the previous object is unreachable. Handing
 * the same work in as a link instead does the same thing by nulling the column outright. Left
 * alone, both leak bytes into a private bucket that nothing can ever name again.
 *
 * **A submission that has been graded keeps every file it replaces, and that is the whole of the
 * rule.** Feedback is written *about* a file — a score, a paragraph naming what was on page two —
 * and a released grade whose subject has been deleted is a judgment nobody can check. So once
 * `gradedAt` is set, replaced objects stay: the cost is bytes in a bucket, and the cost of the
 * other choice is a fellow disputing a grade on work neither of them can open. Before a grade,
 * nothing describes the file, replacing it is a correction rather than a revision, and there is
 * nothing to keep it for.
 *
 * It reads `gradedAt` rather than the status, because the status moves on: a graded submission
 * handed in again reads `RESUBMITTED`, and asking about the status would start deleting the very
 * files a grade describes the moment a fellow revised. `gradedAt` is set once and stays set.
 *
 * **Best-effort, and deliberately so.** A bucket that refuses must not fail a student's hand-in
 * on the due date, and the worst outcome of giving up here is one unreferenced object — which is
 * exactly the state every replacement left behind before this existed. So it is logged rather
 * than thrown, which keeps the failure findable without making it the student's problem.
 *
 * **Called after the columns are written, never before.** A failure here leaves bytes nothing
 * points at, which is harmless; deleting first and then failing to write would leave a submission
 * pointing at bytes that no longer exist, which reads to an instructor as a corrupt file with
 * nothing on the screen explaining why.
 */
export async function discardReplacedUpload(previous: {
  /** The object the row pointed at before this hand-in, or null when there was none. */
  uploadPath: string | null;
  /**
   * When this submission was last graded, or null if it never has been.
   *
   * Taken as an argument rather than looked up, so the caller passes the row it already read —
   * and so this cannot be called without the fact that decides what it does.
   */
  gradedAt: Date | null;
}): Promise<void> {
  if (!previous.uploadPath) return;
  if (previous.gradedAt !== null) return;

  try {
    await removeSubmissionUpload(previous.uploadPath);
  } catch (err) {
    console.error(`Could not remove the replaced upload at ${previous.uploadPath}`, err);
  }
}

/**
 * The row a student's file belongs to, created if this is the first thing to happen to the work.
 *
 * For a team it is the team's one row rather than the caller's, which is what makes one member's
 * upload the team's hand-in. `NOT_STARTED` on the create branch either way: a self-directed
 * assignment has no Accept, so this row often exists only because the path is built from its id,
 * and a failure before anything is recorded must leave a row saying nothing happened — which is
 * true.
 *
 * Both halves of an upload resolve the row this way, and they have to agree: `beginUpload` builds
 * the path from the id and `recordUpload` refuses a path that is not under it, so a second way of
 * choosing the row would be a second answer to "whose file is this".
 */
async function rowHoldingWork(db: Db, params: { profileId: string; assignment: HandInAssignment }) {
  const select = {
    id: true,
    status: true,
    submittedAt: true,
    isLate: true,
    uploadPath: true,
    gradedAt: true,
  } as const;

  const team = params.assignment.team;

  if (team) {
    const { submissionId } = await claimTeamWork(db, {
      assignmentId: params.assignment.id,
      studentId: params.profileId,
      team,
      statusIfNew: "NOT_STARTED",
    });

    return db.submission.findUniqueOrThrow({ where: { id: submissionId }, select });
  }

  return db.submission.upsert({
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
      Nothing written, so what comes back is the row as it stands — which is what the hand-in rule
      needs, and the reason no second read is made for it. On the create branch it is the row just
      made: no submission time, never late, and not yet started.
    */
    update: {},
    select,
  });
}

/**
 * Permission for one upload, and the address to send it to.
 *
 * **Handing in a file is two requests, and this is the first.** The browser sends the bytes
 * straight to the bucket rather than through a function of ours, because a Vercel function may
 * not receive a request body over 4.5MB and a student's scan or photograph is regularly larger —
 * see `signedUploadUrl` for what the browser is trusted with, which is less than it sounds. This
 * half decides *whether* and *where*; `recordUpload` decides what actually arrived.
 *
 * The row is created before the URL is minted, because the path is built from the row's id. A
 * student who stops here — closes the tab, changes their mind — leaves a row that reads as not
 * started, which is true.
 *
 * **The size is checked here against what the browser reports, and again in `recordUpload`
 * against what the bucket actually holds.** Only the second is a guarantee, and only the first is
 * fast: it is the difference between being refused now and being refused after spending four
 * minutes uploading on a phone tether. The bucket enforces the same limit a third time, and that
 * is the one nothing can talk its way past.
 */
export async function beginUpload(
  db: Db,
  params: {
    profileId: string;
    assignment: HandInAssignment;
    filename: string;
    /** What the browser says the file is. A claim, checked properly once the bytes are there. */
    sizeBytes: number;
  },
): Promise<{ uploadUrl: string; path: string; contentType: string }> {
  const check = checkUpload({
    filename: params.filename,
    sizeBytes: params.sizeBytes,
    acceptedTypes: params.assignment.acceptedFileTypes,
  });

  if (!check.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
  }

  const submission = await rowHoldingWork(db, params);
  const path = submissionUploadPath({ submissionId: submission.id, extension: check.extension });
  const { url } = await signedUploadUrl({ path });

  /*
    The content type the extension implies, handed out for the browser to send back on the upload.

    It is decided here for the reason `contentTypeFor` gives — browsers disagree about the same
    file, and the bucket's allow-list is built from these entries — and the browser is a courier
    for it rather than an author of it. What stops the courier rewriting the label is the check in
    `recordUpload`, which compares the type the object was actually stored under against the one
    this extension means, and refuses the pair that do not match.
  */
  return { uploadUrl: url, path, contentType: check.contentType };
}

/**
 * Marks the submission handed in, once the bytes are in the bucket.
 *
 * **The second of the two requests, and the one that can be lost.** Between the browser's upload
 * finishing and this returning there is a window where the object exists and no row points at it;
 * a student whose connection drops inside it has bytes stored and a submission that still reads as
 * not started. That is the same failure the one-request version had between storing and recording,
 * lengthened from milliseconds to one round trip, and it is the price of the browser doing the
 * transfer. It is not silent — the student's screen still asks for a file, and uploading again
 * works — and `reconcile:uploads` is what clears up after it.
 *
 * The order is otherwise what it always was, and for the same reason: write the columns, then
 * discard what they used to point at. The reverse would leave a submission naming an object that
 * is gone, which reads to an instructor as a corrupt file with nothing on the screen explaining
 * why.
 *
 * **Nothing the browser says about the file is taken on trust.** The path must be under the row
 * this caller hands in on; the object must be there; its true size and content type are read from
 * storage and must be the ones this assignment's accepted extension implies. The filename is the
 * one exception and is meant to be — it is the student's name for their own work, kept because an
 * instructor downloads it — so it is required to end in the same extension as the object it
 * describes, and otherwise left alone.
 */
export async function recordUpload(
  db: Db,
  params: {
    profileId: string;
    assignment: HandInAssignment;
    /** Where the browser says it put the file — checked against where it was allowed to. */
    path: string;
    filename: string;
  },
) {
  const submission = await rowHoldingWork(db, params);

  /*
    The path is not a name the caller may choose. `beginUpload` built one under this row's id and
    signed a token for that exact object, so a path outside the folder is either a stale tab whose
    team has changed underneath it or somebody trying it on. Both are answered the same way: hand
    the file in again, which mints a path that is theirs.
  */
  if (!params.path.startsWith(`${submission.id}/`)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "That file does not belong to this submission. Upload it again.",
    });
  }

  const stored = await uploadedObjectInfo(params.path);

  if (!stored) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That file did not finish uploading. Try again.",
    });
  }

  /*
    Asked of the path rather than of the filename, because the path is what the bucket holds: its
    extension is the one `beginUpload` signed a token for, and it cannot have changed since. The
    size is the object's own. So this is the same question the browser was asked before the upload,
    put this time to the file that actually exists — and it is asked again at all because an
    instructor may have narrowed the accepted types while the upload was in flight.
  */
  const check = checkUpload({
    filename: params.path,
    sizeBytes: stored.sizeBytes,
    acceptedTypes: params.assignment.acceptedFileTypes,
  });

  if (!check.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
  }

  /*
    The two ways the browser could describe the object as something it is not, closed together.

    A filename ending in `.pdf` on a `.png` object would give the instructor a download named for a
    kind of file it is not. A content type outside what the extension means would be stored on the
    object and handed to the browser on the way back, which is what decides whether a file is
    displayed or offered as a download. The bucket refuses a type that is on no list at all; these
    refuse the ones that are on the list but not on this file's.
  */
  if (extensionOf(params.filename) !== check.extension) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That file was not stored as the kind of file you named. Upload it again.",
    });
  }

  if (stored.contentType !== check.contentType) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That file was not stored as the kind of file it is. Upload it again.",
    });
  }

  const now = new Date();

  /*
    Status, submission time, and lateness together, by the same rule the link form and the pull
    request webhook use: a file uploaded on top of a released grade is a revision, and it does
    not move the time the work was first handed in.
  */
  const state = handInState({ current: submission, dueAt: params.assignment.dueAt, now });

  /*
    Written through `recordHandIn`, which is what puts the state on every member's row and keeps
    the path on the one holding the file. **`uploadPath` is deliberately not copied**: the bytes
    are stored once, under this row's id, and re-uploading writes a *new* object rather than
    overwriting the one an instructor may be reading — so four copies of a path would be three
    members downloading a superseded file with nothing saying so. Every member's own page reads
    the path through the relation instead. What they do carry is the filename and the size, which
    is what their own screen shows.
  */
  await recordHandIn(db, {
    submissionId: submission.id,
    handIn: {
      state,
      // When the work last moved, which is what orders the instructor's queue. The submission
      // time inside `state` is the first hand-in and does not answer that.
      lastActivityAt: now,
      handedInById: params.profileId,
      /*
        `submittedUrl` nulled alongside the new path, because an assignment may accept both ways
        in and a row holding a link *and* a file is a row with two answers to one question. The
        review screen resolves that pair by preferring the file, so the link would not be shown
        and would not be gone either — a stale address sitting under a grade that ignored it.
        Whichever way the work came in last is the way it came in.
      */
      location: { uploadPath: params.path, submittedUrl: null },
      describe: {
        uploadFilename: params.filename,
        uploadSizeBytes: stored.sizeBytes,
        uploadContentType: check.contentType,
      },
    },
  });

  if (params.assignment.team) {
    await syncTeamRows(db, { submissionId: submission.id });
  }

  /*
    The object the row pointed at a moment ago, now that it points at this one instead — kept
    rather than removed once this submission has a grade, because that grade was written about it.
  */
  await discardReplacedUpload(submission);

  /*
    The caller's own row, which is what their screen re-renders from. On a team assignment that is
    a mirror of the row just written, carrying the same status and the same filename.
  */
  return db.submission.findUniqueOrThrow({
    where: {
      assignmentId_studentId: {
        assignmentId: params.assignment.id,
        studentId: params.profileId,
      },
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
