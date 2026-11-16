import "server-only";

import path from "node:path";

import { db } from "../prisma";
import { NO_RULE_SET_MESSAGE } from "../rubrics/versions";

/**
 * What one section is graded against: the rubric, the rule set, the sample report, and the
 * reference solutions.
 *
 * **Two sources, read differently.**
 *
 * - *The rubric, its guidance, its sample report and the rule set* are rows in this database —
 *   `Rubric`, `RubricVersion`, `RuleSet`, `RuleSetVersion` — written in the application. They
 *   used to be files in the grading-guides repository, and `scripts/port-rubrics.ts` is what
 *   moved them; `GRADING_ASSETS_REPO` now serves that script and `calibrate`, which still reads
 *   the sample submissions out of the toolkit.
 * - *Answer keys* come from the repository the assignment itself names, at the paths it
 *   itself names, over the GitHub API. That is what lets a new cohort keep its reference
 *   solutions wherever it likes, and what stops the curriculum's directory layout from being a
 *   constraint on the application.
 *
 * Every draft section records the rubric version and the rule set version it was scored
 * against, and the commit the answer keys were read at, so a report traces back to the exact
 * text that produced it. Answer keys are fetched at that commit rather than at a branch name: a
 * run taking ninety seconds must not read half its keys from before a push and half from after.
 */

export type GradingAssets = {
  /** The rule set: tone, layout and labels. The program's, unless the rubric names its own. */
  agentRules: string;
  /** The rubric's current text. */
  rubricSection: string;
  /** How this rubric's points add up and what each row of the report is. */
  guidance: string;
  /** A finished report of the shape the output should take, or null for a rubric without one. */
  sampleReport: string | null;
  /** The versions the three texts above were read from, recorded on the draft section. */
  rubricVersionId: string;
  ruleSetVersionId: string;
  /** Reference solutions. Labelled as reference, never shown to the student. */
  answerKeys: { path: string; content: string }[];
  /**
   * Files under the answer key directory that were left out, and why.
   *
   * Recorded rather than dropped silently. "Everything in the folder" is only trustworthy if
   * the exceptions are visible: an instructor who put a reference solution somewhere this
   * refuses to read needs to be told, and a `solutions.zip` being skipped is worth being able
   * to confirm rather than assume.
   */
  excludedAnswerKeys: { path: string; reason: string }[];
  /** The commit the answer keys were read at, or null when the section names none. */
  answerKeyCommitSha: string | null;
};

export class GradingAssetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradingAssetsError";
  }
}

/**
 * The repository as a set of files, read at one commit.
 *
 * `read` and `list` both return null for something absent. Callers decide whether that is
 * fatal: a missing rubric is, a missing answer key is not, and a module with no answer-keys
 * directory yet is an empty catalogue rather than an error.
 */
type AssetSource = {
  describe: string;
  commitSha: string;
  read: (relativePath: string) => Promise<string | null>;
  list: (relativeDir: string) => Promise<AssetEntry[] | null>;
};

/** One entry in an asset directory. */
export type AssetEntry = { name: string; type: "file" | "dir" };

/**
 * How long a resolved branch head is reused before being looked up again.
 *
 * A pushed rubric change takes effect within this long. Short, because the cost of
 * being wrong is grading a cohort against a rubric its author believes they replaced,
 * and one extra API call per minute is nothing. The plan's webhook-driven pointer would
 * remove the delay entirely; this needs no webhook to be correct, only current.
 */
const HEAD_SHA_TTL_MS = 60_000;

/**
 * Keyed by repository and ref, because there is more than one repository and the port script
 * reads the toolkit at a named commit while everything else reads a branch.
 */
const cachedHeads = new Map<string, { sha: string; at: number }>();

/**
 * File contents keyed by repository, commit SHA, and path.
 *
 * Cached without expiry, and safe to: the content of a path at a given commit cannot
 * change. Each deployment starts empty and each instance fills its own, which is the
 * right trade for a few dozen small files.
 */
const contentCache = new Map<string, string | null>();

/** Directory listings, keyed and cached on the same reasoning as `contentCache`. */
const directoryCache = new Map<string, AssetEntry[] | null>();

/** Splits "owner/repo", saying which field was wrong rather than failing on a substring. */
function splitRepo(repoFullName: string, describeField: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = repoFullName.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new GradingAssetsError(`${describeField} is "${repoFullName}". It must be "owner/repo".`);
  }
  return { owner, repo };
}

/**
 * Which installation can read this repository.
 *
 * A GitHub App is installed per organization, each with its own id and its own token, and
 * the installation that can see `marcy-lms` can see nothing in
 * `The-Marcy-Lab-School`. So the installation follows from the owner of the repository
 * being read rather than from a variable naming one of them — which is what allows an
 * assignment to keep its answer keys anywhere the App has been installed.
 *
 * `GRADING_ASSETS_INSTALLATION_ID` still overrides, for the program assets repository
 * only. It is rarely needed now and kept because a deployment that has it set should not
 * start behaving differently.
 */
async function installationFor(owner: string, override?: string): Promise<number> {
  if (override) {
    const parsed = Number(override);
    if (Number.isNaN(parsed)) {
      throw new GradingAssetsError(
        `GRADING_ASSETS_INSTALLATION_ID is "${override}", which is not a number.`,
      );
    }
    return parsed;
  }

  const { installationIdForOwner } = await import("../github/app-client");
  const found = await installationIdForOwner(owner);

  if (found === null) {
    throw new GradingAssetsError(
      `The GitHub App is not installed on ${owner}, so nothing in that organization can ` +
        `be read — including a private repository somebody has otherwise granted access to. ` +
        `Install it there. ` +
        `\`npx tsx --conditions=react-server scripts/list-installations.ts\` prints the ` +
        `installations that do exist.`,
    );
  }

  return found;
}

/**
 * One repository as a set of files, read at one commit.
 *
 * Every read in this module goes through here, so the repository, the installation, and
 * the commit are decided in a single place regardless of which of the two sources is being
 * read.
 *
 * `ref` is the branch to resolve, or absent for the repository's default. Only the program
 * assets repository passes one, from `GRADING_ASSETS_REF`, which exists so a rubric can be
 * iterated on without touching the default branch.
 */
async function assetSource(
  repoFullName: string,
  options: { installationId: number; ref?: string },
): Promise<AssetSource> {
  const { owner, repo } = splitRepo(repoFullName, repoFullName);
  const { installationId } = options;

  const { fetchRepoFile, listRepoDirectory } = await import("../github/files");

  const now = Date.now();
  const headKey = `${repoFullName}@${options.ref ?? ""}`;
  const held = cachedHeads.get(headKey);
  if (!held || now - held.at > HEAD_SHA_TTL_MS) {
    const { resolveRefToSha, getDefaultBranch } = await import("../github/archives");
    try {
      const branch = options.ref ?? (await getDefaultBranch(installationId, { owner, repo }));
      cachedHeads.set(headKey, {
        sha: await resolveRefToSha(installationId, { owner, repo, ref: branch }),
        at: now,
      });
    } catch (err) {
      throw new GradingAssetsError(
        `Could not reach ${repoFullName}: ` +
          `${err instanceof Error ? err.message : String(err)}.\n` +
          `Installation ${installationId} may not cover that repository. A GitHub App is ` +
          `installed per organization, and an installation on one organization grants no ` +
          `access to a private repository in another.`,
      );
    }
  }

  const sha = cachedHeads.get(headKey)!.sha;

  return {
    describe: `${repoFullName} at ${sha.slice(0, 7)}`,
    commitSha: sha,
    read: async (relativePath) => {
      const key = `${repoFullName}@${sha}:${relativePath}`;
      const cached = contentCache.get(key);
      if (cached !== undefined) return cached;

      const content = await fetchRepoFile(installationId, {
        owner,
        repo,
        ref: sha,
        path: relativePath,
      });
      contentCache.set(key, content);
      return content;
    },
    list: async (relativeDir) => {
      // Cached on the same principle as file contents, and safe for the same reason: what
      // a directory holds at a given commit cannot change. Keyed separately from `read` so
      // a file and a directory of the same path cannot collide.
      const key = `${repoFullName}@${sha}:dir:${relativeDir}`;
      const cached = directoryCache.get(key);
      if (cached !== undefined) return cached;

      const entries = await listRepoDirectory(installationId, {
        owner,
        repo,
        ref: sha,
        path: relativeDir,
      });
      directoryCache.set(key, entries);
      return entries;
    },
  };
}

/**
 * The grading-guides repository, for the scripts that still read the toolkit out of it.
 *
 * Grading no longer does: the rubric, the rule set and the sample report are rows. What is
 * left in the toolkit is the sample submissions `calibrate` grades and the files
 * `port:rubrics` read the rows from, which it reads at the commit it is given.
 */
async function programAssetSource(ref?: string): Promise<AssetSource> {
  /*
    A leftover GRADING_ASSETS_PATH is refused rather than ignored. Ignoring it would mean
    someone editing `rubric.md` locally, re-grading, and seeing no change — the variable's
    whole former purpose failing silently. Failing once with instructions is kinder.
  */
  if (process.env.GRADING_ASSETS_PATH) {
    throw new GradingAssetsError(
      "GRADING_ASSETS_PATH is set, but the local-clone source has been removed — assets " +
        "are read from the repository over the API in every environment. Delete the line " +
        "from .env.local. To iterate on the rubric, push to a branch and set " +
        "GRADING_ASSETS_REF to it.",
    );
  }

  const repoFullName = process.env.GRADING_ASSETS_REPO;
  if (!repoFullName) {
    throw new GradingAssetsError(
      "GRADING_ASSETS_REPO is not set, so there is no rubric to grade against. Set it to " +
        "owner/repo — see .env.example.",
    );
  }

  const { owner } = splitRepo(repoFullName, "GRADING_ASSETS_REPO");

  return assetSource(repoFullName, {
    installationId: await installationFor(owner, process.env.GRADING_ASSETS_INSTALLATION_ID),
    ref: ref ?? process.env.GRADING_ASSETS_REF,
  });
}

/**
 * The repository one assignment's reference solutions live in.
 *
 * Named by the assignment, resolved to an installation by its owner. Private, by decision:
 * templates are public because a student's repository is generated from one, and nothing
 * about this publishes a solution.
 */
async function answerKeySource(answerKeyRepo: string): Promise<AssetSource> {
  const { owner } = splitRepo(answerKeyRepo, "The assignment's answer key repository");
  return assetSource(answerKeyRepo, { installationId: await installationFor(owner) });
}

/**
 * Rejects an answer key path that would escape the repository.
 *
 * These paths come from a database column rather than from code, and the repository they
 * address is private, so a traversal is a way to read files out of it that no assignment
 * names. Checked with plain string logic rather than a filesystem resolver, because there
 * is no filesystem here — the path goes into a GitHub contents URL.
 *
 * A path is repository-relative and may be at any depth. It used to be relative to an
 * `answer-keys/` directory that this prefixed on, which is why the paths stored today
 * begin with that segment: it is a directory in the repository the assignments name, not a
 * rule anything applies.
 */
function repoPathIn(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || normalized.startsWith("/") || path.isAbsolute(relativePath)) {
    throw new GradingAssetsError(
      `Answer key path ${JSON.stringify(relativePath)} escapes the repository. ` +
        `Fix assignment.answerKeyDir.`,
    );
  }
  // `path.posix.normalize("")` is ".", and the contents endpoint wants an empty string for
  // the root. Without this, listing the root asks GitHub for a path called "." and gets
  // nothing back — which reads as an empty repository rather than as a malformed request.
  return normalized === "." ? "" : normalized;
}

/**
 * What may not go into a prompt as a reference solution.
 *
 * The answer keys are **every file under the directory an assignment names**, which is the
 * point: an instructor pastes the folder, nothing has to be selected, and a reference file
 * added upstream is used without anybody remembering to tick it. That only works if the
 * obvious junk is refused — the alternative is `solutions.zip` being base64-decoded into a
 * prompt as though it were source code.
 *
 * A denylist rather than an allowlist, deliberately. An allowlist of known-good extensions
 * would silently drop the first `.sql`, `.ejs`, or `.py` answer key somebody writes, and a
 * missing reference solution is invisible in the output — it does not fail, it just makes the
 * grade worse. This way an unfamiliar text file is included and only recognisable binaries
 * are refused.
 */
const NOT_A_REFERENCE_SOLUTION: { pattern: RegExp; reason: string }[] = [
  { pattern: /\.(zip|tar|tgz|gz|bz2|7z|rar)$/i, reason: "an archive" },
  { pattern: /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|avif)$/i, reason: "an image" },
  { pattern: /\.(pdf|docx?|xlsx?|pptx?|key|pages|numbers)$/i, reason: "a document" },
  { pattern: /\.(mp[34]|mov|avi|mkv|wav|ogg|webm|flac)$/i, reason: "audio or video" },
  { pattern: /\.(woff2?|ttf|otf|eot)$/i, reason: "a font" },
  { pattern: /\.(exe|dll|so|dylib|bin|wasm|class|jar|pyc)$/i, reason: "a compiled artifact" },
  { pattern: /(^|\/)\.DS_Store$/i, reason: "a system file" },
  { pattern: /(^|\/)node_modules\//, reason: "a dependency tree" },
];

/** Why this file is not a reference solution, or null when it is one. */
export function notAReferenceSolution(filePath: string): string | null {
  for (const rule of NOT_A_REFERENCE_SOLUTION) {
    if (rule.pattern.test(filePath)) return rule.reason;
  }
  return null;
}

/**
 * How many reference files one section may be given.
 *
 * A bound rather than a claim about what belongs in a folder. An assignment pointed at a
 * directory that turns out to hold hundreds of files should degrade into something an
 * instructor can see and act on rather than into a prompt that costs ten dollars. The
 * authoring screen shows the count before anything is saved, so this is a backstop rather
 * than the thing that catches the mistake.
 */
export const MAX_ANSWER_KEYS = 40;

/**
 * Browsing the repository an assignment names, so the folder holding its reference solutions
 * can be chosen rather than typed.
 *
 * Both functions below go through the same `answerKeySource` the grading pipeline uses and the
 * same `repoPathIn` guard, so the authoring screen lists exactly what grading will read.
 */

/**
 * One file out of `grading-toolkit/`, for scripts: `calibrate` needs the sample submissions and
 * the reports an instructor wrote about them, and `port:rubrics` reads the files the rubric rows
 * were made from, at the commit it names in `ref`.
 *
 * Restricted to that directory rather than taking any path, on the same reasoning as
 * `repoPathIn`: this is a private repository, and a function that reads an arbitrary path out of
 * it is a wider door than any caller needs.
 */
export async function readToolkitFile(
  name: string,
  options: { ref?: string } = {},
): Promise<string | null> {
  if (name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    throw new GradingAssetsError(
      `Toolkit file ${JSON.stringify(name)} must be a plain filename inside grading-toolkit/.`,
    );
  }
  const source = await programAssetSource(options.ref);
  return source.read(`grading-toolkit/${name}`);
}

/**
 * What one directory of an answer-key repository holds, for the form to walk.
 *
 * A browser rather than the two fixed levels this used to offer — a top-level directory and
 * then an assignment inside it. That shape was the curriculum's layout written into the
 * application, and it fit exactly one repository. An instructor pointing an assignment at a
 * private repository they made this morning arranges it however they like, so the form
 * navigates rather than assumes.
 *
 * The empty path is the repository root. Null when the directory does not exist, matching
 * `listRepoDirectory`: a path that has been renamed upstream is an empty listing to walk
 * back out of, not an exception.
 */
export async function listAnswerKeyEntries(
  answerKeyRepo: string,
  dir: string,
): Promise<AssetEntry[] | null> {
  const source = await answerKeySource(answerKeyRepo);
  const entries = await source.list(repoPathIn(dir));
  if (entries === null) return null;

  // Directories first, alphabetical within each, so a listing reads as something to
  // navigate rather than as whatever order the API happened to return.
  return [...entries].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
  );
}

/**
 * The part a template's name and its answer key folder's name share: every word before the
 * numbers, then the module number `N` (captured) and the lesson number `M`. `swe-1-4-loops`
 * matches as `swe-1-4`, `swe-sr-1-5-lists-dictionaries-python` as `swe-sr-1-5`, and a program
 * whose repositories begin `da-2-3-` matches as `da-2-3`.
 *
 * The words before the numbers may be anything made of letters, so neither the program's prefix
 * nor a marker such as `sr` is written into the application — but they are part of the match, so
 * a short response template finds its own folder and never the coding assignment's beside it.
 * `swe-checkpoint-4-databases` does not match, because a checkpoint has one number where this
 * expects two.
 */
const ASSIGNMENT_NUMBER = /^(?:[A-Za-z]+-)+(\d+)-\d+(?=-|$)/;

/**
 * The folder holding one assignment's answer keys, found from its template's name, or null.
 *
 * The grading guides repository keeps each assignment's keys two folders down, as
 * `answer-keys/mod-1-js-fundamentals/swe-1-4-loops`, and the Python course's as
 * `answer-keys-py/mod-1/swe-1-4-loops-python`. An instructor creating an assignment has the
 * template's name and would otherwise click through both levels to reach a folder whose name
 * is almost always the same. A template whose name ends in `-python` is looked up in the Python
 * tree, because the two courses reuse the same `swe-N-M` numbers for different assignments.
 *
 * Only the module folders the template's number points at are listed, so a lookup costs two or
 * three GitHub requests rather than a walk of the repository.
 */
export async function findAnswerKeyDir(
  answerKeyRepo: string,
  templateName: string,
): Promise<string | null> {
  const moduleNumber = ASSIGNMENT_NUMBER.exec(templateName)?.[1];
  if (!moduleNumber) return null;

  const tree = templateName.endsWith("-python") ? "answer-keys-py" : "answer-keys";
  const modules = await listAnswerKeyEntries(answerKeyRepo, tree);
  if (modules === null) return null;

  const dirs: string[] = [];
  for (const moduleDir of modules) {
    if (moduleDir.type !== "dir") continue;
    if (
      moduleDir.name !== `mod-${moduleNumber}` &&
      !moduleDir.name.startsWith(`mod-${moduleNumber}-`)
    ) {
      continue;
    }
    const entries = await listAnswerKeyEntries(answerKeyRepo, `${tree}/${moduleDir.name}`);
    for (const entry of entries ?? []) {
      if (entry.type === "dir") dirs.push(`${tree}/${moduleDir.name}/${entry.name}`);
    }
  }

  return closestAnswerKeyDir(templateName, dirs);
}

/**
 * Of the given folders, the one whose name best matches the template's name, or null when none
 * shares its `swe-N-M` part.
 *
 * Several folders can share that part: `swe-7-1` sits beside `swe-7-1-sr`, and
 * `swe-6-1-sql-basics` beside `swe-6-1-sql-basics-sr`. (`swe-sr-1-5-…` beside `swe-1-5-…` is
 * not a case of this, because the shared part includes the words before the numbers.) The
 * folder whose name agrees with the template's on the most leading hyphen-separated words is
 * chosen, so an exact name always wins. When two folders agree on the same number of words, the
 * shorter name is chosen, because the longer one is a variant of the shorter and a template that
 * names no variant wants the base.
 */
export function closestAnswerKeyDir(templateName: string, dirs: string[]): string | null {
  const assignment = ASSIGNMENT_NUMBER.exec(templateName)?.[0];
  if (!assignment) return null;

  const wanted = templateName.split("-");
  let best: { dir: string; shared: number; length: number } | null = null;

  for (const dir of dirs) {
    const name = path.posix.basename(dir);
    if (name !== assignment && !name.startsWith(`${assignment}-`)) continue;

    const words = name.split("-");
    let shared = 0;
    while (shared < words.length && words[shared] === wanted[shared]) shared += 1;

    const better =
      best === null ||
      shared > best.shared ||
      (shared === best.shared && name.length < best.length);
    if (better) best = { dir, shared, length: name.length };
  }

  return best?.dir ?? null;
}

/** What one answer key directory resolves to: the files that will be read, and what was not. */
export type AnswerKeySet = {
  /** Full repository paths, in a stable order. */
  paths: string[];
  /** Files under the directory that are not reference solutions, and why. */
  excluded: { path: string; reason: string }[];
  /** True when the directory itself does not exist in the repository. */
  missing: boolean;
};

/**
 * Every reference solution under one directory, as full repository paths.
 *
 * **This is the whole of how an assignment says what its answer keys are.** An instructor
 * names a folder and its contents are the reference set — nothing is selected, and a file
 * added to the folder upstream is used on the next run without anybody remembering it. The
 * previous shape stored a list of individual paths, which is the same information until the
 * folder changes and then it is quietly stale.
 *
 * Recursive, because answer keys nest: `swe-1-3-node-modules` keeps its under
 * `madlib-challenge/`, and reading only the top level would silently omit them.
 *
 * Sorted shallowest-first and alphabetically within a depth, so the prompt a model reads is
 * byte-identical between runs — which is what makes provider caching possible and what makes
 * two reports of the same submission comparable.
 */
export async function listAnswerKeys(answerKeyRepo: string, dir: string): Promise<AnswerKeySet> {
  const source = await answerKeySource(answerKeyRepo);

  // Bounded so that pointing an assignment at a large directory cannot turn one keystroke in
  // the form into hundreds of requests. Three levels below the named directory is well past
  // anything the curriculum uses, and a folder further down is always nameable instead.
  const MAX_DEPTH = 3;
  const paths: string[] = [];
  const excluded: { path: string; reason: string }[] = [];
  const root = repoPathIn(dir);

  const top = await source.list(root);
  if (top === null) return { paths: [], excluded: [], missing: true };

  async function walk(relative: string, entries: AssetEntry[], depth: number): Promise<void> {
    const sorted = [...entries].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "file" ? -1 : 1,
    );

    for (const entry of sorted) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;

      if (entry.type === "file") {
        const reason = notAReferenceSolution(child);
        if (reason) excluded.push({ path: child, reason });
        else paths.push(child);
        continue;
      }

      if (depth >= MAX_DEPTH) continue;
      const reason = notAReferenceSolution(`${child}/`);
      if (reason) {
        excluded.push({ path: `${child}/`, reason });
        continue;
      }
      const nested = await source.list(child);
      if (nested !== null) await walk(child, nested, depth + 1);
    }
  }

  await walk(root, top, 1);
  return { paths, excluded, missing: false };
}

/**
 * Whether an answer key directory is usable, for validation as a form is filled in.
 *
 * Reports rather than throws, because every one of these is something an instructor fixes by
 * correcting a URL: a directory that is not there, one holding nothing readable, one holding
 * more than a prompt should carry.
 */
export async function checkAnswerKeyDir(
  answerKeyRepo: string,
  dir: string,
): Promise<{ ok: boolean; reason?: string; set: AnswerKeySet }> {
  let set: AnswerKeySet;
  try {
    set = await listAnswerKeys(answerKeyRepo, dir);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      set: { paths: [], excluded: [], missing: true },
    };
  }

  if (set.missing) {
    return {
      ok: false,
      reason: `There is no ${dir || "root directory"} in ${answerKeyRepo}.`,
      set,
    };
  }
  if (set.paths.length === 0) {
    return {
      ok: false,
      reason:
        `${dir || answerKeyRepo} holds no files that can be used as reference solutions` +
        (set.excluded.length > 0
          ? ` — ${set.excluded.length} were skipped as ${[
              ...new Set(set.excluded.map((entry) => entry.reason)),
            ].join(", ")}.`
          : "."),
      set,
    };
  }
  if (set.paths.length > MAX_ANSWER_KEYS) {
    return {
      ok: false,
      reason:
        `${dir || answerKeyRepo} holds ${set.paths.length} files, more than the ` +
        `${MAX_ANSWER_KEYS} one section can be given. Name a directory further down.`,
      set,
    };
  }

  return { ok: true, set };
}

export async function loadGradingAssets(params: {
  /** The rubric the section names. Its current version is what the model reads. */
  rubricId: string;
  /**
   * The program the assignment belongs to, reached through its course, for the rule set every
   * rubric follows unless it names its own.
   */
  programId: string;
  /**
   * The repository the answer keys live in, or null when the assignment names none.
   *
   * Null is a real state rather than a configuration error: an assignment with no reference
   * solutions has no repository to name, and the kinds with no repository at all are graded
   * by hand. `answerKeyDir` must be null with it, which is what the schema enforces.
   */
  answerKeyRepo: string | null;
  /** The directory inside it whose contents are the reference solutions. */
  answerKeyDir: string | null;
}): Promise<GradingAssets> {
  if (params.answerKeyDir !== null && !params.answerKeyRepo) {
    throw new GradingAssetsError(
      `This assignment names an answer key directory (${JSON.stringify(params.answerKeyDir)}) ` +
        `but no repository to read it from. Set answerKeyRepo on the assignment.`,
    );
  }

  // The rows and the repository in parallel: they are separate round trips with nothing in
  // common, and the answer keys are several requests on their own.
  const [rubric, program, keys] = await Promise.all([
    db.rubric.findUnique({
      where: { id: params.rubricId },
      select: {
        name: true,
        currentVersion: {
          select: {
            id: true,
            rubricMarkdown: true,
            guidanceMarkdown: true,
            sampleReportMarkdown: true,
          },
        },
        ruleSet: { select: { currentVersion: { select: { id: true, markdown: true } } } },
      },
    }),
    db.program.findUnique({
      where: { id: params.programId },
      select: { ruleSet: { select: { currentVersion: { select: { id: true, markdown: true } } } } },
    }),
    readAnswerKeys(params.answerKeyRepo, params.answerKeyDir),
  ]);

  if (!rubric) {
    throw new GradingAssetsError(
      `No rubric ${params.rubricId}. The assignment's sections name a rubric that no longer exists.`,
    );
  }
  if (!rubric.currentVersion) {
    throw new GradingAssetsError(
      `Rubric ${rubric.name} has no version yet, so there is no text to grade against. ` +
        `For the four ported rubrics, run \`npm run port:rubrics\`.`,
    );
  }

  // The rubric's own rule set first, then the program's. Neither is the one failure here that
  // an instructor fixes somewhere other than the rubric, and the message says where.
  const ruleSetVersion = rubric.ruleSet?.currentVersion ?? program?.ruleSet?.currentVersion;
  if (!ruleSetVersion) throw new GradingAssetsError(NO_RULE_SET_MESSAGE);

  return {
    agentRules: ruleSetVersion.markdown,
    rubricSection: rubric.currentVersion.rubricMarkdown,
    guidance: rubric.currentVersion.guidanceMarkdown,
    // Optional. The assembly instructions in the system prompt say what each part is; a sample
    // adds the tone and the level of detail, and a rubric without one goes without that.
    sampleReport: rubric.currentVersion.sampleReportMarkdown,
    rubricVersionId: rubric.currentVersion.id,
    ruleSetVersionId: ruleSetVersion.id,
    answerKeys: keys.answerKeys,
    excludedAnswerKeys: keys.excluded,
    answerKeyCommitSha: keys.commitSha,
  };
}

/**
 * The reference solutions under the directory this assignment names.
 *
 * A file that lists but cannot be read — too large for `fetchRepoFile`, or removed between the
 * listing and the read — is recorded as excluded rather than thrown. The model then grades with
 * fewer references than the folder holds, which is worse but not useless, and the draft says so.
 */
async function readAnswerKeys(
  answerKeyRepo: string | null,
  answerKeyDir: string | null,
): Promise<{
  answerKeys: { path: string; content: string }[];
  excluded: { path: string; reason: string }[];
  commitSha: string | null;
}> {
  if (answerKeyRepo === null || answerKeyDir === null) {
    return { answerKeys: [], excluded: [], commitSha: null };
  }

  const set = await listAnswerKeys(answerKeyRepo, answerKeyDir);
  if (set.missing) {
    return {
      answerKeys: [],
      excluded: [{ path: answerKeyDir, reason: `no such directory in ${answerKeyRepo}` }],
      commitSha: null,
    };
  }

  const source = await answerKeySource(answerKeyRepo);
  const chosen = set.paths.slice(0, MAX_ANSWER_KEYS);
  const excluded = [...set.excluded];
  for (const dropped of set.paths.slice(MAX_ANSWER_KEYS)) {
    excluded.push({ path: dropped, reason: `over the ${MAX_ANSWER_KEYS}-file limit` });
  }

  const contents = await Promise.all(
    chosen.map(async (relativePath) => ({
      path: relativePath,
      content: await source.read(repoPathIn(relativePath)),
    })),
  );

  const answerKeys: { path: string; content: string }[] = [];
  for (const key of contents) {
    if (key.content === null) excluded.push({ path: key.path, reason: "could not be read" });
    else answerKeys.push({ path: key.path, content: key.content });
  }

  return { answerKeys, excluded, commitSha: source.commitSha };
}
