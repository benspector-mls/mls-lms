import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { auditActor, recordEvent, type AuditReference } from "@/lib/audit/record";
import {
  CHECK_IN_PROMPTS,
  DEVELOPMENT_MARKERS,
  SNAPSHOT_VERSION,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  sessionAnswersSchema,
} from "@/lib/coaching";
import { assembleSnapshot } from "@/lib/coaching/snapshot";
import { entryById } from "@/lib/competencies";
import { assertActiveInProgram, assertProgramMember } from "@/lib/courses/membership";
import { inTransaction } from "@/lib/prisma";

import { createTRPCRouter, profileProcedure, programProcedure } from "../init";
import { displayNameOf, personNameSelect, personSelect } from "../selects";

/**
 * Coaching records: instructor notes, coaching sessions, and the goals they release.
 *
 * **Two ownerships, opposite ways round, and every guard on the file follows from which.** A note,
 * a session's answers and the temperature score are the instructor's and staff-only forever: they
 * are read by `programProcedure`-guarded procedures and by nothing else, so the fields do not
 * exist in any fellow-facing payload type. A **goal is the fellow's** — they write it, edit it,
 * say where they stand on it and delete it — so every procedure that touches one is guarded by
 * `assertActiveInProgram`, which refuses instructors as firmly as it refuses strangers. An
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
 * resolves it in `lib/competencies.ts` and copies the entry's text, kind, and competency name onto
 * the row. The client never supplies the words that will be shown to the fellow as agreed.
 */

type Ctx = Parameters<Parameters<typeof programProcedure.mutation>[0]>[0]["ctx"];
type FellowCtx = Parameters<Parameters<typeof profileProcedure.mutation>[0]>[0]["ctx"];

const prompts = new Map<string, string>(CHECK_IN_PROMPTS.map((entry) => [entry.id, entry.prompt]));

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

const goalSelect = {
  id: true,
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

/** The chosen entry's copies, resolved server-side — see the router header. */
function copiesOf(entryId: string) {
  const entry = entryById(entryId);
  if (!entry) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That competency entry is not in the list.",
    });
  }

  return {
    entryId: entry.entryId,
    entryKind: entry.kind,
    entryText: entry.text,
    competencyName: entry.competencyName,
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
   * The agreed wording is copied server-side out of `lib/competencies.ts`, exactly as it was when
   * an instructor was the one writing: the client sends an `entryId` and the server copies the
   * text, the kind and the competency's name onto the row, because the list is still being
   * developed and a rewording must not rewrite what somebody set out to work on.
   */
  setGoal: fellowGoalProcedure
    .input(
      z.object({
        entryId: z.string(),
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
          ...copiesOf(input.entryId),
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
        entryId: z.string().optional(),
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
          ...(input.entryId === undefined ? {} : copiesOf(input.entryId)),
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

  /** The fellow dropping one of their own. Theirs to set, theirs to drop. */
  deleteGoal: fellowGoalProcedure
    .input(z.object({ goalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const enrollmentId = await assertActiveInProgram(ctx, input.programId);
      await assertOwnGoal(ctx, enrollmentId, input.goalId);

      await ctx.db.goal.delete({ where: { id: input.goalId }, select: { id: true } });
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
