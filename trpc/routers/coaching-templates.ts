import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { coachingLayoutSchema, parseLayout } from "@/lib/coaching";
import { inTransaction } from "@/lib/prisma";

import { adminProcedure, createTRPCRouter } from "../init";

/**
 * The coaching forms: the sections, questions and data panels a coaching session is run through.
 *
 * **One list for the application, and admins write all of it.** A form is used by every program,
 * so there is no program column — a program is one run of a fellowship, and a form owned by a run
 * would be copied into the next and drift — and writing is `adminProcedure`, the competency list's
 * rule. Instructors read the list through `coaching.forStudent`, which is where the form is chosen
 * from when a session starts.
 *
 * **A form is one row holding one JSON layout**, validated by `coachingLayoutSchema` on every
 * write. Nothing references a section or a question by a row of its own: a session copies the
 * layout when it starts, so every procedure here may change or delete a form freely and no session
 * already begun is touched. That is the whole safety story, and the reason nothing here is audited:
 * the log records what one person does to another, and a form is curriculum.
 *
 * **Saving sends the whole layout**, the way reordering sends the whole order. Two admins editing
 * the same form at once would overwrite each other, so `save` carries the `updatedAt` the admin
 * loaded and refuses when the row has moved, which turns a silent overwrite into a reload.
 */

type Ctx = Parameters<Parameters<typeof adminProcedure.mutation>[0]>[0]["ctx"];

const name = z.string().trim().min(1, "A form needs a name.").max(120);

/** How a copy is named: the original's name with " (copy)", kept within the column's cap. */
function copyName(original: string): string {
  const suffix = " (copy)";
  return `${original.slice(0, 120 - suffix.length)}${suffix}`;
}

/** A form by id, or NOT_FOUND. */
async function templateOf(ctx: Ctx, id: string) {
  const template = await ctx.db.coachingTemplate.findUnique({
    where: { id },
    select: { id: true, name: true, isDefault: true, layout: true, updatedAt: true },
  });

  if (!template) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such coaching form." });
  }

  return template;
}

export const coachingTemplatesRouter = createTRPCRouter({
  /** Every form, default first, for the admin's list. Layouts are read one at a time by `get`. */
  all: adminProcedure.query(({ ctx }) =>
    ctx.db.coachingTemplate.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isDefault: true, updatedAt: true },
    }),
  ),

  /**
   * One form with its layout, for the builder. A layout this code cannot read comes back null, and
   * the builder says so rather than offering to edit what it cannot show.
   */
  get: adminProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const template = await templateOf(ctx, input.id);
    return { ...template, layout: parseLayout(template.layout) };
  }),

  /** A new form with one empty section, for the builder to fill. Never the default. */
  create: adminProcedure.input(z.object({ name })).mutation(({ ctx, input }) =>
    ctx.db.coachingTemplate.create({
      data: {
        name: input.name,
        layout: { version: 1, sections: [{ id: randomUUID(), title: "Section 1", items: [] }] },
      },
      select: { id: true },
    }),
  ),

  /**
   * A copy of a form under a new name, not the default. Item ids are kept as they are: an id
   * needs only to be unique within its own layout, and a session copies exactly one layout.
   */
  duplicate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const original = await templateOf(ctx, input.id);
      const layout = parseLayout(original.layout);
      if (layout === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This form cannot be read, so it cannot be copied.",
        });
      }

      return ctx.db.coachingTemplate.create({
        data: { name: copyName(original.name), layout },
        select: { id: true },
      });
    }),

  /**
   * The whole form, written at once. Refused when the row has changed since the admin loaded it,
   * so that two people editing the same form cannot overwrite each other without knowing.
   */
  save: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name,
        layout: coachingLayoutSchema,
        updatedAt: z.coerce.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const template = await templateOf(ctx, input.id);
      if (template.updatedAt.getTime() !== input.updatedAt.getTime()) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This form changed while you were editing it. Reload to see the latest version.",
        });
      }

      return ctx.db.coachingTemplate.update({
        where: { id: template.id },
        data: { name: input.name, layout: input.layout },
        select: { updatedAt: true },
      });
    }),

  /**
   * Makes one form the default: the one a session starts from unless the coach picks another.
   * Every other flag is cleared in the same transaction, which is the whole of "at most one".
   */
  setDefault: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const template = await templateOf(ctx, input.id);

      await inTransaction(ctx.db, async (tx) => {
        await tx.coachingTemplate.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
        await tx.coachingTemplate.update({
          where: { id: template.id },
          data: { isDefault: true },
          select: { id: true },
        });
      });
    }),

  /**
   * Deletes a form. Always safe: every session holds its own copy of the layout it started with.
   * Deleting the default leaves no default, and the start-session picker then asks every time.
   */
  remove: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const template = await templateOf(ctx, input.id);
      await ctx.db.coachingTemplate.delete({ where: { id: template.id }, select: { id: true } });
    }),
});
