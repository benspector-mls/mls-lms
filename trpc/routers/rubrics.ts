import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  assertMayEdit,
  createRubric,
  createRuleSet,
  publishRubricVersion,
  publishRuleSetVersion,
  rubricTextSchema,
  ruleSetTextSchema,
} from "@/lib/rubrics/versions";

import { createTRPCRouter, instructorProcedure } from "../init";

/**
 * Rubrics and rule sets, as instructors write them.
 *
 * **Every instructor reads all of them and may create one; the author or an admin edits one.** A
 * rubric is picked from this list when an assignment is authored, so an instructor has to be able
 * to see every rubric to pick the right one — and reading a colleague's rubric is how a new
 * instructor learns what a good one looks like. Editing is narrower because a rubric names what
 * every submission of an assignment is scored against: the four ported ones grade every
 * repository assignment in the program, and an instructor who wants something different creates a
 * rubric rather than changing those.
 *
 * **An edit never touches a draft.** It writes a version; the sections already graded keep
 * pointing at the version they were graded against, and the review screen says when a newer one
 * exists. See `lib/rubrics/versions.ts`.
 *
 * Nothing here is audited, for the reason the competency list is not: a rubric is curriculum, and
 * the log records what one person does to another.
 */

const forEditing = {
  id: true,
  name: true,
  createdById: true,
  createdBy: { select: { displayName: true } },
  updatedAt: true,
} as const;

export const rubricsRouter = createTRPCRouter({
  /** Every rubric, newest edit first, with who wrote it and which version is current. */
  list: instructorProcedure.query(async ({ ctx }) => {
    const rubrics = await ctx.db.rubric.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        ...forEditing,
        currentVersion: { select: { number: true } },
        ruleSet: { select: { name: true } },
      },
    });

    return rubrics.map((rubric) => ({
      id: rubric.id,
      name: rubric.name,
      author: rubric.createdBy?.displayName ?? null,
      /** Null while a ported row waits for `port:rubrics`; the list says so rather than "v0". */
      version: rubric.currentVersion?.number ?? null,
      ruleSetName: rubric.ruleSet?.name ?? null,
      updatedAt: rubric.updatedAt,
      canEdit: ctx.profile.role === "ADMIN" || rubric.createdById === ctx.profile.id,
    }));
  }),

  /** One rubric's current text, for the form. */
  get: instructorProcedure
    .input(z.object({ rubricId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rubric = await ctx.db.rubric.findUnique({
        where: { id: input.rubricId },
        select: {
          ...forEditing,
          ruleSetId: true,
          currentVersion: {
            select: {
              number: true,
              rubricMarkdown: true,
              guidanceMarkdown: true,
              sampleReportMarkdown: true,
            },
          },
        },
      });
      if (!rubric)
        throw new TRPCError({ code: "NOT_FOUND", message: "That rubric does not exist." });

      return {
        id: rubric.id,
        name: rubric.name,
        author: rubric.createdBy?.displayName ?? null,
        ruleSetId: rubric.ruleSetId,
        version: rubric.currentVersion?.number ?? null,
        rubricMarkdown: rubric.currentVersion?.rubricMarkdown ?? "",
        guidanceMarkdown: rubric.currentVersion?.guidanceMarkdown ?? "",
        sampleReportMarkdown: rubric.currentVersion?.sampleReportMarkdown ?? "",
        canEdit: ctx.profile.role === "ADMIN" || rubric.createdById === ctx.profile.id,
      };
    }),

  create: instructorProcedure.input(rubricTextSchema).mutation(async ({ ctx, input }) => {
    await refuseTakenRubricName(ctx.db, input.name, null);
    const created = await ctx.db.$transaction((tx) =>
      createRubric(tx, { ...input, createdById: ctx.profile.id }),
    );
    return { id: created.rubricId };
  }),

  update: instructorProcedure
    .input(rubricTextSchema.extend({ rubricId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rubric = await ctx.db.rubric.findUnique({
        where: { id: input.rubricId },
        select: { createdById: true },
      });
      if (!rubric)
        throw new TRPCError({ code: "NOT_FOUND", message: "That rubric does not exist." });
      assertMayEdit(ctx.profile, rubric);
      await refuseTakenRubricName(ctx.db, input.name, input.rubricId);

      const version = await ctx.db.$transaction((tx) => publishRubricVersion(tx, input));
      return { version: version.number, changed: version.created };
    }),

  // =====================================================================================
  // Rule sets
  // =====================================================================================

  /** Every rule set, for the program settings select and the rubric form's Rules select. */
  listRuleSets: instructorProcedure.query(async ({ ctx }) => {
    const ruleSets = await ctx.db.ruleSet.findMany({
      orderBy: { updatedAt: "desc" },
      select: { ...forEditing, currentVersion: { select: { number: true } } },
    });

    return ruleSets.map((ruleSet) => ({
      id: ruleSet.id,
      name: ruleSet.name,
      author: ruleSet.createdBy?.displayName ?? null,
      version: ruleSet.currentVersion?.number ?? null,
      updatedAt: ruleSet.updatedAt,
      canEdit: ctx.profile.role === "ADMIN" || ruleSet.createdById === ctx.profile.id,
    }));
  }),

  getRuleSet: instructorProcedure
    .input(z.object({ ruleSetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ruleSet = await ctx.db.ruleSet.findUnique({
        where: { id: input.ruleSetId },
        select: { ...forEditing, currentVersion: { select: { number: true, markdown: true } } },
      });
      if (!ruleSet) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That rule set does not exist." });
      }

      return {
        id: ruleSet.id,
        name: ruleSet.name,
        author: ruleSet.createdBy?.displayName ?? null,
        version: ruleSet.currentVersion?.number ?? null,
        markdown: ruleSet.currentVersion?.markdown ?? "",
        canEdit: ctx.profile.role === "ADMIN" || ruleSet.createdById === ctx.profile.id,
      };
    }),

  /**
   * A new rule set, starting from another's text when one is named.
   *
   * Starting from a copy is how an instructor deviates from the program's voice without writing
   * tone rules from nothing: the copy is theirs, and an edit to the original never reaches it.
   */
  createRuleSet: instructorProcedure
    .input(
      ruleSetTextSchema.extend({
        // Empty is allowed here and nowhere else: the copy supplies the text.
        markdown: z.string().trim().max(60_000),
        startFromRuleSetId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await refuseTakenRuleSetName(ctx.db, input.name, null);

      let markdown = input.markdown;
      if (input.startFromRuleSetId) {
        const source = await ctx.db.ruleSet.findUnique({
          where: { id: input.startFromRuleSetId },
          select: { currentVersion: { select: { markdown: true } } },
        });
        if (!source?.currentVersion) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The rule set to start from does not exist, or has no text yet.",
          });
        }
        markdown = source.currentVersion.markdown;
      }
      if (markdown === "") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Write something, or start from a rule set.",
        });
      }

      const created = await ctx.db.$transaction((tx) =>
        createRuleSet(tx, { name: input.name, markdown, createdById: ctx.profile.id }),
      );
      return { id: created.ruleSetId };
    }),

  updateRuleSet: instructorProcedure
    .input(ruleSetTextSchema.extend({ ruleSetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ruleSet = await ctx.db.ruleSet.findUnique({
        where: { id: input.ruleSetId },
        select: { createdById: true },
      });
      if (!ruleSet) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That rule set does not exist." });
      }
      assertMayEdit(ctx.profile, ruleSet);
      await refuseTakenRuleSetName(ctx.db, input.name, input.ruleSetId);

      const version = await ctx.db.$transaction((tx) => publishRuleSetVersion(tx, input));
      return { version: version.number, changed: version.created };
    }),
});

type Db = Parameters<Parameters<typeof instructorProcedure.query>[0]>[0]["ctx"]["db"];

/*
  Names are unique, and the database says so with a constraint. Checked here as well so the
  refusal names the problem rather than arriving as a constraint violation with a code the form
  cannot put beside the field.
*/
async function refuseTakenRubricName(db: Db, name: string, exceptId: string | null) {
  const taken = await db.rubric.findUnique({ where: { name }, select: { id: true } });
  if (taken && taken.id !== exceptId) {
    throw new TRPCError({ code: "CONFLICT", message: `A rubric named "${name}" already exists.` });
  }
}

async function refuseTakenRuleSetName(db: Db, name: string, exceptId: string | null) {
  const taken = await db.ruleSet.findUnique({ where: { name }, select: { id: true } });
  if (taken && taken.id !== exceptId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A rule set named "${name}" already exists.`,
    });
  }
}
