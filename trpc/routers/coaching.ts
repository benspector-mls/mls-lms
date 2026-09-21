import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { auditActor, recordEvent, type AuditReference } from "@/lib/audit/record";
import {
  ALL_PROMPTS,
  DEVELOPMENT_MARKERS,
  SNAPSHOT_VERSION,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  sessionAnswersSchema,
} from "@/lib/coaching";
import { assembleSnapshot } from "@/lib/coaching/snapshot";
import { assertActiveInProgram, assertProgramMember } from "@/lib/courses/membership";
import { inTransaction } from "@/lib/prisma";
import {
  MAX_SUBMISSION_ARTIFACTS,
  UPLOAD_FILE_TYPE_KEYS,
  checkUpload,
} from "@/lib/uploads/file-types";
import {
  removeSubmissionUploads,
  signedDownloadUrl,
  signedUploadUrl,
  uploadPath,
} from "@/lib/uploads/storage";
import { verifyStoredUpload } from "@/lib/uploads/submit";

import { createTRPCRouter, profileProcedure, programProcedure } from "../init";
import { displayNameOf, personNameSelect, personSelect } from "../selects";

/**
 * Coaching records: instructor notes, coaching sessions, and the fellow's goals and updates.
 *
 * **Two ownerships, opposite ways round, and every guard on the file follows from which.** A note,
 * a session's answers and the temperature score are the instructor's and staff-only forever: they
 * are read by `programProcedure`-guarded procedures and by nothing else, so the fields do not
 * exist in any fellow-facing payload type. A **goal is the fellow's** — they write it, edit it,
 * say where they stand on it and delete it — so every procedure that touches one is guarded by
 * `assertActiveInProgram`, which refuses instructors as firmly as it refuses strangers. The
 * same is true of the **updates** beneath a goal — progress notes with files attached — which the
 * fellow writes and an instructor reads on the record and in the session form. An
 * instructor who thinks a fellow has placed themselves wrongly says so in the session; there is no
 * procedure here for writing it down.
 *
 * What the fellow reads — `myGoals` — is their own goals and completed sessions' snapshots, and
 * its input names only the program: there is no argument that could name somebody else, the
 * `gcf.mine` shape.
 *
 * **Every row-level `where` names `programId` beside the id.** `programProcedure` proves the
 * caller instructs the program in the input; the second column is what makes an id stolen from
 * another program find nothing rather than something.
 *
 * **The audit log records acts, never words.** Writing about a fellow they cannot see is exactly
 * the act that wants a record of who and when — and `audit_events` is append-only, so an event
 * carrying a body would be a permanent copy of the one text somebody must be able to delete.
 *
 * The agreed text on a goal is copied server-side: the client sends an `entryId`, and this router
 * resolves it against the competency list — restricted to the entries this fellow's discipline is
 * offered — and copies the entry's text, kind, and competency name onto the row. The client never
 * supplies the words shown on the goal, and never reaches another fellowship's section.
 */

type Ctx = Parameters<Parameters<typeof programProcedure.mutation>[0]>[0]["ctx"];
type FellowCtx = Parameters<Parameters<typeof profileProcedure.mutation>[0]>[0]["ctx"];

const prompts = new Map<string, string>(ALL_PROMPTS.map((entry) => [entry.id, entry.prompt]));

const temperatureInput = z.number().int().min(TEMPERATURE_MIN).max(TEMPERATURE_MAX).nullable();
const markerInput = z.enum(DEVELOPMENT_MARKERS).nullable();

/**
 * A fellow acting on their own goals: signed in, and naming the program the goal sits in.
 *
 * The input is shared rather than the check — `assertActiveInProgram` needs the program id and
 * returns the enrollment, so each procedure calls it on its first line and uses what comes back.
 * Built on `profileProcedure` rather than `studentProcedure` because what matters is being an
 * active fellow *of this program*, which the role alone does not say.
 */
const fellowGoalProcedure = profileProcedure.input(z.object({ programId: z.string().uuid() }));
const proseInput = z.string().max(10_000);
/** Words are required here and nowhere in the database — see `Goal.title` for why the column defaults. */
const goalTitle = z.string().trim().min(1, "Give the goal a name.").max(200);
/** May be empty: an update can be a screenshot alone. The migration's CHECK holds the same cap. */
const updateBody = z.string().max(20_000);
const attachmentDisposition = z.enum(["attachment", "inline"]);

/** A goal written without a competency: the four copy columns, cleared together. */
const NO_COMPETENCY = {
  entryId: null,
  entryKind: null,
  entryText: null,
  competencyName: null,
} as const;
const noteBody = z.string().trim().min(1, "A note needs words in it.").max(50_000);

/** What every enrollment-scoped act needs: the key, and the names the audit log writes. */
const enrollmentSelect = {
  id: true,
  programId: true,
  studentId: true,
  createdAt: true,
  student: { select: personSelect },
  program: { select: { id: true, name: true } },
} as const;

type LoadedEnrollment = {
  id: string;
  programId: string;
  studentId: string;
  createdAt: Date;
  student: {
    id: string;
    displayName: string | null;
    email: string | null;
    githubUsername: string | null;
  };
  program: { id: string; name: string };
};

/** The fellow this row is about, for `recordEvent`'s subject. */
function fellowRef(enrollment: LoadedEnrollment): AuditReference {
  return { id: enrollment.studentId, label: displayNameOf(enrollment.student, "a fellow") };
}

function programRef(enrollment: LoadedEnrollment): AuditReference {
  return { id: enrollment.program.id, label: enrollment.program.name };
}

/**
 * The check `programProcedure` cannot make: `studentId` is a separate argument naming any profile
 * in the deployment, so the enrollment lookup pairs it with the proven program.
 */
async function enrollmentOf(ctx: Ctx, programId: string, studentId: string) {
  const enrollment = await ctx.db.enrollment.findUnique({
    where: { programId_studentId: { programId, studentId } },
    select: enrollmentSelect,
  });

  if (!enrollment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That person is not on this program's roster.",
    });
  }

  return enrollment;
}

/** A session by id **and program**, so a stolen id finds nothing. */
async function sessionOf(ctx: Ctx, programId: string, sessionId: string) {
  const session = await ctx.db.coachingSession.findFirst({
    where: { id: sessionId, programId },
    select: {
      id: true,
      temperature: true,
      answers: true,
      endedAt: true,
      snapshot: true,
      createdAt: true,
      enrollment: { select: enrollmentSelect },
    },
  });

  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such coaching session here." });
  }

  return session;
}

/** Refuses writing into a session that has been completed. */
function assertDraft(session: { endedAt: Date | null }) {
  if (session.endedAt !== null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This session is completed. What was recorded stays as it was recorded.",
    });
  }
}

/** What every reader of an attachment sees. Never `uploadPath`: the bucket's address stays server-side. */
const attachmentSelect = {
  id: true,
  uploadFilename: true,
  uploadSizeBytes: true,
  uploadContentType: true,
  createdAt: true,
} as const;

const updateSelect = {
  id: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  attachments: { orderBy: { createdAt: "asc" }, select: attachmentSelect },
} as const;

const goalSelect = {
  id: true,
  title: true,
  entryId: true,
  entryKind: true,
  entryText: true,
  competencyName: true,
  successCriteria: true,
  objectives: true,
  actionPlan: true,
  marker: true,
  createdAt: true,
  updatedAt: true,
  /*
    Every update rides along with its goal, newest first. One read answers both screens, and a
    fellow's goals are few enough that nothing here wants paging.
  */
  updates: { orderBy: { createdAt: "desc" }, select: updateSelect },
} as const;

/**
 * Refuses a goal that is not this enrollment's — not found rather than forbidden, because to
 * anybody but its owner a goal id names nothing, and saying "that is somebody else's" would
 * confirm it exists.
 */
async function assertOwnGoal(ctx: FellowCtx, enrollmentId: string, goalId: string) {
  const goal = await ctx.db.goal.findFirst({
    where: { id: goalId, enrollmentId },
    select: { id: true },
  });

  if (!goal) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such goal of yours." });
  }
}

/** The same refusal for an update: to anybody but its owner, the id names nothing. */
async function assertOwnUpdate(ctx: FellowCtx, enrollmentId: string, updateId: string) {
  const update = await ctx.db.goalUpdate.findFirst({
    where: { id: updateId, goal: { enrollmentId } },
    select: { id: true },
  });

  if (!update) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such update of yours." });
  }
}

/**
 * Refuses an eleventh file. Asked before the address is minted and again before the row is
 * written, for the reason `assertRoomForArtifact` asks twice of a submission.
 */
async function assertRoomForAttachment(ctx: FellowCtx, updateId: string) {
  const held = await ctx.db.goalUpdateAttachment.count({ where: { updateId } });

  if (held >= MAX_SUBMISSION_ARTIFACTS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `This update already holds ${MAX_SUBMISSION_ARTIFACTS} files, which is the most it can. ` +
        `Remove one to add another.`,
    });
  }
}

/**
 * The stored objects behind rows that have just been deleted, removed best-effort.
 *
 * After the rows and never thrown, the rule every deletion path here follows: the database is the
 * authoritative act, a bucket that refuses must not leave it half done, and `reconcile:uploads`
 * removes after a day whatever this could not. The paths that would not go are logged, which is
 * the only way anybody could find them.
 */
async function discardStoredObjects(paths: string[]) {
  if (paths.length === 0) return;
  const { leftBehind } = await removeSubmissionUploads(paths);
  if (leftBehind.length > 0) {
    console.error(`Could not remove ${leftBehind.length} goal update attachment(s):`, leftBehind);
  }
}

/**
 * The chosen entry's copies, read from the list rather than taken from the request.
 *
 * **The entry has to be one this fellow is actually offered**, which is why the program comes in
 * beside the id: the list is application-wide, so an id from the other fellowship's section names
 * a real row, and only the competency's `disciplines` says whether it belongs on this goal. The
 * picker never shows those entries; this is what makes the payload agree with the screen.
 */
async function copiesOf(ctx: FellowCtx, programId: string, entryId: string) {
  const program = await ctx.db.program.findUnique({
    where: { id: programId },
    select: { discipline: true },
  });

  const entry =
    program === null
      ? null
      : await ctx.db.competencyEntry.findFirst({
          where: {
            id: entryId,
            competency: { disciplines: { has: program.discipline } },
          },
          select: { id: true, kind: true, text: true, competency: { select: { name: true } } },
        });

  if (!entry) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That competency entry is not one of the ones you can choose from.",
    });
  }

  return {
    entryId: entry.id,
    entryKind: entry.kind,
    entryText: entry.text,
    competencyName: entry.competency.name,
  };
}

export const coachingRouter = createTRPCRouter({
  /**
   * Everything the record page's coaching sections show for one fellow: the instructor's own
   * notes and sessions, and the fellow's goals — read here and written nowhere on this side.
   */
  forStudent: programProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const enrollment = await enrollmentOf(ctx, input.programId, input.studentId);

      const [notes, sessions, goals] = await Promise.all([
        ctx.db.instructorNote.findMany({
          where: { enrollmentId: enrollment.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            body: true,
            createdAt: true,
            updatedAt: true,
            author: { select: personNameSelect },
          },
        }),
        ctx.db.coachingSession.findMany({
          where: { enrollmentId: enrollment.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            endedAt: true,
            author: { select: personNameSelect },
          },
        }),
        ctx.db.goal.findMany({
          where: { enrollmentId: enrollment.id },
          orderBy: { createdAt: "desc" },
          select: goalSelect,
        }),
      ]);

      return { student: enrollment.student, notes, sessions, goals };
    }),

  /**
   * One session in full — answers, temperature, goals — plus the live figures the form's strip
   * shows as "what will be recorded". For a completed session the strip renders the stored
   * `snapshot` instead; the live figures ride along regardless, because the strip is the one
   * place an instructor sees the two side by side before deciding to complete.
   */
  session: programProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await sessionOf(ctx, input.programId, input.sessionId);

      const [goals, figures] = await Promise.all([
        /*
          The fellow's goals as they stand, for the instructor to talk through. Read-only here and
          everywhere on this side: the form shows them so a session can be spent guiding somebody
          to set or move one, which they do on their own screen.
        */
        ctx.db.goal.findMany({
          where: { enrollmentId: session.enrollment.id },
          orderBy: { createdAt: "desc" },
          select: goalSelect,
        }),
        assembleSnapshot(ctx.db, session.enrollment, new Date()),
      ]);

      const answers = sessionAnswersSchema.safeParse(session.answers);

      return {
        id: session.id,
        student: session.enrollment.student,
        temperature: session.temperature,
        answers: answers.success ? answers.data : [],
        endedAt: session.endedAt,
        snapshot: session.snapshot,
        createdAt: session.createdAt,
        goals,
        figures,
      };
    }),

  /** A new draft. No audit — a draft is staff-only scratch until completing releases it. */
  startSession: programProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const enrollment = await enrollmentOf(ctx, input.programId, input.studentId);

      return ctx.db.coachingSession.create({
        data: {
          enrollmentId: enrollment.id,
          programId: enrollment.programId,
          authorId: ctx.profile.id,
        },
        select: { id: true },
      });
    }),

  /**
   * The autosave target. The server re-derives each prompt's text from the template by id — an
   * unknown id is refused — so the stored copy is always the canonical wording at save time.
   */
  saveSession: programProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        temperature: temperatureInput,
        answers: z.array(z.object({ promptId: z.string(), answer: z.string().max(20_000) })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await sessionOf(ctx, input.programId, input.sessionId);
      assertDraft(session);

      const answers = input.answers.map((answer) => {
        const prompt = prompts.get(answer.promptId);
        if (!prompt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That prompt is not part of the coaching template.",
          });
        }
        return { promptId: answer.promptId, prompt, answer: answer.answer };
      });

      await ctx.db.coachingSession.update({
        where: { id: session.id },
        data: { temperature: input.temperature, answers },
        select: { id: true },
      });
    }),

  /**
   * The only writer of `endedAt` and `snapshot`, in one transaction with the audit event so the
   * record and the fact of it commit together or not at all.
   *
   * It releases nothing: the fellow's goals were theirs and visible from the moment they wrote
   * them, and what completing shares is the snapshot — where they stood when the conversation
   * ended.
   */
  completeSession: programProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await sessionOf(ctx, input.programId, input.sessionId);
      assertDraft(session);

      const now = new Date();

      return inTransaction(ctx.db, async (tx) => {
        const snapshot = await assembleSnapshot(tx, session.enrollment, now);

        await tx.coachingSession.update({
          where: { id: session.id },
          data: { endedAt: now, snapshot },
          select: { id: true },
        });

        await recordEvent(tx, {
          action: "COACHING_SESSION_COMPLETED",
          actor: auditActor(ctx),
          subject: fellowRef(session.enrollment),
          program: programRef(session.enrollment),
          detail: { sessionId: session.id, snapshotVersion: SNAPSHOT_VERSION },
        });

        return { id: session.id, endedAt: now };
      });
    }),

  /**
   * Deleting a *completed* session deletes a snapshot the fellow has seen, which is why the event
   * says whether it was one. The fellow's goals are untouched by it: they never belonged to a
   * session.
   */
  deleteSession: programProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await sessionOf(ctx, input.programId, input.sessionId);

      await inTransaction(ctx.db, async (tx) => {
        await tx.coachingSession.delete({ where: { id: session.id }, select: { id: true } });
        await recordEvent(tx, {
          action: "COACHING_SESSION_DELETED",
          actor: auditActor(ctx),
          subject: fellowRef(session.enrollment),
          program: programRef(session.enrollment),
          detail: { sessionId: session.id, wasCompleted: session.endedAt !== null },
        });
      });
    }),

  /**
   * A goal the fellow sets for themselves.
   *
   * **`assertActiveInProgram`, which is the whole of the ownership rule.** It admits an active
   * fellow of the program and nobody else — not a stranger, not an instructor of it, not the
   * fellow after they have been removed — so there is no argument and no role that could write a
   * goal onto somebody else's record.
   *
   * The agreed wording is copied server-side out of the competency list: the client sends an
   * `entryId` and the server copies the text, the kind and the competency's name onto the row,
   * because an admin rewording an entry must not rewrite what somebody set out to work on.
   */
  setGoal: fellowGoalProcedure
    .input(
      z.object({
        title: goalTitle,
        /** The competency this is about, or null for a goal written without one. */
        entryId: z.string().uuid().nullable(),
        successCriteria: proseInput,
        objectives: proseInput,
        actionPlan: proseInput,
        marker: markerInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);

      return ctx.db.goal.create({
        data: {
          enrollmentId,
          programId: input.programId,
          title: input.title,
          ...(input.entryId === null
            ? NO_COMPETENCY
            : await copiesOf(ctx, input.programId, input.entryId)),
          successCriteria: input.successCriteria,
          objectives: input.objectives,
          actionPlan: input.actionPlan,
          marker: input.marker,
        },
        select: goalSelect,
      });
    }),

  /**
   * The fellow rewriting their own goal, including where they say they stand on it.
   *
   * Nothing is frozen and nothing is audited. A goal is a thing being worked on rather than a
   * contract, and a fellow keeping their own record is not an act somebody is held to — the log
   * here is for what instructors write about people who cannot see it.
   *
   * The `where` names the caller's own enrollment beside the id, so another fellow's goal is not
   * refused but simply not found, which is the same answer a made-up id gets.
   */
  updateGoal: fellowGoalProcedure
    .input(
      z.object({
        goalId: z.string().uuid(),
        title: goalTitle.optional(),
        /** Absent leaves the competency alone; null clears it; an id re-copies. */
        entryId: z.string().uuid().nullable().optional(),
        successCriteria: proseInput.optional(),
        objectives: proseInput.optional(),
        actionPlan: proseInput.optional(),
        marker: markerInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);
      await assertOwnGoal(ctx, enrollmentId, input.goalId);

      return ctx.db.goal.update({
        where: { id: input.goalId },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.entryId === undefined
            ? {}
            : input.entryId === null
              ? NO_COMPETENCY
              : await copiesOf(ctx, input.programId, input.entryId)),
          ...(input.successCriteria === undefined
            ? {}
            : { successCriteria: input.successCriteria }),
          ...(input.objectives === undefined ? {} : { objectives: input.objectives }),
          ...(input.actionPlan === undefined ? {} : { actionPlan: input.actionPlan }),
          ...(input.marker === undefined ? {} : { marker: input.marker }),
        },
        select: goalSelect,
      });
    }),

  /**
   * The fellow dropping one of their own. Theirs to set, theirs to drop.
   *
   * The files attached to its updates go too — harvested before the delete, because once the rows
   * cascade there is nothing left that knows where the objects are, and removed after it.
   */
  deleteGoal: fellowGoalProcedure
    .input(z.object({ goalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);
      await assertOwnGoal(ctx, enrollmentId, input.goalId);

      const attachments = await ctx.db.goalUpdateAttachment.findMany({
        where: { update: { goalId: input.goalId } },
        select: { uploadPath: true },
      });

      await ctx.db.goal.delete({ where: { id: input.goalId }, select: { id: true } });

      await discardStoredObjects(attachments.map((row) => row.uploadPath));
    }),

  /*
    ---- Updates: the fellow's progress notes under a goal -------------------------------------

    The same ownership as the goal, and the same refusals: `assertActiveInProgram` first, then
    the row must be theirs or it is not found. Nothing here is audited, for the reason nothing a
    fellow does to their own goals is.
  */

  /** A new note under one of their goals. May be words, files, or both; the files come next. */
  addUpdate: fellowGoalProcedure
    .input(z.object({ goalId: z.string().uuid(), body: updateBody }))
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);
      await assertOwnGoal(ctx, enrollmentId, input.goalId);

      return ctx.db.goalUpdate.create({
        data: { goalId: input.goalId, body: input.body },
        select: updateSelect,
      });
    }),

  /** Rewriting the words of one. The files are added and removed by their own procedures. */
  editUpdate: fellowGoalProcedure
    .input(z.object({ updateId: z.string().uuid(), body: updateBody }))
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);
      await assertOwnUpdate(ctx, enrollmentId, input.updateId);

      return ctx.db.goalUpdate.update({
        where: { id: input.updateId },
        data: { body: input.body },
        select: updateSelect,
      });
    }),

  /** Dropping one, files and all — harvested first, removed after, like a goal. */
  deleteUpdate: fellowGoalProcedure
    .input(z.object({ updateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);
      await assertOwnUpdate(ctx, enrollmentId, input.updateId);

      const attachments = await ctx.db.goalUpdateAttachment.findMany({
        where: { updateId: input.updateId },
        select: { uploadPath: true },
      });

      await ctx.db.goalUpdate.delete({ where: { id: input.updateId }, select: { id: true } });

      await discardStoredObjects(attachments.map((row) => row.uploadPath));
    }),

  /**
   * The first of the two calls that attach a file: permission, and an address in the bucket.
   *
   * The shape of `submissions.beginUpload`, and the same reasons: the bytes never come through
   * this application, so the browser is handed a signed address for one object and PUTs there
   * itself, and `recordUpdateUpload` believes nothing it says afterwards. The accepted types are
   * the bucket's own allow-list — every type it stores — because narrowing it for evidence of a
   * goal is a decision nobody has made.
   */
  beginUpdateUpload: fellowGoalProcedure
    .input(
      z.object({
        updateId: z.string().uuid(),
        filename: z.string().min(1).max(255),
        /** What the browser says the file is. A claim, checked properly once the bytes are there. */
        sizeBytes: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);
      await assertOwnUpdate(ctx, enrollmentId, input.updateId);

      const check = checkUpload({
        filename: input.filename,
        sizeBytes: input.sizeBytes,
        acceptedTypes: UPLOAD_FILE_TYPE_KEYS,
      });

      if (!check.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
      }

      await assertRoomForAttachment(ctx, input.updateId);

      const path = uploadPath({ folder: input.updateId, extension: check.extension });
      const { url } = await signedUploadUrl({ path });

      return { uploadUrl: url, path, contentType: check.contentType };
    }),

  /**
   * The second call: the row, once the bytes are in the bucket.
   *
   * The path must be under this update's own folder — `beginUpdateUpload` signed a token for
   * exactly that object — and `verifyStoredUpload` reads the object's real size and type from
   * storage rather than from the request. Between the browser's PUT and this call there is a
   * window where an object exists and no row names it; `reconcile:uploads` clears up after it,
   * which is why it knows this table.
   */
  recordUpdateUpload: fellowGoalProcedure
    .input(
      z.object({
        updateId: z.string().uuid(),
        path: z.string().min(1).max(300),
        filename: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);
      await assertOwnUpdate(ctx, enrollmentId, input.updateId);

      if (!input.path.startsWith(`${input.updateId}/`)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That file does not belong to this update. Attach it again.",
        });
      }

      const stored = await verifyStoredUpload({
        path: input.path,
        filename: input.filename,
        acceptedTypes: UPLOAD_FILE_TYPE_KEYS,
      });

      await assertRoomForAttachment(ctx, input.updateId);

      return ctx.db.goalUpdateAttachment.create({
        data: {
          updateId: input.updateId,
          uploadPath: input.path,
          uploadFilename: input.filename,
          uploadSizeBytes: stored.sizeBytes,
          uploadContentType: stored.contentType,
        },
        select: attachmentSelect,
      });
    }),

  /** Taking one file off an update. Row first, object after, best effort. */
  deleteUpdateAttachment: fellowGoalProcedure
    .input(z.object({ attachmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);

      const attachment = await ctx.db.goalUpdateAttachment.findFirst({
        where: { id: input.attachmentId, update: { goal: { enrollmentId } } },
        select: { id: true, uploadPath: true },
      });

      if (!attachment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such file of yours." });
      }

      await ctx.db.goalUpdateAttachment.delete({ where: { id: attachment.id } });

      await discardStoredObjects([attachment.uploadPath]);
    }),

  /**
   * A link to one attached file, for the two kinds of reader an update has.
   *
   * **The bucket is private, so this procedure is the whole of who may open a file.** A fellow
   * may open their own; an instructor or admin of the program may open any fellow's — the same
   * two readers `forStudent` and `myGoals` already serve. `assertProgramMember` rather than
   * `assertActiveInProgram`, so a fellow who has left the program can still open the evidence on
   * their own goals, as they can still read the goals.
   *
   * A mutation, like `submissions.uploadUrl`: minting a signed link is an act with an expiry,
   * not a fact to be cached.
   */
  updateAttachmentUrl: profileProcedure
    .input(
      z.object({
        programId: z.string().uuid(),
        attachmentId: z.string().uuid(),
        disposition: attachmentDisposition,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const attachment = await ctx.db.goalUpdateAttachment.findFirst({
        where: { id: input.attachmentId, update: { goal: { programId: input.programId } } },
        select: {
          uploadPath: true,
          uploadFilename: true,
          update: { select: { goal: { select: { enrollment: { select: { studentId: true } } } } } },
        },
      });

      if (!attachment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such file." });
      }

      const membership = await assertProgramMember(ctx, input.programId);
      if (
        membership.as === "student" &&
        attachment.update.goal.enrollment.studentId !== ctx.profile.id
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such file." });
      }

      return {
        url: await signedDownloadUrl({
          path: attachment.uploadPath,
          filename: attachment.uploadFilename,
          disposition: input.disposition,
        }),
      };
    }),

  addNote: programProcedure
    .input(z.object({ studentId: z.string().uuid(), body: noteBody }))
    .mutation(async ({ ctx, input }) => {
      const enrollment = await enrollmentOf(ctx, input.programId, input.studentId);

      return inTransaction(ctx.db, async (tx) => {
        const note = await tx.instructorNote.create({
          data: {
            enrollmentId: enrollment.id,
            programId: enrollment.programId,
            body: input.body,
            authorId: ctx.profile.id,
          },
          select: { id: true },
        });

        await recordEvent(tx, {
          action: "COACHING_NOTE_CREATED",
          actor: auditActor(ctx),
          subject: fellowRef(enrollment),
          program: programRef(enrollment),
          detail: { noteId: note.id },
        });

        return note;
      });
    }),

  updateNote: programProcedure
    .input(z.object({ noteId: z.string().uuid(), body: noteBody }))
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.db.instructorNote.findFirst({
        where: { id: input.noteId, programId: input.programId },
        select: { id: true, enrollment: { select: enrollmentSelect } },
      });
      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such note here." });
      }

      await inTransaction(ctx.db, async (tx) => {
        await tx.instructorNote.update({
          where: { id: note.id },
          data: { body: input.body },
          select: { id: true },
        });
        await recordEvent(tx, {
          action: "COACHING_NOTE_UPDATED",
          actor: auditActor(ctx),
          subject: fellowRef(note.enrollment),
          program: programRef(note.enrollment),
          detail: { noteId: note.id },
        });
      });
    }),

  deleteNote: programProcedure
    .input(z.object({ noteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.db.instructorNote.findFirst({
        where: { id: input.noteId, programId: input.programId },
        select: { id: true, enrollment: { select: enrollmentSelect } },
      });
      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such note here." });
      }

      await inTransaction(ctx.db, async (tx) => {
        await tx.instructorNote.delete({ where: { id: note.id }, select: { id: true } });
        await recordEvent(tx, {
          action: "COACHING_NOTE_DELETED",
          actor: auditActor(ctx),
          subject: fellowRef(note.enrollment),
          program: programRef(note.enrollment),
          detail: { noteId: note.id },
        });
      });
    }),

  /**
   * The fellow's half, and the whole of it. Takes no student id — there is no argument that could
   * name somebody else — and selects nothing staff-only: their own goals, and completed sessions
   * as `{id, endedAt, snapshot}`.
   *
   * **Every goal of theirs, with nothing filtered out**, because a goal is theirs from the moment
   * they write it and there is no state in which one exists but is not for them to see.
   *
   * `assertProgramMember` rather than the active check the writes use, so a removed fellow keeps
   * reading their own goals and the record of their conversations — the rule their feedback and
   * their attendance already follow — while `setGoal` and its siblings refuse them.
   */
  myGoals: profileProcedure
    .input(z.object({ programId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertProgramMember(ctx, input.programId);

      const [program, goals, sessions] = await Promise.all([
        ctx.db.program.findUniqueOrThrow({
          where: { id: input.programId },
          select: { id: true, name: true, term: true },
        }),
        ctx.db.goal.findMany({
          where: { programId: input.programId, enrollment: { studentId: ctx.profile.id } },
          orderBy: { createdAt: "desc" },
          select: goalSelect,
        }),
        ctx.db.coachingSession.findMany({
          where: {
            programId: input.programId,
            enrollment: { studentId: ctx.profile.id },
            endedAt: { not: null },
          },
          orderBy: { endedAt: "desc" },
          select: { id: true, endedAt: true, snapshot: true },
        }),
      ]);

      return { program, goals, sessions };
    }),
});
