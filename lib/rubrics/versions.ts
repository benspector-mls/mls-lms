import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Tx } from "../prisma";

/**
 * Rubrics and rule sets as versioned text.
 *
 * **A rubric's row is its identity and a version is its text**, so that `Assignment.sections[]`
 * can keep pointing at one id while the words change, and so that a graded section can name the
 * exact words it was scored against. Every write here follows the same shape: insert a version
 * numbered one past the last, then move the row's `currentVersionId` to it. Nothing updates a
 * version once written.
 *
 * **A save that changes nothing creates nothing.** The port script runs more than once — against
 * development, then against the deployment, then again after a fix — and a version per run would
 * be a history of nothing. Comparing the text first is what makes every publish idempotent, and it
 * is the same rule for an instructor pressing Save on an unchanged form.
 *
 * Takes a client rather than importing one, so an integration test can drive these inside a
 * transaction it rolls back.
 */

/** Long enough for a rubric with every band written out; short enough to refuse a pasted file. */
const MARKDOWN_MAX = 60_000;
const markdown = z.string().trim().min(1, "Write something here.").max(MARKDOWN_MAX);
const name = z.string().trim().min(1, "Give it a name.").max(120);

export const rubricTextSchema = z.object({
  name,
  rubricMarkdown: markdown,
  guidanceMarkdown: markdown,
  sampleReportMarkdown: z.string().trim().max(MARKDOWN_MAX).nullable(),
  /** Null follows the program's rule set; see `Rubric.ruleSetId`. */
  ruleSetId: z.string().uuid().nullable(),
});
export type RubricText = z.infer<typeof rubricTextSchema>;

export const ruleSetTextSchema = z.object({ name, markdown });
export type RuleSetText = z.infer<typeof ruleSetTextSchema>;

/**
 * Author or admin, and nobody else.
 *
 * A row with no author — the four ported rubrics and the ported rule set — is the program's own,
 * and only an admin edits it. An instructor who wants a different rubric creates one rather than
 * changing the one every repository assignment is graded against.
 */
export function assertMayEdit(
  caller: { id: string; role: "STUDENT" | "INSTRUCTOR" | "ADMIN" },
  row: { createdById: string | null },
): void {
  if (caller.role === "ADMIN") return;
  if (row.createdById !== null && row.createdById === caller.id) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      row.createdById === null
        ? "This one belongs to the program, so only an admin can edit it. Create your own to change it."
        : "Only the person who wrote this, or an admin, can edit it.",
  });
}

/** An empty sample is stored as null, so "no sample" has one spelling. */
function sampleOrNull(sample: string | null): string | null {
  const trimmed = sample?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export async function createRubric(
  db: Tx,
  input: RubricText & { createdById: string | null },
): Promise<{ rubricId: string; versionId: string }> {
  const rubric = await db.rubric.create({
    data: {
      name: input.name,
      // The three pre-version columns, written so the row reads like the seeded ones. Nothing the
      // prompt is built from reads them.
      scaleType: "POINTS",
      criteria: [],
      maxScore: 0,
      createdById: input.createdById,
      ruleSetId: input.ruleSetId,
    },
    select: { id: true },
  });
  const version = await publishRubricVersion(db, { rubricId: rubric.id, ...input });
  return { rubricId: rubric.id, versionId: version.versionId };
}

/**
 * The next version of a rubric's text, or the current one when the text has not changed.
 *
 * `name` and `ruleSetId` live on the row rather than the version, so they are written whether
 * or not a version is created: renaming a rubric or pointing it at another rule set is not a
 * change to what the model reads from it.
 */
export async function publishRubricVersion(
  db: Tx,
  input: RubricText & { rubricId: string },
): Promise<{ versionId: string; number: number; created: boolean }> {
  const sample = sampleOrNull(input.sampleReportMarkdown);

  const rubric = await db.rubric.update({
    where: { id: input.rubricId },
    data: { name: input.name, ruleSetId: input.ruleSetId },
    select: {
      currentVersion: {
        select: {
          id: true,
          number: true,
          rubricMarkdown: true,
          guidanceMarkdown: true,
          sampleReportMarkdown: true,
        },
      },
    },
  });

  const current = rubric.currentVersion;
  if (
    current &&
    current.rubricMarkdown === input.rubricMarkdown &&
    current.guidanceMarkdown === input.guidanceMarkdown &&
    current.sampleReportMarkdown === sample
  ) {
    return { versionId: current.id, number: current.number, created: false };
  }

  const version = await db.rubricVersion.create({
    data: {
      rubricId: input.rubricId,
      number: (current?.number ?? 0) + 1,
      rubricMarkdown: input.rubricMarkdown,
      guidanceMarkdown: input.guidanceMarkdown,
      sampleReportMarkdown: sample,
    },
    select: { id: true, number: true },
  });
  await db.rubric.update({
    where: { id: input.rubricId },
    data: { currentVersionId: version.id },
  });
  return { versionId: version.id, number: version.number, created: true };
}

export async function createRuleSet(
  db: Tx,
  input: RuleSetText & { createdById: string | null },
): Promise<{ ruleSetId: string; versionId: string }> {
  const ruleSet = await db.ruleSet.create({
    data: { name: input.name, createdById: input.createdById },
    select: { id: true },
  });
  const version = await publishRuleSetVersion(db, { ruleSetId: ruleSet.id, ...input });
  return { ruleSetId: ruleSet.id, versionId: version.versionId };
}

/** The next version of a rule set's text, or the current one when the text has not changed. */
export async function publishRuleSetVersion(
  db: Tx,
  input: RuleSetText & { ruleSetId: string },
): Promise<{ versionId: string; number: number; created: boolean }> {
  const ruleSet = await db.ruleSet.update({
    where: { id: input.ruleSetId },
    data: { name: input.name },
    select: { currentVersion: { select: { id: true, number: true, markdown: true } } },
  });

  const current = ruleSet.currentVersion;
  if (current && current.markdown === input.markdown) {
    return { versionId: current.id, number: current.number, created: false };
  }

  const version = await db.ruleSetVersion.create({
    data: {
      ruleSetId: input.ruleSetId,
      number: (current?.number ?? 0) + 1,
      markdown: input.markdown,
    },
    select: { id: true, number: true },
  });
  await db.ruleSet.update({
    where: { id: input.ruleSetId },
    data: { currentVersionId: version.id },
  });
  return { versionId: version.id, number: version.number, created: true };
}

/**
 * The one sentence both refusals use when a program has no rule set, so an instructor meets the
 * same words on the assignment form and on the review screen.
 */
export const NO_RULE_SET_MESSAGE =
  "Ask your admin to choose grading rules for this program before using AI grading.";
