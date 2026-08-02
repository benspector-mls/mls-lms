import "server-only";

import { RESULTS_DIR, TEMPLATE_DIR, WORK_DIR, readTextFile, runCommand, type SandboxHandle } from "./e2b";
import type { ResolvedRunner } from "./presets";
import { buildRestoreScript, mergePackageJson } from "./protected-paths";

/**
 * Overlaying the template's grading infrastructure onto the student's tree.
 *
 * This is what makes the result independent of anything the student did to their
 * own copy of the tests. A student who deletes every assertion changes nothing,
 * because their assertions are not the ones that run.
 *
 * Restoring is separate from reporting. What the student changed is already known
 * from the pull request's diff, recorded before any of this happens, so the
 * overlay can be destructive without losing the finding.
 *
 * The script this runs is built by a pure function in protected-paths.ts, so that
 * what the overlay does to a given set of patterns is checkable without a sandbox.
 */

export type RestoreOutcome = {
  /**
   * Keys in package.json the template asserted and the student had set
   * differently, such as "package.json#scripts.test". Appended to the tamper
   * report, because the pull request diff can only say that package.json changed.
   */
  overriddenPackageKeys: string[];
};

/**
 * Runs the overlay, then merges package.json.
 *
 * Order matters. The overlay is destructive, so the merge has to read the
 * student's package.json before it and write the result after it. It reads the
 * file out of the sandbox rather than out of the tarball because the tarballs are
 * never unpacked on the server.
 */
export async function restoreProtectedPaths(
  handle: SandboxHandle,
  runner: ResolvedRunner,
): Promise<RestoreOutcome> {
  const protectsPackageJson = runner.protectedPaths.includes("package.json");

  // Read before the overlay runs, since it may remove or replace the file.
  const studentPackageRaw = protectsPackageJson
    ? await readTextFile(handle, `${WORK_DIR}/package.json`)
    : null;

  const script = buildRestoreScript(runner.protectedPaths, {
    workDir: WORK_DIR,
    templateDir: TEMPLATE_DIR,
    resultsDir: RESULTS_DIR,
  });
  const result = await runCommand(handle, { command: script, timeoutMs: 60_000 });
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not restore protected paths (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`,
    );
  }

  if (!protectsPackageJson) return { overriddenPackageKeys: [] };

  const templatePackageRaw = await readTextFile(handle, `${TEMPLATE_DIR}/package.json`);
  if (!templatePackageRaw) {
    // A Python assignment, or any template with no package.json. Nothing to merge,
    // and nothing was wrong.
    return { overriddenPackageKeys: [] };
  }

  let templatePkg: unknown;
  let studentPkg: unknown;
  try {
    templatePkg = JSON.parse(templatePackageRaw);
  } catch {
    throw new Error(
      "The template's package.json is not valid JSON. This is a problem with the " +
      "assignment template, not with the student's submission.",
    );
  }
  try {
    studentPkg = studentPackageRaw ? JSON.parse(studentPackageRaw) : {};
  } catch {
    // A student can commit a broken package.json, and that must not read as an
    // infrastructure failure. Fall back to the template's file: the suite then
    // runs, and their syntax error shows up as whatever it actually breaks.
    studentPkg = {};
  }

  const { merged, overriddenKeys } = mergePackageJson(templatePkg, studentPkg, {
    allowStudentDependencies: runner.allowStudentDependencies,
  });

  await handle.sandbox.files.write(
    `${WORK_DIR}/package.json`,
    `${JSON.stringify(merged, null, 2)}\n`,
  );

  // The lockfile can only be restored when the merged package.json is guaranteed to
  // match it, which is exactly when the student was not allowed to add anything.
  // `npm ci` exists to fail when the two disagree, so restoring a lockfile
  // alongside a merged manifest would break every run.
  if (!runner.allowStudentDependencies) {
    const restoreLock = await runCommand(handle, {
      command:
        `rm -f ${WORK_DIR}/package-lock.json; ` +
        `if [ -e ${TEMPLATE_DIR}/package-lock.json ]; then cp ${TEMPLATE_DIR}/package-lock.json ${WORK_DIR}/package-lock.json; fi; exit 0`,
      timeoutMs: 30_000,
    });
    if (restoreLock.exitCode !== 0) {
      throw new Error(`Could not restore package-lock.json: ${restoreLock.stderr.slice(0, 300)}`);
    }
  }

  return { overriddenPackageKeys: overriddenKeys };
}
