import "server-only";

import { checkAnswerKeyPaths } from "../grade/assets";
import {
  getConfiguredInstallationId,
  installationIdForOwner,
  isGithubAppConfigured,
} from "../github/app-client";
import { getRepo } from "../github/repos";
import type { db as Db } from "../prisma";
import {
  assignmentSpecSchema,
  isAiGraded,
  RUBRIC_NAME_BY_SECTION_TYPE,
  repositorySource,
  requiresRepository,
  sectionsPointTotal,
  withDerivedFields,
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
 * tests count as evidence. A mistyped answer key path or a module from another course does not
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
  //
  // Derived fields are filled in before parsing, not after: `evidence` follows from the
  // section type and the runner, so a draft that omits it is complete rather than wrong.
  const parsed = assignmentSpecSchema.safeParse(withDerivedFields(input.draft));
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

  // ---- The course, and whether the module belongs to it ----
  const course = await db.course.findUnique({
    where: { id: input.courseId },
    select: { id: true },
  });

  if (!course) {
    error("courseId", "That course does not exist.");
    return { findings, pointValue, spec };
  }

  /*
    A module of a *different* course is the failure this catches, and it is the reason the
    check reads the row rather than trusting the id. The foreign key guarantees the module
    exists; nothing at the database level says it belongs to the course the assignment is
    being created in, so without this an instructor could file an assignment under another
    cohort's module and it would appear in neither course's list.
  */
  const assignedModule = await db.module.findUnique({
    where: { id: spec.moduleId },
    select: { id: true, courseId: true, name: true },
  });

  if (!assignedModule) {
    error("moduleId", "That module does not exist. Create it before adding assignments to it.");
  } else if (assignedModule.courseId !== input.courseId) {
    error("moduleId", "That module belongs to a different course.");
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

  // ---- The two repositories an assignment names ----
  if (requiresRepository(spec.kind)) {
    let source;
    try {
      source = repositorySource(spec);
    } catch (err) {
      error("templateRepo", err instanceof Error ? err.message : String(err));
      source = null;
    }

    if (!isGithubAppConfigured()) {
      warn("templateRepo", "The GitHub App is not configured here, so it was not checked.");
    } else if (source) {
      // Both at once. They are separate organizations, separate installations, and separate
      // round trips, and an instructor filling in a form should not wait for one to finish
      // before the other starts.
      await Promise.all([
        checkTemplate(source.templateRepo, error),
        checkAnswerKeyRepo(spec.answerKeyRepo, error),
      ]);
    }
  }

  // ---- Answer keys, checked against the repository this assignment names ----
  const keyPaths = aiSections.flatMap(({ section, index }) =>
    section.answerKeyPaths.map((path) => ({ path, index })));

  if (keyPaths.length > 0 && spec.answerKeyRepo) {
    try {
      const checked = await checkAnswerKeyPaths(
        spec.answerKeyRepo,
        keyPaths.map((entry) => entry.path),
      );
      checked.forEach((result, position) => {
        if (result.found) return;
        const { index } = keyPaths[position];
        const path = `sections.${index}.answerKeyPaths`;
        // A traversal is a refusal; a path that simply is not there is a warning, because
        // grading records it and continues rather than failing.
        if ((result.reason ?? "").includes("escapes")) error(path, result.reason ?? "Refused.");
        else warn(path, `${result.path} is not in ${spec.answerKeyRepo}.`);
      });
    } catch (err) {
      warn(
        "sections",
        `Could not check the answer keys: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { findings, pointValue, spec };
}

type Report = (path: string, message: string) => void;

/**
 * The template has to be readable by the installation that will generate from it, and it has
 * to be a template repository.
 *
 * Errors rather than warnings, because both fail at the moment a student presses Accept
 * rather than at grading time — and the student is the one who finds out.
 *
 * **Read through the configured installation specifically**, which is the one
 * `generateRepoFromTemplate` uses. Probing with any installation that happens to be able to
 * see the repository would answer a different question than the one that matters, and would
 * pass an assignment whose Accept then fails.
 *
 * **Being private is not a failure.** A private template in an organization this
 * deployment's installation covers generates perfectly well, which is how every assignment
 * in the sandbox organization works. What being public buys is reach: a public template can
 * be named wherever it lives, because an installation token reads any public repository.
 * That distinction belongs in the message on a failed read rather than in a rule that
 * refuses a working arrangement.
 *
 * The template flag is checked because `generate` refuses a repository that is not one, with
 * a message about the API rather than about the assignment. An ordinary repository is an easy
 * mistake to make: it looks right, it reads right, and it can be cloned — it just cannot be
 * generated from.
 */
async function checkTemplate(templateRepo: string, error: Report): Promise<void> {
  const [owner, repo] = templateRepo.split("/");
  const found = await getRepo(getConfiguredInstallationId(), { owner, repo });

  if (!found) {
    error(
      "templateRepo",
      `${templateRepo} cannot be read, so nothing can be generated from it. Check the ` +
        `name. If it is private, it has to be in an organization this deployment's GitHub ` +
        `App installation covers — a public template can be anywhere.`,
    );
    return;
  }

  if (!found.is_template) {
    error(
      "templateRepo",
      `${templateRepo} exists but is not a template repository, so nothing can be ` +
        `generated from it. Turn on "Template repository" in its settings, or name one ` +
        `that already is.`,
    );
  }
}

/**
 * The answer-key repository has to exist and be readable by an installation.
 *
 * **Two failures that must not be reported as one.** GitHub answers 404 both for a
 * repository that does not exist and for a private one in an organization the App was never
 * installed on, because from an unauthorized caller's position those are the same thing.
 * They are not the same thing to the person reading the message: the first is a typo they
 * fix in seconds, and the second is an installation nobody can perform from this form. Told
 * apart by asking whether the App is installed on the owner at all, which is a question the
 * App can answer about itself.
 */
async function checkAnswerKeyRepo(answerKeyRepo: string | null, error: Report): Promise<void> {
  if (!answerKeyRepo) return;
  const [owner, repo] = answerKeyRepo.split("/");

  const installationId = await installationIdForOwner(owner);
  if (installationId === null) {
    error(
      "answerKeyRepo",
      `The GitHub App is not installed on ${owner}, so nothing there can be read — ` +
        `including a private repository. Install it on that organization, then try again. ` +
        `If ${owner} is not where the answer keys live, correct the name.`,
    );
    return;
  }

  const found = await getRepo(installationId, { owner, repo });
  if (!found) {
    error(
      "answerKeyRepo",
      `${owner} has no repository called ${repo} that this App can see. Check the name — ` +
        `the App is installed on ${owner}, so a repository that exists there would be ` +
        `readable unless it was excluded from the installation.`,
    );
    return;
  }

  if (!found.private) {
    // A warning would be the wrong severity. Reference solutions in a public repository are
    // available to every student in the program, which is not a configuration detail.
    error(
      "answerKeyRepo",
      `${answerKeyRepo} is public, so its reference solutions can be read by anyone — ` +
        `including the students being graded against them. Make it private.`,
    );
  }
}
