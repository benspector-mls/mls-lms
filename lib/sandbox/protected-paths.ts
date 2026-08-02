import type { PullRequestFileChange } from "../github/prs";
import { matchesProtectedPath } from "./presets";

/**
 * Protected paths: reporting what a student changed, and restoring it before the
 * suite runs.
 *
 * These are two separate obligations and conflating them is the mistake this
 * module exists to prevent. The instructor needs to know a student edited the
 * tests. The score has to be computed as if they had not. Neither substitutes for
 * the other: reporting without restoring lets an edited test decide the score,
 * and restoring without reporting hides the attempt.
 */

export type TamperedPath = {
  path: string;
  kind: PullRequestFileChange["kind"];
  previousPath?: string;
};

/**
 * The subset of a pull request's changes that touch grading infrastructure.
 *
 * A file *added* under `tests/` counts. Writing a new passing test file is as
 * effective at faking a result as editing an existing one, so additions are
 * reported alongside modifications and deletions.
 *
 * A rename is reported at both ends when the destination is protected, because
 * `git mv tests/a.spec.js tests/a.spec.js.bak` removes a suite by moving it
 * somewhere unprotected, and only the source path reveals that.
 */
export function findTamperedPaths(
  changes: PullRequestFileChange[],
  protectedPaths: string[],
): TamperedPath[] {
  const found: TamperedPath[] = [];

  for (const change of changes) {
    const destProtected = matchesProtectedPath(change.path, protectedPaths);
    const sourceProtected =
      change.previousPath !== undefined && matchesProtectedPath(change.previousPath, protectedPaths);

    if (!destProtected && !sourceProtected) continue;

    found.push({
      path: destProtected ? change.path : change.previousPath!,
      // A protected file renamed to an unprotected location is a removal from the
      // grading infrastructure's point of view, whatever GitHub calls it.
      kind: !destProtected && sourceProtected ? "removed" : change.kind,
      ...(change.previousPath ? { previousPath: change.previousPath } : {}),
    });
  }

  return found;
}

/**
 * package.json and its lockfile are excluded from the blanket overlay below and
 * handled afterward, because package.json is merged field by field rather than
 * replaced.
 */
const HANDLED_SEPARATELY = new Set(["package.json", "package-lock.json"]);

/**
 * Patterns come from preset configuration in this repository, never from student
 * input, so this validates against a typo in a config file rather than against an
 * attacker. A pattern that escaped the work directory would delete something
 * outside the student's tree, so it is worth refusing to run at all.
 */
function assertSafePattern(pattern: string): void {
  if (
    pattern.startsWith("/") ||
    pattern.includes("..") ||
    /[;&|`$(){}<>\n\\"']/.test(pattern)
  ) {
    throw new Error(
      `Unsafe protected path pattern ${JSON.stringify(pattern)} in lib/sandbox/presets.ts. ` +
      `Patterns must be repository-relative and may only use * and /** as wildcards.`,
    );
  }
}

/**
 * Builds one shell script that overlays every protected path.
 *
 * Each pattern removes the student's version first and then copies the template's
 * version if there is one. Removing first is what handles a file the student
 * *added* inside a protected directory: a new passing test file placed in `tests/`
 * is as effective at faking a result as editing an existing one, so the directory
 * is replaced wholesale rather than merged.
 *
 * A protected path the template does not have is removed and not replaced. That is
 * correct: grading infrastructure the assignment never shipped is not something
 * the student was asked to provide.
 *
 * Pure, so that what the overlay does to a given set of patterns can be checked
 * without creating a sandbox.
 */
export function buildRestoreScript(
  protectedPaths: string[],
  dirs: { workDir: string; templateDir: string; resultsDir: string },
): string {
  const lines: string[] = ["set -u"];

  for (const pattern of protectedPaths) {
    if (HANDLED_SEPARATELY.has(pattern)) continue;
    assertSafePattern(pattern);

    const work = `${dirs.workDir}/`;
    const template = `${dirs.templateDir}/`;

    if (pattern.endsWith("/**")) {
      const dir = pattern.slice(0, -3);
      lines.push(
        `rm -rf ${work}${dir}`,
        `if [ -e ${template}${dir} ]; then mkdir -p "$(dirname ${work}${dir})" && cp -R ${template}${dir} ${work}${dir}; fi`,
      );
    } else if (pattern.includes("*")) {
      // The glob may match nothing on either side, which is not an error. `set -u`
      // is on but nullglob is not, so an unmatched glob stays literal and the
      // existence test is what filters it out.
      lines.push(
        `rm -f ${work}${pattern}`,
        `for f in ${template}${pattern}; do [ -e "$f" ] && cp "$f" ${work}; done`,
      );
    } else {
      lines.push(
        `rm -f ${work}${pattern}`,
        `if [ -e ${template}${pattern} ]; then mkdir -p "$(dirname ${work}${pattern})" && cp ${template}${pattern} ${work}${pattern}; fi`,
      );
    }
  }

  // The test command writes its report here. Created now so a runner that cannot
  // create its own output directory is not mistaken for a runner that crashed.
  lines.push(`mkdir -p ${dirs.resultsDir}`, "exit 0");

  return lines.join("\n");
}

/**
 * package.json is merged field by field rather than restored wholesale.
 *
 * Restoring it wholesale would protect the `test` script, which is otherwise
 * trivially redirected to `echo ok`. But some assignments deliberately ask
 * students to install dependencies — an assignment on Node modules is precisely
 * about running `npm install` — and restoring the template's file would delete
 * the student's additions and fail their run on a missing module.
 *
 * Because package.json is JSON rather than an opaque blob, both concerns are
 * satisfiable at once.
 */

/**
 * Scalars the template owns outright. A student's value is discarded, and so is a
 * student's value for a key the template does not set at all: `"type": "module"`
 * added to a CommonJS assignment breaks the runner, and no assignment requires a
 * student to set it.
 */
const TEMPLATE_OWNED_SCALARS = ["type"] as const;

/**
 * Objects merged key by key with the template winning every collision. A student
 * may add a `start` script, because the template does not define one. A student
 * may not redefine `test`, because the template does.
 */
const PERMISSIVE_MERGE_OBJECTS = ["scripts"] as const;

/**
 * Inline runner configuration. The template's value is taken whole, and a block
 * the template does not have is removed rather than merged — a `jest` key the
 * template never carried is not something an assignment asks a student to add,
 * and `{"testMatch": []}` silently matches no tests at all.
 */
const TEMPLATE_OWNED_CONFIG_BLOCKS = [
  "jest",
  "vitest",
  "mocha",
  "eslintConfig",
  "babel",
] as const;

/** Where student additions are kept, subject to allowStudentDependencies. */
const DEPENDENCY_OBJECTS = ["dependencies", "devDependencies", "peerDependencies"] as const;

type JsonObject = Record<string, unknown>;

export type PackageJsonMergeResult = {
  merged: JsonObject;
  /**
   * Dotted keys the template asserted and the student had set differently, for
   * example "package.json#scripts.test". Reported so the instructor sees the
   * specific attempt rather than a whole-file difference.
   */
  overriddenKeys: string[];
};

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isPlainObject(value) ? value : {};
}

export function mergePackageJson(
  templatePkg: unknown,
  studentPkg: unknown,
  opts: { allowStudentDependencies: boolean },
): PackageJsonMergeResult {
  const template = asObject(templatePkg);
  const student = asObject(studentPkg);
  const overriddenKeys: string[] = [];

  // Start from the student's file, so keys neither side treats as grading
  // infrastructure — description, author, a browserslist block — survive.
  const merged: JsonObject = { ...student };

  for (const key of TEMPLATE_OWNED_SCALARS) {
    if (key in template) {
      if (key in student && student[key] !== template[key]) {
        overriddenKeys.push(`package.json#${key}`);
      }
      merged[key] = template[key];
    } else if (key in student) {
      overriddenKeys.push(`package.json#${key}`);
      delete merged[key];
    }
  }

  for (const key of PERMISSIVE_MERGE_OBJECTS) {
    const fromTemplate = asObject(template[key]);
    const fromStudent = asObject(student[key]);
    if (!(key in template) && !(key in student)) continue;

    const result: JsonObject = { ...fromStudent };
    for (const [name, value] of Object.entries(fromTemplate)) {
      if (name in fromStudent && fromStudent[name] !== value) {
        overriddenKeys.push(`package.json#${key}.${name}`);
      }
      result[name] = value;
    }
    merged[key] = result;
  }

  for (const key of TEMPLATE_OWNED_CONFIG_BLOCKS) {
    if (key in template) {
      if (key in student && JSON.stringify(student[key]) !== JSON.stringify(template[key])) {
        overriddenKeys.push(`package.json#${key}`);
      }
      merged[key] = template[key];
    } else if (key in student) {
      overriddenKeys.push(`package.json#${key}`);
      delete merged[key];
    }
  }

  for (const key of DEPENDENCY_OBJECTS) {
    const fromTemplate = asObject(template[key]);
    const fromStudent = asObject(student[key]);
    if (!(key in template) && !(key in student)) continue;

    if (!opts.allowStudentDependencies) {
      // Restored wholesale. Any addition the student made is a change to a
      // protected path and is reported as one.
      for (const name of Object.keys(fromStudent)) {
        if (!(name in fromTemplate)) overriddenKeys.push(`package.json#${key}.${name}`);
      }
      if (key in template) merged[key] = fromTemplate;
      else delete merged[key];
      continue;
    }

    // Student additions are kept. The template still wins on a collision, so a
    // version the assignment specifies cannot be replaced with a different one.
    const result: JsonObject = { ...fromStudent };
    for (const [name, value] of Object.entries(fromTemplate)) {
      if (name in fromStudent && fromStudent[name] !== value) {
        overriddenKeys.push(`package.json#${key}.${name}`);
      }
      result[name] = value;
    }
    merged[key] = result;
  }

  return { merged, overriddenKeys };
}
