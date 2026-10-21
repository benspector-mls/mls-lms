import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertWithinRate, COACHING_SUMMARY_LIMIT } from "@/lib/audit/rate-limit";
import { auditActor, recordEvent, type AuditReference } from "@/lib/audit/record";
import {
  SUMMARY_FOCUS_MAX_LENGTH,
  SUMMARY_INPUTS,
  parseSummaryThemes,
  themeEditSchema,
} from "@/lib/coaching";
import { CoachingSummaryError, generateCoachingSummary, themesOf } from "@/lib/coaching/summary";
import { assembleSummaryInputs, parseCoveredThrough } from "@/lib/coaching/summary-inputs";
import { inTransaction } from "@/lib/prisma";

import { createTRPCRouter, programProcedure } from "../init";
import { displayNameOf, personNameSelect, personSelect } from "../selects";

/**
 * Themes on a fellow's record: Claude's reading of the parts of the record a coach
 * chooses, written for that coach before a conversation. See `lib/coaching/summary.ts`.
 *
 * **Staff-only, by the coaching router's rule.** Every procedure is `programProcedure`, and every
 * row-level `where` names `programId` beside the id, so an id stolen from another program finds
 * nothing. Nothing a fellow can call selects this table.
 *
 * **The newest row is the current summary**, and the only one the coach may change. A summary is a
 * list of themes, and the coach edits or removes them one at a time. The next generation reads the
 * themes as the coach left them, so a correction carries forward; an older row is history, read by
 * nobody but the coach looking back.
 *
 * **The audit log records acts, never words**, as the notes do: who generated, edited or deleted a
 * summary of whom, and when, with the inputs and counts, but no text.
 */

type Ctx = Parameters<Parameters<typeof programProcedure.mutation>[0]>[0]["ctx"];

const enrollmentSelect = {
  id: true,
  programId: true,
  studentId: true,
  createdAt: true,
  student: { select: personSelect },
  program: { select: { id: true, name: true } },
} as const;

/**
 * The fellow named by `studentId` in the program `programProcedure` proved — the pairing that check
 * cannot make on its own, as `enrollmentOf` in the coaching router does it.
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

type LoadedEnrollment = Awaited<ReturnType<typeof enrollmentOf>>;

function fellowRef(enrollment: LoadedEnrollment): AuditReference {
  return { id: enrollment.studentId, label: displayNameOf(enrollment.student, "a fellow") };
}

function programRef(enrollment: LoadedEnrollment): AuditReference {
  return { id: enrollment.program.id, label: enrollment.program.name };
}

/**
 * A summary by id **and program**, refused unless it is its fellow's newest, with the theme at
 * `index` — the rules both kinds of edit share.
 *
 * By position, which two coaches changing themes on the same summary at once could each read
 * differently. For a staff-only draft that both can see the result of, that is acceptable.
 */
async function currentTheme(ctx: Ctx, programId: string, summaryId: string, index: number) {
  const summary = await ctx.db.coachingSummary.findFirst({
    where: { id: summaryId, programId },
    select: {
      id: true,
      enrollmentId: true,
      themes: true,
      enrollment: { select: enrollmentSelect },
    },
  });
  if (!summary) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such summary here." });
  }

  const newest = await ctx.db.coachingSummary.findFirst({
    where: { enrollmentId: summary.enrollmentId, programId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (newest?.id !== summary.id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only the current summary can be edited.",
    });
  }

  const themes = parseSummaryThemes(summary.themes);
  if (index >= themes.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That theme has already been removed.",
    });
  }

  return { ...summary, themes };
}

export const coachingSummariesRouter = createTRPCRouter({
  /** The current summary in full, and the earlier ones' themes, newest first. */
  forStudent: programProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const enrollment = await enrollmentOf(ctx, input.programId, input.studentId);

      const rows = await ctx.db.coachingSummary.findMany({
        where: { enrollmentId: enrollment.id, programId: input.programId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          themes: true,
          inputs: true,
          focus: true,
          coveredThrough: true,
          createdAt: true,
          editedAt: true,
          author: { select: personNameSelect },
        },
      });

      const [newest, ...earlier] = rows;

      return {
        current:
          newest === undefined
            ? null
            : {
                id: newest.id,
                themes: parseSummaryThemes(newest.themes),
                inputs: newest.inputs,
                focus: newest.focus,
                coveredThrough: parseCoveredThrough(newest.coveredThrough),
                createdAt: newest.createdAt,
                editedAt: newest.editedAt,
                author: newest.author,
              },
        earlier: earlier.map((row) => ({
          id: row.id,
          themes: parseSummaryThemes(row.themes),
          inputs: row.inputs,
          createdAt: row.createdAt,
          author: row.author,
        })),
      };
    }),

  /**
   * Reads the chosen parts of the record from where the current summary stopped, asks Claude for a
   * new one, and stores it as the new current summary.
   *
   * **Refused before anything is recorded when there is nothing to read**: no previous summary and
   * every chosen part empty. With a previous summary there is always something — the summary
   * itself — and a coach may want it rewritten against a new focus.
   *
   * **Recorded and rate limited before the call**, as `checks.summarize` is: this spends money per
   * press, and a failed call still counts, because what is bounded is presses rather than
   * successes. A failed call stores nothing and leaves the current summary where it was.
   */
  generate: programProcedure
    .input(
      z.object({
        studentId: z.string().uuid(),
        inputs: z.array(z.enum(SUMMARY_INPUTS)).min(1, "Choose at least one part of the record."),
        focus: z.string().trim().max(SUMMARY_FOCUS_MAX_LENGTH).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const enrollment = await enrollmentOf(ctx, input.programId, input.studentId);
      // In the checkboxes' order, once each, so two rows that read the same parts store the same list.
      const inputs = SUMMARY_INPUTS.filter((part) => input.inputs.includes(part));
      const focus = input.focus ? input.focus : null;

      const previous = await ctx.db.coachingSummary.findFirst({
        where: { enrollmentId: enrollment.id, programId: input.programId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, themes: true, coveredThrough: true },
      });

      const assembled = await assembleSummaryInputs(ctx.db, enrollment, {
        inputs,
        previous:
          previous === null
            ? null
            : {
                createdAt: previous.createdAt,
                themes: parseSummaryThemes(previous.themes),
                coveredThrough: parseCoveredThrough(previous.coveredThrough),
              },
        focus,
        at: new Date(),
      });

      if (previous === null && assembled.isEmpty) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "There is nothing to read yet.",
        });
      }

      const actor = auditActor(ctx);
      await assertWithinRate(ctx.db, {
        actorId: actor.id,
        action: "COACHING_SUMMARY_GENERATED",
        limit: COACHING_SUMMARY_LIMIT,
        whatTheyDid: "generate themes",
      });
      const { roundsRead, roundsSkipped, sessionsSkipped } = assembled.coveredThrough;
      await recordEvent(ctx.db, {
        action: "COACHING_SUMMARY_GENERATED",
        actor,
        subject: fellowRef(enrollment),
        program: programRef(enrollment),
        detail: { inputs, roundsRead, roundsSkipped, sessionsSkipped },
      });

      /*
        Everyone the record's prose might name, so their names are hidden from Claude along with
        the fellow's. Test students are left out: their names are the words "Test" and "Student",
        which would hide those words in every summary.
      */
      const [classmates, staff] = await Promise.all([
        ctx.db.enrollment.findMany({
          where: { programId: input.programId, studentId: { not: input.studentId } },
          select: { student: { select: personSelect } },
        }),
        ctx.db.programInstructor.findMany({
          where: { programId: input.programId },
          select: { user: { select: personNameSelect } },
        }),
      ]);
      const names = {
        fellow: enrollment.student,
        others: [
          ...classmates
            .map(({ student }) => student)
            .filter((student) => student.testStudentNumber === null),
          ...staff.map(({ user }) => user),
        ],
      };

      let result;
      try {
        result = await generateCoachingSummary(assembled.input, names);
      } catch (err) {
        if (err instanceof CoachingSummaryError) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
        }
        throw err;
      }

      const themes = themesOf(result.summary);
      if (themes.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The summary came back with no themes. Try again.",
        });
      }

      return ctx.db.coachingSummary.create({
        data: {
          programId: enrollment.programId,
          enrollmentId: enrollment.id,
          themes,
          coveredThrough: assembled.coveredThrough,
          inputs,
          focus,
          authorId: ctx.profile.id,
          // The shape the other `model_metadata` columns use, so `npm run cost` prices it.
          modelMetadata: {
            provider: result.provider,
            modelId: result.modelId,
            promptVersion: result.promptVersion,
            usage: result.usage,
            sectionsGraded: ["coaching_summary"],
          },
        },
        select: { id: true },
      });
    }),

  /**
   * The coach's correction of one theme on the current summary. Marked as edited, so the next
   * generation is told this theme is the coach's and treats it as right.
   */
  editTheme: programProcedure
    .input(
      z.object({
        summaryId: z.string().uuid(),
        index: z.number().int().min(0),
        theme: themeEditSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const summary = await currentTheme(ctx, input.programId, input.summaryId, input.index);

      await inTransaction(ctx.db, async (tx) => {
        await tx.coachingSummary.update({
          where: { id: summary.id },
          data: {
            themes: summary.themes.map((theme, index) =>
              index === input.index ? { ...input.theme, edited: true } : theme,
            ),
            editedAt: new Date(),
          },
          select: { id: true },
        });
        await recordEvent(tx, {
          action: "COACHING_SUMMARY_EDITED",
          actor: auditActor(ctx),
          subject: fellowRef(summary.enrollment),
          program: programRef(summary.enrollment),
          detail: { summaryId: summary.id, change: "theme-edited" },
        });
      });
    }),

  /** Removes one theme from the current summary, so the next generation does not carry it forward. */
  removeTheme: programProcedure
    .input(z.object({ summaryId: z.string().uuid(), index: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const summary = await currentTheme(ctx, input.programId, input.summaryId, input.index);

      await inTransaction(ctx.db, async (tx) => {
        await tx.coachingSummary.update({
          where: { id: summary.id },
          data: {
            themes: summary.themes.filter((_, index) => index !== input.index),
            editedAt: new Date(),
          },
          select: { id: true },
        });
        await recordEvent(tx, {
          action: "COACHING_SUMMARY_EDITED",
          actor: auditActor(ctx),
          subject: fellowRef(summary.enrollment),
          program: programRef(summary.enrollment),
          detail: { summaryId: summary.id, change: "theme-removed" },
        });
      });
    }),

  /**
   * Deletes any summary. Deleting the current one makes the one before it current, and the next
   * generation reads from that one.
   */
  remove: programProcedure
    .input(z.object({ summaryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const summary = await ctx.db.coachingSummary.findFirst({
        where: { id: input.summaryId, programId: input.programId },
        select: { id: true, enrollment: { select: enrollmentSelect } },
      });
      if (!summary) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such summary here." });
      }

      await inTransaction(ctx.db, async (tx) => {
        await tx.coachingSummary.delete({ where: { id: summary.id }, select: { id: true } });
        await recordEvent(tx, {
          action: "COACHING_SUMMARY_DELETED",
          actor: auditActor(ctx),
          subject: fellowRef(summary.enrollment),
          program: programRef(summary.enrollment),
          detail: { summaryId: summary.id },
        });
      });
    }),
});
