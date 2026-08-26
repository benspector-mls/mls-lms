import { z } from "zod";

import { isSectionType, SECTION_TYPES, type SectionType } from "../section-types";
import { AssignmentKind, HandInMethod } from "../generated/prisma/enums";
import { resolveRunner, UnknownRunnerPresetError } from "../sandbox/presets";
import { UPLOAD_FILE_TYPE_KEYS, type UploadFileTypeKey } from "../uploads/file-types";
import { preprocessRepoRef } from "./repo-ref";

/**
 * What a valid assignment is.
 *
 * One definition, used by the seed and by the authoring procedures, so the seeded
 * shape and the authored shape cannot drift. Nothing here reads the database or the
 * network, so it is safe in the browser and can be checked as a pure function.
 *
 * The rule this module exists to hold: **an assignment's shape is validated where it
 * is written, not where it is graded.** A wrong module or a mistyped answer key
 * path does not throw at grading time — it produces a confident wrong grade, or a
 * manual-review reason whose cause is not obvious hours later.
 *
 * `kind` is what makes this a union rather than a flat object. A repository-backed
 * assignment needs three GitHub fields and can name a test runner; a Drive file or an
 * uploaded file has no repository to generate, no pull request to diff, and no suite
 * to execute. Those columns are nullable in the database because a column cannot
 * express "required for one kind" — this schema is where the requirement lives.
 */

export { AssignmentKind, HandInMethod };

/**
 * The section types, and the rubric each is graded against, both from `lib/section-types.ts`.
 *
 * Re-exported rather than moved-and-forgotten: this module is where the section *schema* lives,
 * so a reader validating a section here should not have to know that the vocabulary it draws on
 * sits one directory up. `SectionTypeName` is the old spelling, kept because it reads better in
 * this file's Zod schemas than `SectionType` does beside `AssignmentKind`.
 */
export { SECTION_TYPES, type SectionType as SectionTypeName } from "../section-types";

/**
 * Kinds the application can actually distribute, collect, and grade today.
 *
 * Separate from the enum on purpose. The enum names the axis so that every code path
 * assuming a repository has to say so; this set says which of them are built.
 *
 * All three are built. What differs between them is not whether they work but how far the
 * pipeline reaches: a `REPO` assignment is distributed from a template, collected as a pull
 * request, and graded by the model, while the other two are distributed as a link or as
 * instructions, collected as a link the student pastes or a file they upload, and graded by an
 * instructor typing the score and the feedback. Reading a Drive file's contents or an uploaded
 * file and generating a report from it is a separate feature and needs instructor-authored
 * rubrics.
 */
export const IMPLEMENTED_KINDS: ReadonlySet<AssignmentKind> = new Set([
  AssignmentKind.REPO,
  AssignmentKind.GOOGLE_DRIVE,
  AssignmentKind.SELF_DIRECTED,
]);

/** The parts of an assignment that say how it is handed in. Structural, so a test can pass a literal. */
export type HandInShape = {
  kind: AssignmentKind;
  /** Readonly, because every reader of this only asks what is in it. */
  handInMethods: readonly HandInMethod[];
};

/**
 * How an assignment is handed in: by pasting a link, by uploading a file, by both, or — for a
 * repository — by neither, since opening a pull request is not a form anything here draws.
 *
 * **This asks about an assignment, not about a kind, and that is the whole point.** Two kinds
 * have the answer fixed by what they hand out, and one leaves it to the instructor, so there is
 * no question a kind alone can answer any more. Every caller that used to compare kinds inline
 * asks this instead: `submitWork`, the upload route, and the student's screen all have to agree,
 * and a method admitted by one and refused by another is a student told to paste a link into a
 * form that will not take it.
 *
 * Exhaustive over the enum rather than a lookup with a fallback, so a fourth kind is a compile
 * error here — the same guarantee `assignments.accept`'s switch gives, and for the same reason.
 * `REPO` is empty rather than absent: it has a way in, and the way in is not one of these.
 */
export function handInMethodsFor(assignment: HandInShape): readonly HandInMethod[] {
  switch (assignment.kind) {
    case AssignmentKind.REPO:
      return [];
    case AssignmentKind.GOOGLE_DRIVE:
      return [HandInMethod.LINK];
    case AssignmentKind.SELF_DIRECTED:
      return assignment.handInMethods;
  }
}

/** True when this kind's submissions live in a generated GitHub repository. */
export function requiresRepository(kind: AssignmentKind): boolean {
  return kind === AssignmentKind.REPO;
}

/**
 * Kinds that hand something out, and therefore have an Accept step.
 *
 * A REPO assignment generates a repository from a template and a GOOGLE_DRIVE one builds a
 * `/copy` link, so for both of them there is something a student receives before there is
 * anything to hand in. SELF_DIRECTED hands out nothing at all: the first thing that happens to
 * one is the student submitting.
 *
 * Named here rather than compared inline, because two places on a student's screen have to
 * agree about it — whether the row draws an Accept button, and whether the row opens so the
 * submission form inside it can be reached. When those two disagreed, a self-directed
 * assignment showed a student "Not started" with no button and no way to open the row, which
 * is to say no way to submit at all. `assignments.accept` refuses the same kind.
 */
export function hasAcceptStep(kind: AssignmentKind): boolean {
  return kind === AssignmentKind.REPO || kind === AssignmentKind.GOOGLE_DRIVE;
}

export class UnsupportedAssignmentKindError extends Error {
  constructor(readonly kind: AssignmentKind) {
    super(
      `Assignments of kind ${kind} are not implemented. Only ` +
        `${[...IMPLEMENTED_KINDS].join(", ")} can be distributed, collected, or graded. ` +
        `See IMPLEMENTED_KINDS in lib/assignments/spec.ts.`,
    );
    this.name = "UnsupportedAssignmentKindError";
  }
}

/**
 * Asked for a repository that this kind of assignment does not have.
 *
 * Distinct from `UnsupportedAssignmentKindError` because it means the opposite thing. That
 * one says a kind is not built; this one says the kind is built and works, and the caller
 * asked it a question about repositories that does not apply — a Drive assignment has no template
 * to generate from and no pull request to diff. Reporting them as one another would tell an
 * instructor a working assignment is unimplemented.
 */
export class NotRepositoryBackedError extends Error {
  constructor(readonly kind: AssignmentKind) {
    super(
      `A ${kind} assignment has no repository: nothing is generated from a template and ` +
        `there is no pull request. Narrow on the kind before asking for one.`,
    );
    this.name = "NotRepositoryBackedError";
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
 * A pasted repository reference, stored as `owner/repo`.
 *
 * `z.preprocess` rather than a transform, so the normalization happens before the pattern
 * is checked and the pattern only ever sees one form. What reaches the column is what the
 * form displays, which is the property that makes a pasted URL and a typed `owner/repo` the
 * same field rather than two.
 */
const repoReference = (describe: string) =>
  z.preprocess(
    preprocessRepoRef,
    z
      .string()
      .regex(
        /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/,
        `${describe} must be a GitHub repository — paste its URL, or write owner/repo`,
      ),
  );

/**
 * Narrows the four nullable GitHub columns for a repository-backed assignment, or
 * throws saying which case this is.
 *
 * Every path that generates a repository, fetches a template, or names a student's
 * repository goes through here, so "this assignment has a repository" is asserted in
 * one place instead of at each use. Three failures, reported differently because an
 * instructor can act on one of them and not on the others: a kind that is not built at all
 * (`UnsupportedAssignmentKindError`), a working kind that simply has no repository
 * (`NotRepositoryBackedError` — the caller should not have asked), and a `REPO` row missing
 * `githubOrg` (`AssignmentConfigurationError` — a row that should never have been written,
 * and the only one of the three an instructor can fix).
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
    throw new NotRepositoryBackedError(assignment.kind);
  }

  const missing = (["templateRepo", "assignmentRepoName", "githubOrg"] as const).filter(
    (field) => !assignment[field],
  );

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

/**
 * What this section alone is worth.
 *
 * Required on both kinds of section, and never defaulted. For an AI-graded section it is
 * the denominator the model is told: given none, a model invents one, and a plausible
 * score against an invented denominator cannot be told apart downstream from a real one.
 * For a manually graded section it is what the instructor scores out of.
 */
const pointValue = z.number().int().positive();

/**
 * A section the pipeline grades: a rubric, answer keys, and optionally test evidence.
 */
const aiSectionSchema = z
  .object({
    grading: z.literal("ai"),
    type: z.enum(SECTION_TYPES),
    pointValue,
    rubricId: z.string().uuid(),
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

/**
 * A section an instructor grades by hand.
 *
 * No rubric, no answer keys, no section type, and deliberately no way to name any: a
 * reflection submitted as a Google Doc or a resume uploaded as a PDF has nothing the
 * pipeline can read and no `rubric.md` heading that describes it. Rather than let one be
 * created with a rubric that would never be applied, the shape refuses to hold one.
 *
 * `label` exists because `type` does not. An AI-graded section is named by its type in
 * the interface; a manual section needs something to call itself, and "Section 1" is
 * worse than what the instructor would have written.
 */
const manualSectionSchema = z
  .object({
    grading: z.literal("manual"),
    label: z.string().min(1).max(120),
    pointValue,
  })
  .strict();

const sectionSchema = z.discriminatedUnion("grading", [aiSectionSchema, manualSectionSchema]);

/**
 * Every section of an assignment is graded the same way: all by the pipeline, or all by hand.
 *
 * Refused rather than supported, and the reason is worth keeping. A mix is expressible in the
 * shape above and nothing in the curriculum has ever been one. Supporting it means a report
 * that covers some of an assignment's sections and not others, which is a second draft shape
 * for the review screen to render, a point total that has to be assembled from two sources,
 * and — the way it actually failed — a generated draft carrying only the AI sections, so the
 * assignment's own point value exceeded what approval could record and a 30-point assignment
 * released as 20 out of 20.
 *
 * The direction of travel is one section per assignment, so a coding exercise with a
 * hand-marked reflection is two assignments rather than one. Multi-section assignments stay
 * supported — the checkpoint really has two, both graded by the pipeline — because those are
 * what exists and separating them is a curriculum change made assignment by assignment.
 */
const sectionsSchema = z
  .array(sectionSchema)
  .min(1, "an assignment needs at least one gradable section")
  .superRefine((sections, ctx) => {
    const modes = new Set(sections.map((section) => section.grading));
    if (modes.size <= 1) return;

    ctx.addIssue({
      code: "custom",
      path: [],
      message:
        "Every section of an assignment has to be graded the same way. This one mixes " +
        "sections the pipeline grades with sections graded by hand, which no assignment " +
        "does — split it into two assignments instead.",
    });
  });

export type AssignmentSectionSpec = z.infer<typeof sectionSchema>;
export type AiSectionSpec = z.infer<typeof aiSectionSchema>;
export type ManualSectionSpec = z.infer<typeof manualSectionSchema>;

/** True when the pipeline can produce a report for this section. */
export function isAiGraded(section: AssignmentSectionSpec): section is AiSectionSpec {
  return section.grading === "ai";
}

/**
 * True when no section of this assignment can be graded by the pipeline.
 *
 * What the interface asks before offering to generate a report, and what
 * `generateReportForSubmission` should refuse on: an assignment with only manual sections
 * has nothing for a model to do, and offering the button would promise something that
 * cannot happen.
 */
export function isManualOnly(sections: unknown): boolean {
  const modes = sectionGradingModes(sections);
  // The length check is load-bearing: `every` is true for an empty array, and an
  // assignment with no sections at all is a configuration error rather than a manually
  // graded one.
  return modes.length > 0 && modes.every((mode) => mode === "manual");
}

/**
 * How each section of a stored `sections` column is graded.
 *
 * Takes `unknown` because the column is JSON and every caller holds it in that shape. This
 * is the one place that narrows it, so the three screens that ask whether an assignment can
 * be graded by the pipeline cannot each narrow it slightly differently — which is how
 * `isShortResponseFile` came to be written twice and drift.
 *
 * An entry with no `grading` at all counts as `ai`. Migration `20260804143312_section_grading`
 * backfilled the column so none should exist, and `ai` is the safe direction if one does: it
 * leaves the generate button in place on an assignment that has always had it, where the
 * reverse would quietly hide the only way to grade real work.
 */
/**
 * The hand-graded sections of a stored `sections` column, as the blank draft needs them.
 *
 * Reads the label and the point value and nothing else, because that is all a manual section
 * has: no rubric, no answer keys, no type. A row missing either is skipped rather than
 * defaulted — a section scored out of an invented total is the failure the whole
 * "`pointValue` is required and never defaulted" rule exists to prevent, and skipping it is
 * visible where a zero would not be.
 */
export function manualSections(sections: unknown): { label: string; pointValue: number }[] {
  return readSections(sections).flatMap((entry) => {
    if (entry.grading !== "manual") return [];
    if (typeof entry.label !== "string" || entry.label.length === 0) return [];
    if (typeof entry.pointValue !== "number" || !Number.isFinite(entry.pointValue)) return [];
    return [{ label: entry.label, pointValue: entry.pointValue }];
  });
}

export function sectionGradingModes(sections: unknown): ("ai" | "manual")[] {
  return readSections(sections).map((section) => (section.grading === "manual" ? "manual" : "ai"));
}

/**
 * The `sections` column as an array of entries, and the one place it is narrowed.
 *
 * It is a JSON column, so Prisma hands every reader a `JsonValue` and each of them was deciding
 * for itself what that meant: three defensive `Array.isArray` walks in this file, and an
 * `as unknown as AssignmentSection[]` in the report generator. The assertion is the dangerous
 * one — a column holding an object rather than an array satisfies it perfectly and then fails
 * further in, where the cause is no longer visible.
 *
 * **Deliberately not `assignmentSpecSchema`.** Parsing with Zod here would be stricter and
 * wrong: this reads rows that already exist, and a stored section that no longer satisfies the
 * current schema must still be *readable* — whether it can be graded is a separate question from
 * whether a screen can say it is there. Validation belongs where a section is written, which is
 * `validateAssignmentDraft`. This is the read side, and it guarantees only the shape every reader
 * already assumes.
 *
 * Entries that are not objects are dropped rather than kept as holes, because every caller
 * reaches into them and `null.grading` is a crash rather than a wrong answer.
 */
export function readSections(sections: unknown): Record<string, unknown>[] {
  if (!Array.isArray(sections)) return [];
  return sections.filter(
    (section): section is Record<string, unknown> =>
      typeof section === "object" && section !== null && !Array.isArray(section),
  );
}

/**
 * Whether a section's score is checked against the test suite.
 *
 * Derived, never asked. The rule has no cases an instructor could usefully disagree with: a
 * short response has nothing to execute, and every other section type is checked against the
 * suite whenever the assignment has one. Asking produced a checkbox whose only two settings
 * were "correct" and "silently graded without the evidence it should have had".
 *
 * `sections[].evidence` is still stored, because grading reads it and the flag it produces —
 * `TEST_EVIDENCE` against `NO_TESTS_EXPECTED` — is the difference between "checked" and
 * "nothing to check", which an instructor reading a report needs to see.
 */
export function derivesTestEvidence(sectionType: SectionType, runnerPreset: string): boolean {
  if (sectionType === "short_response") return false;
  return runnerPreset !== "none";
}

/**
 * Fills in every field that is derived rather than entered, before validation sees the draft.
 *
 * Applied on the server rather than in the form, so the derivation is not something a request
 * could disagree with. Takes an unknown draft because it runs *before* parsing: a draft that
 * turns out to be invalid should still be reported against the fields the author sees.
 */
export function withDerivedFields(draft: unknown): unknown {
  if (!draft || typeof draft !== "object") return draft;

  const record = draft as Record<string, unknown>;
  const runnerPreset = typeof record.runnerPreset === "string" ? record.runnerPreset : "none";
  if (!Array.isArray(record.sections)) return draft;

  return {
    ...record,
    sections: record.sections.map((section) => {
      if (!section || typeof section !== "object") return section;
      const entry = section as Record<string, unknown>;
      if (entry.grading !== "ai") return entry;

      const type = entry.type;
      if (typeof type !== "string" || !isSectionType(type)) return entry;

      const evidence = derivesTestEvidence(type, runnerPreset) ? "tests" : undefined;
      const next: Record<string, unknown> = { ...entry, evidence };
      // A pattern with no evidence declaration is refused by the schema, and rightly — it
      // reads as though the tests were consulted when they were not. Cleared with it rather
      // than left to produce a validation error the author cannot act on.
      if (!evidence) delete next.testNamePattern;
      if (next.evidence === undefined) delete next.evidence;
      return next;
    }),
  };
}

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
   * Which unit of the course this belongs to — a module, a project, or an assessment.
   *
   * An id rather than a name, so renaming a unit does not touch its assignments, and a foreign
   * key rather than a validation rule, so an assignment cannot belong to a unit that does not
   * exist. The procedure checks it is a unit of *this* course, which this schema cannot see.
   *
   * **One parent, and no derivation.** A deliverable of a project names the project here, the
   * same way an ordinary assignment names its module; there is no second field and no rule
   * turning one into the other.
   */
  courseUnitId: z.string().uuid(),
  dueAt: z.date().nullable().default(null),
  completionThreshold: z.number().gt(0).lte(1).default(0.75),
  sections: sectionsSchema,
  /**
   * How to turn this in, in markdown. Optional on every kind: each kind's own screen states
   * the mechanical steps already, so this is the assignment's own instructions rather than
   * the only thing standing between a student and knowing what to do.
   */
  submissionInstructions: z.string().trim().min(1).max(10_000).nullable().default(null),
  /**
   * The set of teams this is handed in by, or null for work each student does alone.
   *
   * **Pointing at a set is what makes an assignment team work.** There is no boolean beside it,
   * for the same reason there is no `category` field here to agree or disagree with the unit's:
   * two fields can disagree and nothing says which one is right.
   *
   * Shared across all four kinds. A team hands in one document, one file, one link or one
   * repository, and which of those it is changes where the work lives rather than whether it
   * belongs to a team. The procedure checks the set belongs to *this* course, which this schema
   * cannot see, and refuses a change once the assignment has been published.
   */
  teamSetId: z.string().uuid().nullable().default(null),
};

/**
 * Fields that only mean something for a repository-backed assignment, spelled out as
 * `null` for the other kinds rather than omitted. Being explicit is what makes the
 * union exhaustive: adding a kind that forgets to say `templateRepo: null` fails to
 * compile instead of silently inheriting whatever was there.
 */
const noRepository = {
  templateRepo: z.null().default(null),
  /**
   * No repository means no reference solutions.
   *
   * These kinds are all graded by hand, so there is nothing for a solution to be compared
   * against — and `noRepository` also forces every section to be manual, which is what
   * makes that true rather than merely likely.
   */
  answerKeyRepo: z.null().default(null),
  answerKeyDir: z.null().default(null),
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
  /**
   * Every section of a kind with no repository is graded by hand, and the shape refuses any
   * other. The pipeline's inputs are a pull request's changed files, the tests the template
   * holds, and the paths `classifySections` matches — a document has none of them, so an AI
   * section here would validate, save, sit in the queue as a report waiting to be generated,
   * and fail on the missing pull request at the moment an instructor asked for it. Refusing it
   * at authoring time is the difference between an assignment that cannot be built wrong and
   * one that breaks the first time it is used.
   *
   * Reading a document's contents and grading it is a real future feature. It needs Drive
   * access and instructor-authored rubrics, and this line is what changes when it exists.
   */
  sections: z
    .array(manualSectionSchema)
    .min(1, "an assignment needs at least one gradable section"),
};

/**
 * The mirror of `noRepository` for the upload column, spelled out as empty rather than
 * omitted for the same reason: a kind added later that forgets to say so fails to compile
 * instead of inheriting whatever the previous branch had.
 *
 * Empty rather than nullable, because "which file types does a Google Drive assignment
 * accept" has an answer — none, it is not handed in as a file — and an empty list says
 * that without a third state to interpret.
 */
const noUpload = {
  acceptedFileTypes: z.array(z.never()).max(0).default([]),
};

/**
 * The same for `handInMethods`, on the two kinds whose distribution already decides how the
 * work comes back: a pull request from a generated repository, a link to a copied Drive file.
 *
 * Empty rather than the true answer spelled out, because the column is not where that answer
 * lives — `handInMethodsFor` is, and it reads the kind for these two. Writing `["LINK"]` onto
 * every Drive assignment would put one fact in two places with nothing keeping them equal.
 */
const noHandInChoice = {
  handInMethods: z.array(z.never()).max(0).default([]),
};

/**
 * A Google Drive editor URL the copy prompt can be built from.
 *
 * Anchored on the editor, the file id, and the final path segment rather than accepting any
 * link, because `copyUrlFromTemplate` below works by replacing that segment: a URL this pattern
 * does not match is one the substitution would silently leave alone, sending every student to
 * the instructor's own file to edit in place. `/edit` is accepted as well as `/view` since that
 * is what Google's Share dialog actually hands over.
 *
 * **Three editors, named, rather than any Google address.** Docs, Sheets, and Slides build
 * their URLs the same way and take `/copy` the same way, which is what makes them one kind
 * rather than three. Widening to `docs.google.com/*` would admit a Form, a Drawing, a folder
 * listing, and a published `/pub` link — none of which the substitution produces a copy prompt
 * from, and every one of which would fail on the student's side rather than on the field where
 * it was typed.
 */
const GOOGLE_DRIVE_URL =
  /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]+\/(view|edit|preview)(\?[^#]*)?(#.*)?$/;

/**
 * Google's own "would you like to make a copy?" prompt for a Drive file.
 *
 * The whole of the Google Drive distribution mechanism. The application creates nothing, holds
 * no Google credentials, and touches no student's Drive — the copy is made by Google, on the
 * student's request, and belongs to them from the moment it exists. The alternative was Drive
 * API integration with OAuth against every student's Google account, which is a great deal of
 * machinery for something a link already does.
 *
 * The query string is dropped with the segment: `?usp=sharing` on a `/copy` URL is harmless
 * but meaningless, and keeping it would make the link look assembled rather than deliberate.
 */
export function copyUrlFromTemplate(templateDriveUrl: string): string {
  return templateDriveUrl.replace(/\/(view|edit|preview)(\?[^#]*)?(#.*)?$/, "/copy");
}

export const assignmentSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(AssignmentKind.REPO),
      ...shared,
      /**
       * The template a student's repository is generated from, pasted as a URL.
       *
       * **Public, and a template repository.** Public because an installation token can
       * read a public repository in an organization the App is not installed on — which is
       * what allows an instructor to name any template on GitHub rather than only ones in
       * their own organization. A template because `generate` refuses a repository that is
       * not one, and refusing it here is the difference between a message on the field and
       * every student's Accept failing.
       */
      templateRepo: repoReference("The template"),
      /**
       * The repository holding this assignment's reference solutions, pasted as a URL.
       *
       * Private, in an organization the App is installed on: a public answer-key repository
       * would publish the solutions.
       */
      answerKeyRepo: repoReference("The answer key repository"),
      /**
       * The directory inside it whose contents *are* the reference solutions.
       *
       * **Every file under it, at any depth, with nothing selected.** That is the whole
       * mechanism: an instructor pastes the address of the folder they already have open and
       * there is no second question. The alternative — storing the list of files — is the same
       * information right up until somebody adds a reference solution to the folder, at which
       * point the stored list is quietly wrong and nothing says so.
       *
       * `""` is the repository root, which is the right answer for a repository holding one
       * assignment's solutions and nothing else. Recognisable binaries are skipped and the
       * count is capped, both reported rather than silent — see `lib/grade/assets.ts`.
       */
      answerKeyDir: z
        .string()
        .default("")
        .refine(
          (dir) =>
            !dir.startsWith("/") &&
            !dir.split("/").some((segment) => segment === "." || segment === ".."),
          "must be a path inside the repository, with no leading slash and no . or .. segments",
        ),
      /**
       * The repository name prefix. Generated repositories are
       * `{courseSlug}-{assignmentRepoName}-{fellow github login}`, which is why this cannot change
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
      /** A repository assignment is distributed from a template, not from a document. */
      templateDriveUrl: z.null().default(null),
      ...noUpload,
      ...noHandInChoice,
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

  z
    .object({
      kind: z.literal(AssignmentKind.GOOGLE_DRIVE),
      ...shared,
      ...noRepository,
      /**
       * The Drive file every student takes their own copy of — a Doc, a Sheet, or a Slides
       * deck. Required, because without it there is no way to distribute the assignment at
       * all: a Drive assignment with no template is an instruction to write something
       * somewhere.
       */
      templateDriveUrl: z
        .string()
        .regex(
          GOOGLE_DRIVE_URL,
          "must be a Google Docs, Sheets, or Slides link ending in /view or /edit, e.g. " +
            "https://docs.google.com/document/d/<id>/view — that is what the copy prompt " +
            "is built from",
        ),
      ...noUpload,
      ...noHandInChoice,
    })
    .strict(),

  /**
   * Work the student made wherever they liked, handed in as a link to it, as a file, or as
   * either: a Canva design, a Loom recording, a slide deck, a reflection document.
   *
   * **No template and therefore no Accept**: there is nothing to hand out and nothing to copy,
   * so the assignment stays NOT_STARTED until the student submits, which is the one act.
   *
   * **`handInMethods` is the field this kind exists for.** An instructor who allows both is
   * saying the work matters and its format does not — which is what a choose-your-own-path
   * reflection is: a document from one student, a deck from another, a two-minute recording
   * from a third, all answering the same prompt and all graded against the same sections.
   *
   * **And no shape check on what the student submits.** A `GOOGLE_DRIVE` submission is checked
   * against Google's URL pattern because the assignment was distributed as one; here the
   * assignment did not say where the work lives, so there is no pattern to check against and any
   * https link is a legitimate answer. Refusing one would mean guessing which services are
   * allowed and being wrong the first time an instructor names a new one.
   *
   * **It has no field for a starting link, deliberately.** The obvious addition is a link to a
   * starting point for the student to copy, and the reason not to add it is that it would be a
   * second link doing what `submissionInstructions` already does better — that field is markdown,
   * so an instructor writes "start from [this Canva template](…)" alongside everything else the
   * student needs to know, rather than having a bare URL appear on the screen with no explanation
   * of what to do with it. A column would also imply the copy-prompt machinery `GOOGLE_DRIVE`
   * has, which no other service shares.
   */
  z
    .object({
      kind: z.literal(AssignmentKind.SELF_DIRECTED),
      ...shared,
      ...noRepository,
      templateDriveUrl: z.null().default(null),
      /**
       * How the student may hand it in, and at least one is required.
       *
       * An empty list is refused rather than read as "any way you like", because an assignment
       * nobody said how to hand in is one the student's screen can draw no form for at all.
       */
      handInMethods: z
        .array(z.enum([HandInMethod.LINK, HandInMethod.FILE]))
        .min(1, "say at least one way this assignment may be handed in")
        .refine((methods) => new Set(methods).size === methods.length, "no duplicates"),
      /**
       * Which kinds of file are accepted, when a file is one of the ways in.
       *
       * Not defaulted to "anything", because an assignment that accepts anything cannot
       * tell a student their file is wrong until an instructor opens it and finds a
       * screenshot where a PDF was wanted. The form ticks PDF by default; what it may not
       * do is save nothing. The `superRefine` below is what ties it to the method.
       */
      acceptedFileTypes: z
        .array(z.enum(UPLOAD_FILE_TYPE_KEYS as [UploadFileTypeKey, ...UploadFileTypeKey[]]))
        .default([])
        .refine((types) => new Set(types).size === types.length, "no duplicates"),
    })
    .strict()
    /*
      The one rule the union cannot express in its shape, because it depends on a value inside
      the branch rather than on the discriminant: file types are required when FILE is a way in
      and refused when it is not.

      Empty rather than nullable in the second case, by the same reasoning `noUpload` gives —
      "which file types does a link-only assignment accept" has an answer, and it is none. An
      instructor who ticks File, chooses PDF, then unticks File would otherwise leave a set of
      types behind that nothing reads and the next reader has to wonder about.
    */
    .superRefine((spec, ctx) => {
      const takesFile = spec.handInMethods.includes(HandInMethod.FILE);

      if (takesFile && spec.acceptedFileTypes.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["acceptedFileTypes"],
          message: "say at least one kind of file this assignment accepts",
        });
      }

      if (!takesFile && spec.acceptedFileTypes.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["acceptedFileTypes"],
          message:
            "this assignment is not handed in as a file, so it accepts no file types — " +
            "tick File above if it should",
        });
      }
    }),
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
