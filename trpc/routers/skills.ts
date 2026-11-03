import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Tx } from "@/lib/prisma";

import { adminProcedure, createTRPCRouter } from "../init";

/**
 * The skills taxonomies: one per discipline, each a list of groups holding skills.
 *
 * **Admins write all three levels, and nobody else reads them here.** Instructors read a
 * taxonomy through `assignments.authoringContext`, which hands them their program's discipline's
 * groups and skills for the section editor's picker, and the Skills tabs read it through
 * `programs.skills`. A taxonomy itself is never added or removed from a screen: there is one per
 * discipline and the migration seeded both.
 *
 * **Deleting changes no grade.** A skill is named by id inside `assignments.sections`, and the
 * Skills tabs read a fellow's figures from the approved rounds at request time, so renaming a
 * skill renames it everywhere at once. A skill that any assignment's section names is refused
 * deletion, naming how many, because deleting it would silently drop those sections from the
 * tabs; the instructor re-tags the sections first. A group is deleted only when it is empty, as a
 * competency group is.
 */

const name = z.string().trim().min(1, "A name is needed.").max(200);
const definition = z.string().trim().max(2000);
const canonicalId = z
  .string()
  .trim()
  .min(1, "A canonical id is needed.")
  .max(80)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Lowercase letters, digits and hyphens only, like reading-a-traceback.",
  );

const skillSelect = {
  id: true,
  groupId: true,
  canonicalId: true,
  name: true,
  definition: true,
} as const;

const nextPosition = (last: { position: number } | null) => (last === null ? 0 : last.position + 1);

export const skillsRouter = createTRPCRouter({
  /** Every taxonomy with its groups and their skills, in order: the authoring screen's read. */
  all: adminProcedure.query(({ ctx }) =>
    ctx.db.skillTaxonomy.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        discipline: true,
        name: true,
        groups: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            skills: { orderBy: { position: "asc" }, select: skillSelect },
          },
        },
      },
    }),
  ),

  /** Adds a group at the end of a taxonomy. */
  addGroup: adminProcedure
    .input(z.object({ taxonomyId: z.string().uuid(), name }))
    .mutation(async ({ ctx, input }) => {
      const taxonomy = await ctx.db.skillTaxonomy.findUnique({
        where: { id: input.taxonomyId },
        select: { id: true },
      });
      if (!taxonomy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That taxonomy does not exist." });
      }
      await refuseDuplicateGroup(ctx.db, input.taxonomyId, input.name, null);
      return ctx.db.skillGroup.create({
        data: {
          taxonomyId: input.taxonomyId,
          name: input.name,
          position: nextPosition(
            await ctx.db.skillGroup.findFirst({
              where: { taxonomyId: input.taxonomyId },
              orderBy: { position: "desc" },
              select: { position: true },
            }),
          ),
        },
        select: { id: true, name: true },
      });
    }),

  renameGroup: adminProcedure
    .input(z.object({ groupId: z.string().uuid(), name }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.skillGroup.findUnique({
        where: { id: input.groupId },
        select: { id: true, taxonomyId: true },
      });
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "That group does not exist." });
      await refuseDuplicateGroup(ctx.db, group.taxonomyId, input.name, group.id);
      return ctx.db.skillGroup.update({
        where: { id: group.id },
        data: { name: input.name },
        select: { id: true, name: true },
      });
    }),

  /** Deletes an empty group. One with skills is refused, naming the count. */
  removeGroup: adminProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.skillGroup.findUnique({
        where: { id: input.groupId },
        select: { id: true, name: true, _count: { select: { skills: true } } },
      });
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "That group does not exist." });
      if (group._count.skills > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${group.name} still holds ${group._count.skills === 1 ? "1 skill" : `${group._count.skills} skills`}. ` +
            `Delete or move them first.`,
        });
      }
      await ctx.db.skillGroup.delete({ where: { id: group.id } });
      return { id: group.id };
    }),

  /** Adds a skill at the end of a group. Its taxonomy is the group's. */
  addSkill: adminProcedure
    .input(z.object({ groupId: z.string().uuid(), canonicalId, name, definition }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.skillGroup.findUnique({
        where: { id: input.groupId },
        select: { id: true, taxonomyId: true },
      });
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "That group does not exist." });
      await refuseDuplicateSkill(ctx.db, group.taxonomyId, input.canonicalId, null);
      return ctx.db.skill.create({
        data: {
          taxonomyId: group.taxonomyId,
          groupId: group.id,
          canonicalId: input.canonicalId,
          name: input.name,
          definition: input.definition,
          position: nextPosition(
            await ctx.db.skill.findFirst({
              where: { groupId: group.id },
              orderBy: { position: "desc" },
              select: { position: true },
            }),
          ),
        },
        select: skillSelect,
      });
    }),

  /** Changes what a skill is called, its canonical id, or its definition. It stays in its group. */
  saveSkill: adminProcedure
    .input(z.object({ skillId: z.string().uuid(), canonicalId, name, definition }))
    .mutation(async ({ ctx, input }) => {
      const skill = await ctx.db.skill.findUnique({
        where: { id: input.skillId },
        select: { id: true, taxonomyId: true },
      });
      if (!skill) throw new TRPCError({ code: "NOT_FOUND", message: "That skill does not exist." });
      await refuseDuplicateSkill(ctx.db, skill.taxonomyId, input.canonicalId, skill.id);
      return ctx.db.skill.update({
        where: { id: skill.id },
        data: { canonicalId: input.canonicalId, name: input.name, definition: input.definition },
        select: skillSelect,
      });
    }),

  /**
   * Deletes a skill no assignment's section names.
   *
   * The sections that name a skill are JSON entries in `assignments.sections`, so the check is a
   * containment query over that column: an assignment whose array holds an entry with this
   * `skillId`. One that does is refused with the count, because deleting the skill would drop
   * those sections from every fellow's figures without anybody having decided to.
   */
  removeSkill: adminProcedure
    .input(z.object({ skillId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const skill = await ctx.db.skill.findUnique({
        where: { id: input.skillId },
        select: { id: true, name: true },
      });
      if (!skill) throw new TRPCError({ code: "NOT_FOUND", message: "That skill does not exist." });
      const tagged = await ctx.db.assignment.count({
        where: { sections: { array_contains: [{ skillId: skill.id }] } },
      });
      if (tagged > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${tagged === 1 ? "1 assignment has a section" : `${tagged} assignments have sections`} ` +
            `tagged ${skill.name}. Re-tag them before deleting it.`,
        });
      }
      const graded = await ctx.db.gradingDraftSection.count({ where: { skillId: skill.id } });
      if (graded > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${graded === 1 ? "1 graded section was" : `${graded} graded sections were`} scored ` +
            `as evidence of ${skill.name}. It cannot be deleted while they stand.`,
        });
      }
      await ctx.db.skill.delete({ where: { id: skill.id } });
      return { id: skill.id };
    }),
});

/**
 * Checked before writing rather than caught as a unique violation afterwards, because a failed
 * statement aborts the surrounding Postgres transaction wherever there is one, and the integration
 * suites run every procedure inside one.
 */
async function refuseDuplicateGroup(
  db: Tx,
  taxonomyId: string,
  groupName: string,
  exceptId: string | null,
): Promise<void> {
  const existing = await db.skillGroup.findUnique({
    where: { taxonomyId_name: { taxonomyId, name: groupName } },
    select: { id: true },
  });
  if (existing && existing.id !== exceptId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This taxonomy already has a group called "${groupName}".`,
    });
  }
}

async function refuseDuplicateSkill(
  db: Tx,
  taxonomyId: string,
  id: string,
  exceptId: string | null,
): Promise<void> {
  const existing = await db.skill.findUnique({
    where: { taxonomyId_canonicalId: { taxonomyId, canonicalId: id } },
    select: { id: true },
  });
  if (existing && existing.id !== exceptId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This taxonomy already has a skill with the id "${id}".`,
    });
  }
}
