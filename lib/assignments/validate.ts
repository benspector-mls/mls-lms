import "server-only";

import { checkAnswerKeyPaths, listAssignmentDirs } from "../grade/assets";
import { getConfiguredInstallationId, isGithubAppConfigured } from "../github/app-client";
import { getRepo } from "../github/repos";
import type { db as Db } from "../prisma";
import {
  assignmentSpecSchema,
  isAiGraded,
  RUBRIC_NAME_BY_SECTION_TYPE,
  repositorySource,
  requiresRepository,
  sectionsPointTotal,
  type AiSectionSpec,
  type AssignmentSpec,
} from "./spec";

/**
 * Validating an assignment against the real sources, before it can be saved.
 *
 * One function, called by the form as fields change *and* by `create` and `update` before
 * they write. That is the point of it being here rather than inside a procedure: a check
 * the form performs and the write does not is decoration, and a check the write performs
 * and the form does not is a refusal an instructor meets only after filling everything in.
 *
 * Why validate at all, when the schema already describes the shape: an assignment's
 * `sections` array decides which rubric applies, which answer keys are loaded, and which
 * tests count as evidence. A mistyped answer key path or a wrong `moduleTag` does not
 * throw at grading time — it produces a confident wrong grade, or a manual-review reason
 * whose cause is not obvious hours later. Every field below has something real to check
 * against, which is what makes refusing to save cheaper than discovering it afterwards.
 */

export type FindingSeverity = "error" | "warning";

export type ValidationFinding = {
  /** Dotted path into the submitted draft, so the form can put the message on the field. */
  path: string;
  message: string;
  /**
   * `error` blocks saving. `warning` does not, and is for the things that are legitimately
   * true of a saved assignment: a missing answer key means grading proceeds without a
   * reference solution, which is worse but not useless, and an assignment the curriculum
   * no longer holds a directory for has been renamed upstream rather than broken.
   */
  severity: FindingSeverity;
};

export type ValidationResult = {
  findings: ValidationFinding[];
  /** The point total the sections imply, so the form can show it without computing it. */
  pointValue: number | null;
  /** Present only when the draft parsed; `create` writes from this rather than from input. */
  spec: AssignmentSpec | null;
};

export type DraftInput = {
  courseId: string;
  /** Set when editing, so the repository-name collision check can ignore this row. */
  assignmentId?: string;
  draft: unknown;
};

export function hasErrors(findings: readonly ValidationFinding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}

export async function validateAssignmentDraft(
  db: typeof Db,
  input: DraftInput,
): Promise<ValidationResult> {
  const findings: ValidationFinding[] = [];
  const error = (path: string, message: string) =>
    findings.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) =>
    findings.push({ path, message, severity: "warning" });

  // ---- Shape first. Nothing below can run against a draft that is not a spec. ----
  const parsed = assignmentSpecSchema.safeParse(input.draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "(root)";
      const keys = (issue as { keys?: string[] }).keys;
      error(keys?.length ? `${path}.${keys[0]}` : path, issue.message);
    }
    return { findings, pointValue: null, spec: null };
  }

  const spec = parsed.data;
  const pointValue = sectionsPointTotal(spec.sections);

  // ---- The course, which decides what module tags are legitimate ----
  const course = await db.course.findUnique({
    where: { id: input.courseId },
    select: { id: true, moduleStructure: true },
  });

  if (!course) {
    error("courseId", "That course does not exist.");
    return { findings, pointValue, spec };
  }

  const moduleStructure = Array.isArray(course.moduleStructure)
    ? (course.moduleStructure as unknown[]).filter((tag): tag is string => typeof tag === "string")
    : [];

  /*
    A module tag outside the course's own structure is refused rather than warned about. It
    is the first path segment inside the answer-keys repository, so a wrong one means every
    answer key path built from it is wrong too — and it decides where the assignment sorts
    in the course, so a typo produces an assignment that appears in no module.
  */
  if (moduleStructure.length > 0 && !moduleStructure.includes(spec.moduleTag)) {
    error(
      "moduleTag",
      `"${spec.moduleTag}" is not one of this course's modules (${moduleStructure.join(", ")}).`,
    );
  }

  // ---- Names must not collide with another assignment in the same course ----
  if (spec.assignmentRepoName) {
    const collision = await db.assignment.findFirst({
      where: {
        courseId: input.courseId,
        assignmentRepoName: spec.assignmentRepoName,
        ...(input.assignmentId ? { id: { not: input.assignmentId } } : {}),
      },
      select: { id: true, title: true },
    });
    if (collision) {
      error(
        "assignmentRepoName",
        `"${collision.title}" in this course already generates repositories named ` +
          `${spec.assignmentRepoName}-{github login}. Two assignments cannot share that.`,
      );
    }
  }

  // ---- Rubrics: the row has to exist, and has to be the one for that section type ----
  // Built with a loop rather than filter+map so `isAiGraded` narrows the type on its own,
  // without a cast asserting what the guard already proves.
  const aiSections: { section: AiSectionSpec; index: number }[] = [];
  spec.sections.forEach((section, index) => {
    if (isAiGraded(section)) aiSections.push({ section, index });
  });

  if (aiSections.length > 0) {
    const rubrics = await db.rubric.findMany({
      where: { id: { in: aiSections.map((entry) => entry.section.rubricId) } },
      select: { id: true, name: true },
    });
    const rubricById = new Map(rubrics.map((rubric) => [rubric.id, rubric.name]));

    for (const { section, index } of aiSections) {
      const name = rubricById.get(section.rubricId);
      const expected = RUBRIC_NAME_BY_SECTION_TYPE[section.type];

      if (!name) {
        error(`sections.${index}.rubricId`, "That rubric does not exist.");
      } else if (name !== expected) {
        // Checked rather than trusted: a section graded against the wrong rubric produces a
        // confident report against criteria that do not apply to the work.
        error(
          `sections.${index}.rubricId`,
          `A ${section.type} section is graded against ${expected}, not ${name}.`,
        );
      }
    }
  }

  // ---- Answer keys, checked against the repository the pipeline reads ----
  const keyPaths = aiSections.flatMap(({ section, index }) =>
    section.answerKeyPaths.map((path) => ({ path, index })));

  if (keyPaths.length > 0) {
    try {
      const checked = await checkAnswerKeyPaths(keyPaths.map((entry) => entry.path));
      checked.forEach((result, position) => {
        if (result.found) return;
        const { index } = keyPaths[position];
        const path = `sections.${index}.answerKeyPaths`;
        // A traversal is a refusal; a path that simply is not there is a warning, because
        // grading records it and continues rather than failing.
        if ((result.reason ?? "").includes("escapes")) error(path, result.reason ?? "Refused.");
        else warn(path, `${result.path} is not in the answer keys.`);
      });
    } catch (err) {
      warn(
        "sections",
        `Could not check the answer keys: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /*
    Whether the curriculum still holds a directory for this assignment.

    A warning rather than an error, and surfaced deliberately: an assignment whose directory
    has gone has been renamed or retired upstream, which is a curriculum change worth seeing
    on the authoring screen rather than as a grading failure weeks later.
  */
  if (spec.assignmentRepoName) {
    try {
      const known = await listAssignmentDirs(spec.moduleTag);
      if (known.length > 0 && !known.includes(spec.assignmentRepoName)) {
        warn(
          "assignmentRepoName",
          `The answer-keys repository has no ${spec.moduleTag}/${spec.assignmentRepoName} ` +
            `directory, so this assignment has no reference solutions. It may have been ` +
            `renamed or retired.`,
        );
      }
    } catch {
      // Already reported by the answer-key check when it matters; a second message about
      // the same unreachable repository is noise.
    }
  }

  // ---- The template repository has to exist and be visible to the App ----
  if (requiresRepository(spec.kind)) {
    let source;
    try {
      source = repositorySource(spec);
    } catch (err) {
      error("templateRepo", err instanceof Error ? err.message : String(err));
      source = null;
    }

    if (source) {
      if (!isGithubAppConfigured()) {
        warn("templateRepo", "The GitHub App is not configured here, so it was not checked.");
      } else {
        const [owner, repo] = source.templateRepo.split("/");
        const found = await getRepo(getConfiguredInstallationId(), { owner, repo });
        if (!found) {
          // An error, not a warning: accepting this assignment would fail for every
          // student, and it fails at the moment a student presses the button.
          error(
            "templateRepo",
            `${source.templateRepo} is not visible to the GitHub App. Check the name, and ` +
              `that the App is installed on ${owner}.`,
          );
        }
      }
    }
  }

  return { findings, pointValue, spec };
}
