import { z } from "zod";

import { AssignmentKind } from "../generated/prisma/enums";
import { resolveRunner, UnknownRunnerPresetError } from "../sandbox/presets";

/**
 * What a valid assignment is.
 *
 * One definition, used by the seed and by the authoring procedures, so the seeded
 * shape and the authored shape cannot drift. Nothing here reads the database or the
 * network, so it is safe in the browser and can be checked as a pure function.
 *
 * The rule this module exists to hold: **an assignment's shape is validated where it
 * is written, not where it is graded.** A wrong `moduleTag` or a mistyped answer key
 * path does not throw at grading time — it produces a confident wrong grade, or a
 * manual-review reason whose cause is not obvious hours later.
 *
 * `kind` is what makes this a union rather than a flat object. A repository-backed
 * assignment needs three GitHub fields and can name a test runner; a Google Doc or an
 * uploaded file has no repository to generate, no pull request to diff, and no suite
 * to execute. Those columns are nullable in the database because a column cannot
 * express "required for one kind" — this schema is where the requirement lives.
 */

export { AssignmentKind };

/** The four section types that exist in `rubric.md`, and the only ones a rubric covers. */
export const SECTION_TYPES = [
  "short_response",
  "coding_algorithm",
  "coding_sql",
  "coding_frontend",
] as const;

/**
 * Kinds the application can actually distribute, collect, and grade today.
 *
 * Separate from the enum on purpose. The enum names the axis so that every code path
 * assuming a repository has to say so; this set says which of them are built. When a
 * Google Doc assignment becomes real, this is the one line that changes — and until
 * then the refusal says so in those words rather than failing somewhere downstream on
 * a null repository name.
 */
export const IMPLEMENTED_KINDS: ReadonlySet<AssignmentKind> = new Set([AssignmentKind.REPO]);

/** True when this kind's submissions live in a generated GitHub repository. */
export function requiresRepository(kind: AssignmentKind): boolean {
  return kind === AssignmentKind.REPO;
}

export class UnsupportedAssignmentKindError extends Error {
  constructor(readonly kind: AssignmentKind) {
    super(
      `Assignments of kind ${kind} are not implemented yet. Only ` +
        `${[...IMPLEMENTED_KINDS].join(", ")} can be distributed, collected, or graded. ` +
        `See IMPLEMENTED_KINDS in lib/assignments/spec.ts.`,
    );
    this.name = "UnsupportedAssignmentKindError";
  }
}

/** Throws unless this kind is built. Call it where the work would begin, not later. */
export function assertKindImplemented(kind: AssignmentKind): void {
  if (!IMPLEMENTED_KINDS.has(kind)) throw new UnsupportedAssignmentKindError(kind);
}

export class AssignmentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssignmentConfigurationError";
  }
}

/** The GitHub fields a repository-backed assignment always has, once narrowed. */
export type RepositorySource = {
  templateRepo: string;
  assignmentRepoName: string;
  githubOrg: string;
  templateRef: string | null;
};

/**
 * Narrows the four nullable GitHub columns for a repository-backed assignment, or
 * throws saying which case this is.
 *
 * Every path that generates a repository, fetches a template, or names a student's
 * repository goes through here, so "this assignment has a repository" is asserted in
 * one place instead of at each use. The two failures are different and are reported
 * differently: a Google Doc assignment is *not yet supported*, while a REPO assignment
 * missing `githubOrg` is *misconfigured* — one is a feature that does not exist and the
 * other is a row that should never have been written.
 */
export function repositorySource(assignment: {
  kind: AssignmentKind;
  templateRepo: string | null;
  assignmentRepoName: string | null;
  githubOrg: string | null;
  templateRef?: string | null;
}): RepositorySource {
  assertKindImplemented(assignment.kind);

  if (!requiresRepository(assignment.kind)) {
    throw new UnsupportedAssignmentKindError(assignment.kind);
  }

  const missing = (
    ["templateRepo", "assignmentRepoName", "githubOrg"] as const
  ).filter((field) => !assignment[field]);

  if (missing.length > 0) {
    throw new AssignmentConfigurationError(
      `This assignment is a ${AssignmentKind.REPO} assignment with no ${missing.join(", ")}. ` +
        `Those are required for every repository-backed assignment — set them on the ` +
        `assignment before anyone accepts or is graded.`,
    );
  }

  return {
    templateRepo: assignment.templateRepo!,
    assignmentRepoName: assignment.assignmentRepoName!,
    githubOrg: assignment.githubOrg!,
    templateRef: assignment.templateRef ?? null,
  };
}

const sectionSchema = z
  .object({
    type: z.enum(SECTION_TYPES),
    /**
     * What this section alone is worth. Required, because a section reaching the model
     * without one is refused rather than defaulted: told nothing about the maximum, a
     * model invents a denominator and a plausible score against an invented denominator
     * cannot be told apart downstream from a real one.
     */
    pointValue: z.number().int().positive(),
    rubricId: z.string().uuid(),
    /** Paths inside the answer-keys repository, relative to `answer-keys/`. */
    answerKeyPaths: z.array(z.string().min(1)).default([]),
    reportTemplate: z.string().min(1).optional(),
    /** Absent means no deterministic evidence constrains this section. */
    evidence: z.literal("tests").optional(),
    /** Absent with `evidence: "tests"` means the whole suite counts toward it. */
    testNamePattern: z.string().min(1).optional(),
  })
  .strict()
  .refine((section) => !(section.testNamePattern && section.evidence !== "tests"), {
    message:
      'testNamePattern only has an effect with evidence: "tests". Without it the pattern ' +
      "is silently ignored and the section is graded with no test evidence at all, which " +
      "is the opposite of what naming a pattern means.",
    path: ["testNamePattern"],
  });

export type AssignmentSectionSpec = z.infer<typeof sectionSchema>;

/**
 * The assignment total is the sum of its sections, never entered separately. A
 * gradebook column that disagreed with the reports beneath it would be worse than no
 * column at all.
 */
export function sectionsPointTotal(sections: readonly { pointValue: number }[]): number {
  return sections.reduce((total, section) => total + section.pointValue, 0);
}

/** A GitHub owner or repository name: what GitHub itself accepts. */
const githubName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, "may contain only letters, numbers, dot, underscore, and hyphen");

const shared = {
  title: z.string().min(1).max(200),
  /**
   * Must be one of the course's own `moduleStructure` entries, and is the first path
   * segment inside the answer-keys repository. Checked against the course by the
   * procedure — this schema cannot see the database.
   */
  moduleTag: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, numbers, and hyphens"),
  dueAt: z.date().nullable().default(null),
  completionThreshold: z.number().gt(0).lte(1).default(0.75),
  sections: z.array(sectionSchema).min(1, "an assignment needs at least one gradable section"),
};

/**
 * Fields that only mean something for a repository-backed assignment, spelled out as
 * `null` for the other kinds rather than omitted. Being explicit is what makes the
 * union exhaustive: adding a kind that forgets to say `templateRepo: null` fails to
 * compile instead of silently inheriting whatever was there.
 */
const noRepository = {
  templateRepo: z.null().default(null),
  assignmentRepoName: z.null().default(null),
  githubOrg: z.null().default(null),
  templateRef: z.null().default(null),
  /**
   * No repository means no template to take a suite from, so there is nothing to run.
   * `"none"` is a real preset and the ordinary state of most assignments in the
   * program, not a degenerate case.
   */
  runnerPreset: z.literal("none").default("none"),
  runnerConfig: z.null().default(null),
};

export const assignmentSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(AssignmentKind.REPO),
      ...shared,
      /** "owner/repo" of the template a student's repository is generated from. */
      templateRepo: z
        .string()
        .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'must be "owner/repo"'),
      /**
       * The repository name prefix. Generated repositories are
       * `{assignmentRepoName}-{student github login}`, which is why this cannot change
       * once anybody has accepted.
       */
      assignmentRepoName: githubName,
      githubOrg: githubName,
      /**
       * Null means the template's default branch, which is what a running cohort wants:
       * a bug fixed in the template reaches every subsequent run. An exact commit SHA
       * archives a finished cohort so re-grading years later reproduces the original.
       */
      templateRef: z.string().min(7).nullable().default(null),
      /** Checked against `lib/sandbox/presets.ts` below, not just required to be non-empty. */
      runnerPreset: z.string().min(1).default("none"),
      runnerConfig: z.record(z.string(), z.unknown()).nullable().default(null),
    })
    .strict()
    /*
      An unknown preset here does not throw until a run is attempted at grading time,
      by which point a student is waiting on it. `resolveRunner` is pure — no database,
      no network — so there is nothing stopping the same check from running here.
    */
    .superRefine((spec, ctx) => {
      try {
        resolveRunner(spec);
      } catch (err) {
        if (!(err instanceof UnknownRunnerPresetError)) throw err;
        ctx.addIssue({
          code: "custom",
          path: ["runnerPreset"],
          message: `"${spec.runnerPreset}" is not a runner preset. See RUNNER_PRESETS in lib/sandbox/presets.ts.`,
        });
      }
    }),

  z.object({ kind: z.literal(AssignmentKind.GOOGLE_DOC), ...shared, ...noRepository }).strict(),
  z.object({ kind: z.literal(AssignmentKind.FILE_UPLOAD), ...shared, ...noRepository }).strict(),
]);

export type AssignmentSpec = z.infer<typeof assignmentSpecSchema>;

/**
 * Parses a spec and computes what the database columns should hold.
 *
 * `pointValue` is returned rather than accepted, which is the point: there is no input
 * an author could give that makes the total disagree with the sections.
 */
export function parseAssignmentSpec(input: unknown): AssignmentSpec & { pointValue: number } {
  const spec = assignmentSpecSchema.parse(input);
  return { ...spec, pointValue: sectionsPointTotal(spec.sections) };
}
