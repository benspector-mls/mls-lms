import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertCourseMember, type Membership } from "@/lib/courses/membership";
import { inTransaction, type Tx } from "@/lib/prisma";
import { askTutor, TutorError } from "@/lib/tutor/ask";
import {
  assignmentMaterial,
  assignmentReadme,
  carrySections,
  curriculumOutline,
  formatSections,
  redactTurns,
  retrieveSections,
  type SectionReference,
  sectionsByReference,
} from "@/lib/tutor/context";
import { ASK_LIMIT, HISTORY_SHOWN, HISTORY_TURNS, MAX_QUESTION_LENGTH } from "@/lib/tutor/limits";
import { createTRPCRouter, profileProcedure, programProcedure } from "../init";

/**
 * The Tutor: a conversation about a course's lessons, or about one of its assignments, answered
 * by Claude from the course's own material. See `lib/tutor/ask.ts` for what Claude is told.
 *
 * **Asked through the course, by anybody who belongs to it.** `assertCourseMember` admits the
 * course's fellows once it is published, its program's instructors, and admins. A conversation is
 * kept under the asker's own profile, so a fellow's is read on their record by the program's
 * instructors and an instructor's is read by nobody else.
 *
 * **Under a read-only view, nothing can be asked.** `protectedProcedure` refuses every mutation
 * there, so an instructor viewing a fellow reads the fellow's conversation and sends nothing as
 * them.
 */

/** The course's own conversation when `assignmentId` is absent; one assignment's when it is set. */
const scopeSchema = z.object({ assignmentId: z.string().uuid().optional() });
type Scope = z.infer<typeof scopeSchema>;

/** What a turn comes back as, to the chat box and the record. */
const turnSelect = { id: true, role: true, content: true, sources: true, createdAt: true } as const;

/**
 * What the question is about, checked to belong to the course: the course itself, or an
 * assignment of it that a fellow has been given. The assignment's README is read later, once the
 * question has passed the hourly limit, so a refused question costs no GitHub request.
 */
async function resolveScope(db: Tx, courseId: string, scope: Scope, membership: Membership) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { name: true, curriculumId: true },
  });
  if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "There is no such course." });

  if (scope.assignmentId === undefined) {
    return {
      kind: "course" as const,
      material: `The fellow is asking about the course "${course.name}" and its lessons, rather than about one assignment.`,
      curriculumId: course.curriculumId,
    };
  }

  const assignment = await db.assignment.findUnique({
    where: { id: scope.assignmentId },
    select: {
      id: true,
      courseId: true,
      title: true,
      templateRepo: true,
      templateRef: true,
      submissionInstructions: true,
      distributedAt: true,
    },
  });
  const given = membership.as !== "student" || assignment?.distributedAt != null;
  if (!assignment || assignment.courseId !== courseId || !given) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "There is no such assignment in this course.",
    });
  }
  return { kind: "assignment" as const, assignment, curriculumId: course.curriculumId };
}

export const tutorRouter = createTRPCRouter({
  /**
   * One question, answered as a stream: the answer's text in pieces as Claude writes it, then the
   * two stored turns. The question is written before Claude is asked and the answer after, and a
   * question Claude does not answer is taken out again, so a call that fails leaves nothing behind
   * and the question stays in the box to be sent again.
   *
   * **The browser reaches this through `httpBatchStreamLink`**, which `trpc/client.tsx` chooses
   * for this one procedure: tRPC refuses a generator's result on any other link.
   */
  ask: profileProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        scope: scopeSchema,
        message: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
      }),
    )
    .mutation(async function* ({ ctx, input }) {
      const membership = await assertCourseMember(ctx, input.courseId);
      // A fellow taken off the roster keeps reading, as everywhere, and asks nothing more.
      if (membership.as === "student" && !membership.active) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are no longer on this program's roster, so the Tutor cannot be asked.",
        });
      }
      const resolved = await resolveScope(ctx.db, input.courseId, input.scope, membership);
      const assignmentId = input.scope.assignmentId ?? null;

      /*
        The question is written before Claude is asked, under a lock on the asker, so the count
        it is checked against includes every question already on its way to Claude. Counted after
        the answer, sixty questions sent at once would each see none and all be answered.
      */
      const asked = await inTransaction(ctx.db, async (tx) => {
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`tutor:${ctx.user.id}`}))`;
        const since = new Date(Date.now() - ASK_LIMIT.windowMinutes * 60 * 1000);
        const count = await tx.tutorMessage.count({
          where: { profileId: ctx.user.id, role: "USER", createdAt: { gte: since } },
        });
        if (count >= ASK_LIMIT.max) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `You have asked the Tutor ${ASK_LIMIT.max} questions in the last hour. Ask again a little later.`,
          });
        }
        return tx.tutorMessage.create({
          data: {
            profileId: ctx.user.id,
            courseId: input.courseId,
            assignmentId,
            role: "USER",
            content: input.message,
          },
          select: turnSelect,
        });
      });

      // The conversation before this question.
      const recent = await ctx.db.tutorMessage.findMany({
        where: {
          profileId: ctx.user.id,
          courseId: input.courseId,
          assignmentId,
          id: { not: asked.id },
        },
        orderBy: { createdAt: "desc" },
        take: HISTORY_TURNS,
        select: { role: true, content: true, sources: true },
      });
      // The sections the previous answer was based on come along; see `carrySections`.
      const carried = (recent.find((turn) => turn.role === "TUTOR")?.sources ??
        []) as SectionReference[];
      const history = recent.reverse();

      const [found, previous, outline, material] = await Promise.all([
        resolved.curriculumId ? retrieveSections(ctx.db, resolved.curriculumId, input.message) : [],
        resolved.curriculumId ? sectionsByReference(ctx.db, resolved.curriculumId, carried) : [],
        resolved.curriculumId ? curriculumOutline(ctx.db, resolved.curriculumId) : "",
        resolved.kind === "course"
          ? resolved.material
          : assignmentReadme(resolved.assignment).then((readme) =>
              assignmentMaterial(resolved.assignment, readme),
            ),
      ]);
      const sections = carrySections(found, previous);

      // The asker's own name is hidden from Claude; their answer gets it back. See `redactTurns`.
      const redaction = redactTurns([...history.map((turn) => turn.content), input.message], {
        fellow: {
          displayName: ctx.profile.displayName,
          email: ctx.profile.email,
          githubUsername: ctx.profile.githubUsername,
        },
        others: [],
      });
      const question = redaction.turns.at(-1) ?? "";

      /*
        The pieces of the answer wait here between Claude writing them and the loop below sending
        them on, and `wake` is how the loop learns that one arrived or that the answer is complete.
      */
      const pieces: string[] = [];
      let wake: (() => void) | undefined;

      /*
        Storing the answer, or taking the question out, runs to its end whether or not anybody is
        still reading the stream: a fellow who leaves the page mid-answer has asked a question,
        and the conversation must not hold it unanswered. The generator waits for this in its
        `finally`, which runs when the reader goes away as well as when the stream ends.
      */
      const completed = (async () => {
        let answer;
        try {
          answer = await askTutor(
            {
              scope: resolved.kind,
              material,
              outline,
              sections: formatSections(sections),
              history: history.map((turn, index) => ({
                role: turn.role,
                content: redaction.turns[index] ?? turn.content,
              })),
              question,
            },
            (text) => {
              pieces.push(text);
              wake?.();
            },
          );
        } catch (err) {
          // An unanswered question leaves nothing behind, and stays in the box to be sent again.
          try {
            await ctx.db.tutorMessage.delete({ where: { id: asked.id } });
          } catch (deleteErr) {
            // The fellow is told why Claude did not answer, not that this failed.
            console.error("Could not take out an unanswered Tutor question", deleteErr);
          }
          if (err instanceof TutorError) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
          }
          throw err;
        }

        const answered = await ctx.db.tutorMessage.create({
          data: {
            profileId: ctx.user.id,
            courseId: input.courseId,
            assignmentId,
            role: "TUTOR",
            content: redaction.restore(answer.content),
            sources:
              sections.length > 0
                ? sections.map(({ slug, anchor, heading, title }) => ({
                    slug,
                    anchor,
                    heading,
                    title,
                  }))
                : undefined,
            // The shape the other `model_metadata` columns use, so `npm run cost` prices it.
            modelMetadata: {
              provider: answer.provider,
              modelId: answer.modelId,
              promptVersion: answer.promptVersion,
              usage: answer.usage,
              sectionsGraded: ["tutor"],
            },
          },
          select: turnSelect,
        });
        return [asked, answered];
      })();

      let settled = false;
      const onSettled = () => {
        settled = true;
        wake?.();
      };
      completed.then(onSettled, onSettled);

      try {
        while (!settled || pieces.length > 0) {
          if (pieces.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
          }
          const text = pieces.splice(0).join("");
          if (text !== "") yield { type: "text" as const, text };
        }
        // Rejects with the error above when Claude did not answer.
        yield { type: "done" as const, turns: await completed };
      } finally {
        await completed.catch(() => undefined);
      }
    }),

  /** The caller's conversation in one scope, oldest first. */
  history: profileProcedure
    .input(z.object({ courseId: z.string().uuid(), scope: scopeSchema }))
    .query(async ({ ctx, input }) => {
      await assertCourseMember(ctx, input.courseId);
      const recent = await ctx.db.tutorMessage.findMany({
        where: {
          profileId: ctx.user.id,
          courseId: input.courseId,
          assignmentId: input.scope.assignmentId ?? null,
        },
        orderBy: { createdAt: "desc" },
        take: HISTORY_SHOWN,
        select: turnSelect,
      });
      return { turns: recent.reverse() };
    }),

  /**
   * One fellow's conversations across the program's courses, for their record: one per course
   * and one per assignment asked about, the most recently active first. An instructor's own
   * conversations are under the instructor's profile, so they are never here.
   */
  transcripts: programProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const enrollment = await ctx.db.enrollment.findUnique({
        where: { programId_studentId: { programId: input.programId, studentId: input.studentId } },
        select: { id: true },
      });
      if (!enrollment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That person is not on this program's roster.",
        });
      }

      const messages = await ctx.db.tutorMessage.findMany({
        where: { profileId: input.studentId, course: { programId: input.programId } },
        orderBy: { createdAt: "asc" },
        select: {
          ...turnSelect,
          course: { select: { id: true, name: true } },
          assignment: { select: { id: true, title: true } },
        },
      });

      const conversations = new Map<
        string,
        {
          key: string;
          kind: "course" | "assignment";
          title: string;
          courseId: string;
          courseName: string;
          lastAt: Date;
          turns: { id: string; role: "USER" | "TUTOR"; content: string; createdAt: Date }[];
        }
      >();
      for (const message of messages) {
        const key = message.assignment
          ? `assignment:${message.assignment.id}`
          : `course:${message.course.id}`;
        let conversation = conversations.get(key);
        if (!conversation) {
          conversation = {
            key,
            kind: message.assignment ? "assignment" : "course",
            title: message.assignment?.title ?? message.course.name,
            courseId: message.course.id,
            courseName: message.course.name,
            lastAt: message.createdAt,
            turns: [],
          };
          conversations.set(key, conversation);
        }
        conversation.lastAt = message.createdAt;
        conversation.turns.push({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        });
      }

      return [...conversations.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
    }),
});
