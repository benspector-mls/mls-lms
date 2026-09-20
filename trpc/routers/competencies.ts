import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { DISCIPLINES, ENTRY_KINDS } from "@/lib/competencies";
import { assertProgramMember } from "@/lib/courses/membership";
import { writeOrder } from "@/lib/courses/order";

import { adminProcedure, createTRPCRouter, profileProcedure } from "../init";

/**
 * The competency list: the competency groups, the competencies under them, and the indicators and
 * pitfalls a goal is built on.
 *
 * **One list for the application, and admins author all of it.** There is no program column on any
 * of the three tables — a program is one *run* of a fellowship, so a list owned by a run would be
 * copied into the next run and drift away from it. What varies between the two fellowships is
 * which competencies each is offered, and that is a column on the competency rather than a second
 * copy of the list.
 *
 * **Reading and writing are split by role, not by row.** Every member of a program reads the list
 * their program is offered, because a fellow picks a goal from it and an instructor reads what
 * they picked from. Writing is `adminProcedure`, which admits nobody else: an instructor deciding
 * what the school says a fellow is developing is not a smaller version of teaching them.
 *
 * **Nothing here is audited.** The log records what one person does to another and the access that
 * made it possible; no curriculum edit in this application is audited, and a competency list is
 * curriculum. What protects a goal from an edit here is not a record of the edit — it is that a
 * goal copied its wording when it was set and never reads it back.
 */

const name = z.string().trim().min(1, "A name is needed.").max(200);
const blurb = z.string().trim().max(1000);
const text = z.string().trim().min(1, "An entry needs words in it.").max(1000);
const disciplines = z.array(z.enum(DISCIPLINES)).max(DISCIPLINES.length);

/** Where a new row lands: after the last one, or at the start of an empty sequence. */
const nextPosition = (last: { position: number } | null) => (last === null ? 0 : last.position + 1);

export const competenciesRouter = createTRPCRouter({
  /**
   * The list one program's fellows are offered: the competency groups, each holding the
   * competencies whose disciplines include that program's own, and their entries.
   *
   * **Read by every member of the program**, which is the widest read in this router and still the
   * right one: the list is what a fellow chooses a goal from and what an instructor sees them
   * choose from. `assertProgramMember` rather than `assertActiveInProgram`, so a removed fellow
   * looking back at their goals page is not told the list does not exist.
   *
   * A group left with no competencies by the discipline filter is dropped here rather than in the
   * picker, because an empty heading is the one thing a three-level list must never show — and
   * "Data Analytics" is seeded empty on purpose, waiting for an admin to write it.
   */
  forProgram: profileProcedure
    .input(z.object({ programId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertProgramMember(ctx, input.programId);

      const program = await ctx.db.program.findUnique({
        where: { id: input.programId },
        select: { discipline: true },
      });

      if (!program) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That program does not exist." });
      }

      const groups = await ctx.db.competencyGroup.findMany({
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          competencies: {
            where: { disciplines: { has: program.discipline } },
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              blurb: true,
              entries: {
                orderBy: { position: "asc" },
                select: { id: true, kind: true, text: true },
              },
            },
          },
        },
      });

      return {
        discipline: program.discipline,
        groups: groups.filter((group) => group.competencies.length > 0),
      };
    }),

  /**
   * Every competency group, competency, and entry, whatever discipline it is offered to: the
   * authoring screen's read.
   *
   * A second procedure rather than a flag on `forProgram`, because the two answer different
   * questions. One is "what may this fellow choose from", which is a question about a program and
   * must never return more than that; this one is "what does the list say", which only an admin
   * asks. A flag would put both answers behind one guard and one payload shape.
   */
  all: adminProcedure.query(({ ctx }) =>
    ctx.db.competencyGroup.findMany({
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        competencies: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            blurb: true,
            disciplines: true,
            entries: {
              orderBy: { position: "asc" },
              select: { id: true, kind: true, text: true },
            },
          },
        },
      },
    }),
  ),

  /** Adds a competency group to the end of the list, or renames one. */
  saveGroup: adminProcedure
    .input(z.object({ groupId: z.string().uuid().nullable(), name }))
    .mutation(async ({ ctx, input }) => {
      if (input.groupId !== null) {
        return ctx.db.competencyGroup.update({
          where: { id: input.groupId },
          data: { name: input.name },
          select: { id: true, name: true },
        });
      }

      return ctx.db.competencyGroup.create({
        data: {
          name: input.name,
          position: nextPosition(
            await ctx.db.competencyGroup.findFirst({
              orderBy: { position: "desc" },
              select: { position: true },
            }),
          ),
        },
        select: { id: true, name: true },
      });
    }),

  /**
   * Removes an empty competency group.
   *
   * **Refused while any competency sits in it**, naming the count, for the reason
   * `courseUnits.remove` refuses a unit with assignments: the foreign key is `RESTRICT` and would
   * refuse it too, but a foreign-key violation reaching an admin is not an answer. The count is
   * what tells them what to move first.
   */
  removeGroup: adminProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.competencyGroup.findUnique({
        where: { id: input.groupId },
        select: { id: true, name: true, _count: { select: { competencies: true } } },
      });

      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That competency group does not exist.",
        });
      }

      const held = group._count.competencies;
      if (held > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${group.name} still holds ${held} ${
            held === 1 ? "competency" : "competencies"
          }. Move or delete ${held === 1 ? "it" : "them"} first.`,
        });
      }

      await ctx.db.competencyGroup.delete({ where: { id: group.id } });

      return { id: group.id };
    }),

  /**
   * Creates a competency at the end of a competency group, or updates one — including moving it to
   * another group, which lands it at the end of that one.
   */
  saveCompetency: adminProcedure
    .input(
      z.object({
        competencyId: z.string().uuid().nullable(),
        groupId: z.string().uuid(),
        name,
        blurb,
        disciplines,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.competencyGroup.findUnique({
        where: { id: input.groupId },
        select: { id: true },
      });

      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That competency group does not exist.",
        });
      }

      if (input.competencyId !== null) {
        const current = await ctx.db.competency.findUnique({
          where: { id: input.competencyId },
          select: { groupId: true, position: true },
        });

        if (!current) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That competency does not exist." });
        }

        return ctx.db.competency.update({
          where: { id: input.competencyId },
          data: {
            groupId: input.groupId,
            name: input.name,
            blurb: input.blurb,
            disciplines: input.disciplines,
            /*
              A competency carried into another group keeps its old position otherwise, which would
              drop it into the middle of rows it has never been ordered against.
            */
            position:
              current.groupId === input.groupId
                ? current.position
                : nextPosition(
                    await ctx.db.competency.findFirst({
                      where: { groupId: input.groupId },
                      orderBy: { position: "desc" },
                      select: { position: true },
                    }),
                  ),
          },
          select: { id: true, name: true },
        });
      }

      return ctx.db.competency.create({
        data: {
          groupId: input.groupId,
          name: input.name,
          blurb: input.blurb,
          disciplines: input.disciplines,
          position: nextPosition(
            await ctx.db.competency.findFirst({
              where: { groupId: input.groupId },
              orderBy: { position: "desc" },
              select: { position: true },
            }),
          ),
        },
        select: { id: true, name: true },
      });
    }),

  /**
   * Deletes a competency and the entries under it.
   *
   * **No refusal and no count of the goals built on it**, unlike a competency group: those goals hold their
   * own copy of every word they need and go on rendering exactly as they did. The screen says so
   * beside the control, because "will this delete somebody's goal" is the question an admin will
   * have, and the answer is no.
   */
  removeCompetency: adminProcedure
    .input(z.object({ competencyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.competency.delete({ where: { id: input.competencyId } });

      return { id: input.competencyId };
    }),

  /** Adds an indicator or a pitfall to the end of a competency, or rewrites one. */
  saveEntry: adminProcedure
    .input(
      z.object({
        entryId: z.string().uuid().nullable(),
        competencyId: z.string().uuid(),
        kind: z.enum(ENTRY_KINDS),
        text,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.entryId !== null) {
        return ctx.db.competencyEntry.update({
          where: { id: input.entryId },
          data: { kind: input.kind, text: input.text },
          select: { id: true, kind: true, text: true },
        });
      }

      const competency = await ctx.db.competency.findUnique({
        where: { id: input.competencyId },
        select: { id: true },
      });

      if (!competency) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That competency does not exist." });
      }

      return ctx.db.competencyEntry.create({
        data: {
          competencyId: input.competencyId,
          kind: input.kind,
          text: input.text,
          position: nextPosition(
            await ctx.db.competencyEntry.findFirst({
              where: { competencyId: input.competencyId },
              orderBy: { position: "desc" },
              select: { position: true },
            }),
          ),
        },
        select: { id: true, kind: true, text: true },
      });
    }),

  /** Deletes one entry. The goals built on it keep their wording, as above. */
  removeEntry: adminProcedure
    .input(z.object({ entryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.competencyEntry.delete({ where: { id: input.entryId } });

      return { id: input.entryId };
    }),

  /**
   * Writes one level's order, whole.
   *
   * **The whole order rather than "move this one"**, the `courseUnits.reorder` shape and for its
   * reasons: it is idempotent, it cannot leave a gap or a duplicate, and a list that does not name
   * exactly the rows it is allowed to touch is refused rather than half-applied. `within` names
   * the group whose competencies are being ordered or the competency whose entries are, and is
   * null for the groups themselves, which have nothing above them.
   */
  reorder: adminProcedure
    .input(
      z.union([
        z.object({
          of: z.literal("groups"),
          within: z.null(),
          ids: z.array(z.string().uuid()).min(1),
        }),
        z.object({
          of: z.literal("competencies"),
          within: z.string().uuid(),
          ids: z.array(z.string().uuid()).min(1),
        }),
        z.object({
          of: z.literal("entries"),
          within: z.string().uuid(),
          ids: z.array(z.string().uuid()).min(1),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const existing =
        input.of === "groups"
          ? await ctx.db.competencyGroup.findMany({ select: { id: true } })
          : input.of === "competencies"
            ? await ctx.db.competency.findMany({
                where: { groupId: input.within },
                select: { id: true },
              })
            : await ctx.db.competencyEntry.findMany({
                where: { competencyId: input.within },
                select: { id: true },
              });

      const noun =
        input.of === "groups"
          ? "competency group"
          : input.of === "competencies"
            ? "competency"
            : "entry";

      const sent = new Set(input.ids);
      if (sent.size !== input.ids.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `That order lists a ${noun} twice.` });
      }
      if (sent.size !== existing.length || !existing.every((row) => sent.has(row.id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `That order does not list exactly the ${noun === "entry" ? "entries" : `${noun}s`} ` +
            "it should. Reload the page and try again — someone may have added or removed one.",
        });
      }

      await writeOrder(
        ctx.db,
        input.of === "groups"
          ? "competencyGroups"
          : input.of === "competencies"
            ? "competencies"
            : "competencyEntries",
        input.within,
        input.ids,
      );

      return { count: input.ids.length };
    }),
});
