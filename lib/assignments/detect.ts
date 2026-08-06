import "server-only";

import { getConfiguredInstallationId } from "../github/app-client";
import { fetchRepoFile } from "../github/files";
import { NO_RUNNER, RUNNER_PRESETS } from "../sandbox/presets";

/**
 * Reading a template repository to work out how its tests run.
 *
 * The alternative was asking, and asking was worse: an instructor picking `node-jest` from a
 * list is guessing at something the repository already states, and picking wrong means a
 * `python-pytest` assignment tries `npx jest` and reports an infrastructure failure that looks
 * like a sandbox defect.
 *
 * Deliberately narrow. This detects the runner and nothing else — not section types, not point
 * values. Point values are a curriculum judgment no file states, and section types are
 * *declared* by the assignment and checked against the submission by `classifySections`, so
 * inferring them here would replace a declaration with a second guess at the same thing.
 */

export type RunnerDetection = {
  preset: string;
  /** Why, in words an instructor can check against the repository themselves. */
  reason: string;
  /** False when nothing was found and `none` is a fallback rather than a finding. */
  confident: boolean;
};

/** Dependency name to preset, in the order they are looked for. */
const BY_DEPENDENCY: [string, string][] = [
  ["jest", "node-jest"],
  ["vitest", "node-vitest"],
];

/**
 * What to answer when there is no repository to read yet.
 *
 * Exported so the procedure can return it without reaching the network on a field an
 * instructor is still halfway through typing. `confident: false` is what keeps the form from
 * applying it — a detection nobody made must not set the runner to `none`.
 */
export const NOT_A_REPOSITORY: RunnerDetection = {
  preset: NO_RUNNER,
  reason: "That is not a GitHub repository, so nothing was read.",
  confident: false,
};

export async function detectRunnerPreset(templateRepo: string): Promise<RunnerDetection> {
  const [owner, repo] = templateRepo.split("/");
  if (!owner || !repo) return NOT_A_REPOSITORY;

  const installationId = getConfiguredInstallationId();
  const read = (path: string) =>
    fetchRepoFile(installationId, { owner, repo, ref: "HEAD", path });

  const [packageJson, requirements] = await Promise.all([
    read("package.json"),
    read("requirements.txt"),
  ]);

  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const declared = { ...parsed.dependencies, ...parsed.devDependencies };

      for (const [dependency, preset] of BY_DEPENDENCY) {
        if (declared[dependency] && preset in RUNNER_PRESETS) {
          return {
            preset,
            reason: `${templateRepo} depends on ${dependency}.`,
            confident: true,
          };
        }
      }

      return {
        preset: NO_RUNNER,
        // Said this precisely rather than as "no tests found": a package.json with no test
        // dependency is a deliberate state for most of this program, not a missing file.
        reason: `${templateRepo} has a package.json but no test dependency.`,
        confident: true,
      };
    } catch {
      return {
        preset: NO_RUNNER,
        reason: `${templateRepo} has a package.json that is not valid JSON.`,
        confident: false,
      };
    }
  }

  if (requirements && "python-pytest" in RUNNER_PRESETS) {
    return {
      preset: "python-pytest",
      reason: `${templateRepo} has a requirements.txt.`,
      confident: true,
    };
  }

  return {
    preset: NO_RUNNER,
    reason: `${templateRepo} has no package.json or requirements.txt, so nothing runs it.`,
    confident: true,
  };
}
