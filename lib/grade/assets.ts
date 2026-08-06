import "server-only";

import path from "node:path";

import type { SectionType } from "./classify";

/**
 * The grading toolkit and answer keys: the rules, the rubric, the sample reports,
 * and the reference solutions.
 *
 * **Two sources, addressed differently, read the same way.**
 *
 * - *Program assets* — `rubric.md`, `agent-rules.md`, and the sample reports — come from
 *   the repository `GRADING_ASSETS_REPO` names. They are prompt code for the whole
 *   program, not something one assignment has a version of, so an environment variable is
 *   the right place for them.
 * - *Answer keys* come from the repository the assignment itself names, at the paths it
 *   itself names. That is what lets a new cohort keep its reference solutions wherever it
 *   likes, and what stops the curriculum's directory layout from being a constraint on the
 *   application.
 *
 * Both over the GitHub API, so development and deployment read the same thing the same
 * way and there is no class of bug where an assignment is authored against one listing and
 * graded against another.
 *
 * There used to be a local-clone mode as well, selected by `GRADING_ASSETS_PATH`, for
 * editing `rubric.md` and re-grading without pushing first. It was removed deliberately.
 * Every source of assets after this one is external — rubrics for non-repository
 * assignments will come from Google Drive — so "read it from disk" was never going to
 * generalise, and maintaining two implementations of every read and list to keep one
 * development convenience was the wrong trade.
 *
 * What that costs, so it is not a surprise: tuning the rubric now means committing and
 * pushing, and waiting up to `HEAD_SHA_TTL_MS` for the new commit to be picked up. Set
 * `GRADING_ASSETS_REF` to a branch to iterate on one without touching the default.
 *
 * A commit SHA is recorded on every draft, so a report traces back to the exact rubric and
 * sample report that produced it. Content is fetched at that SHA rather than at a branch
 * name: a run taking ninety seconds must not read half its rubric from before a push and
 * half from after.
 */

export type GradingAssets = {
  /** Tone and formatting rules, the same ones the manual workflow uses. */
  agentRules: string;
  /** The section of rubric.md matching the section being graded. */
  rubricSection: string;
  /** The sample report whose structure the output must follow. */
  sampleReport: string;
  /** Reference solutions. Labelled as reference, never shown to the student. */
  answerKeys: { path: string; content: string }[];
  /** Answer key paths the assignment names that do not exist. */
  missingAnswerKeys: string[];
  /**
   * The commit the program assets — rubric, agent rules, sample report — were read at,
   * recorded on the draft for reproducibility.
   */
  commitSha: string;
  /**
   * The commit the answer keys were read at, or null when the section names none.
   *
   * Separate from `commitSha` because they are separate repositories now, and recording one
   * of the two would quietly weaken the claim the field exists to support: a report traces
   * back to the exact rubric *and the exact reference solutions* that produced it.
   */
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

/** Keyed by repository, because there is more than one now. */
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
 * the installation that can see `marcy-lms-test` can see nothing in
 * `The-Marcy-Lab-School`. So the installation follows from the owner of the repository
 * being read rather than from a variable naming one of them — which is what allows an
 * assignment to keep its answer keys anywhere the App has been installed.
 *
 * `GRADING_ASSETS_INSTALLATION_ID` still overrides, for the program assets repository
 * only. It is rarely needed now and kept because a deployment that has it set should not
 * start behaving differently.
 */
async function installationFor(
  owner: string,
  override?: string,
): Promise<number> {
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
  const held = cachedHeads.get(repoFullName);
  if (!held || now - held.at > HEAD_SHA_TTL_MS) {
    const { resolveRefToSha, getDefaultBranch } = await import("../github/archives");
    try {
      const branch = options.ref ?? (await getDefaultBranch(installationId, { owner, repo }));
      cachedHeads.set(repoFullName, {
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

  const sha = cachedHeads.get(repoFullName)!.sha;

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
 * The repository holding `rubric.md`, `agent-rules.md`, and the sample reports.
 *
 * Program-wide prompt code, which is why this one is named by the environment rather than
 * by an assignment. Every assignment in every course is graded against the same rubric and
 * the same tone rules; an assignment that had its own would be a different program.
 */
async function programAssetSource(): Promise<AssetSource> {
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
    ref: process.env.GRADING_ASSETS_REF,
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

/** For a file whose absence means there is nothing to grade against. */
async function readRequired(source: AssetSource, relativePath: string): Promise<string> {
  const content = await source.read(relativePath);
  if (content === null) {
    throw new GradingAssetsError(
      `Missing grading asset ${relativePath} in ${source.describe}.`,
    );
  }
  return content;
}

/**
 * Which heading in rubric.md governs each section type, and which sample report
 * the output must be shaped like.
 *
 * Written out rather than derived from the section name, because the rubric's
 * headings and the sample filenames follow different conventions and neither
 * matches the enum.
 */
const SECTION_ASSETS: Record<SectionType, { rubricHeading: string; sampleFile: string }> = {
  short_response: {
    rubricHeading: "SHORT RESPONSE",
    // Pair 1 of two. The toolkit also holds sample-short-response-submission-1.md,
    // the work this report was written about.
    //
    // Pair 2 is deliberately NOT used here. It is the held-out calibration case:
    // `npm run calibrate` grades submission 2 and compares the result against report
    // 2, which only measures anything as long as the model has not been shown the
    // answer. Adding it to this prompt would quietly invalidate that test.
    sampleFile: "sample-short-response-report-1.md",
  },
  coding_algorithm: {
    rubricHeading: "CODING — ALGORITHM FLUENCY",
    sampleFile: "sample-coding-fluency-report.md",
  },
  coding_sql: {
    rubricHeading: "CODING — SQL FLUENCY",
    sampleFile: "sample-coding-frontend-report.md",
  },
  coding_frontend: {
    rubricHeading: "CODING — FRONTEND",
    sampleFile: "sample-coding-frontend-report.md",
  },
};

/**
 * Extracts one `## `-level section from rubric.md.
 *
 * The whole rubric is roughly 110 lines, so sending all of it would not be
 * expensive. It is sliced anyway because the irrelevant sections are actively
 * misleading: a short response report given the algorithm rubric has a plausible
 * scoring scale to reach for that does not apply.
 */
export function extractRubricSection(rubric: string, heading: string): string {
  const lines = rubric.split("\n");
  const start = lines.findIndex(
    (line) => line.startsWith("## ") && line.slice(3).trim() === heading,
  );
  if (start === -1) {
    throw new GradingAssetsError(
      `rubric.md has no "## ${heading}" section. The rubric's headings may have been ` +
      `renamed — see SECTION_ASSETS in lib/grade/assets.ts.`,
    );
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trim();
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
      `Fix assignment.sections[].answerKeyPaths.`,
    );
  }
  // `path.posix.normalize("")` is ".", and the contents endpoint wants an empty string for
  // the root. Without this, listing the root asks GitHub for a path called "." and gets
  // nothing back — which reads as an empty repository rather than as a malformed request.
  return normalized === "." ? "" : normalized;
}

/**
 * Browsing the repository an assignment names, so its answer keys are ticked from a list
 * rather than typed.
 *
 * This is the machinery that survived the repository stopping being the catalogue of what
 * assignments exist. It earns its keep one level down: a mistyped answer key path is not an
 * error anybody sees, it is a confident report written without the reference solution it
 * should have had, and choosing from a listing is what makes typing one impossible.
 *
 * Both functions below go through the same `answerKeySource` the grading pipeline uses, and
 * through `repoPathIn`, so authoring cannot offer a path grading would refuse.
 */

/**
 * One file out of `grading-toolkit/`, for the scripts that need a toolkit file the grading
 * pipeline itself does not read — `calibrate` needs the sample submissions and the reports
 * an instructor wrote about them.
 *
 * Restricted to that directory rather than taking any path, on the same reasoning as
 * `answerKeyPathIn`: this is a private repository, and a function that reads an arbitrary
 * path out of it is a wider door than any caller needs.
 */
export async function readToolkitFile(name: string): Promise<string | null> {
  if (name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    throw new GradingAssetsError(
      `Toolkit file ${JSON.stringify(name)} must be a plain filename inside grading-toolkit/.`,
    );
  }
  const source = await programAssetSource();
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
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);
}

/**
 * Every file under one directory of an answer-key repository, as full repository paths —
 * the exact form `sections[].answerKeyPaths` stores, so what this returns can be written to
 * the column without rewriting.
 *
 * Recursive, because answer keys nest: `swe-1-3-node-modules` keeps its under
 * `madlib-challenge/`, and a form offering only the top level would silently omit them.
 */
export async function listAnswerKeys(answerKeyRepo: string, dir: string): Promise<string[]> {
  const source = await answerKeySource(answerKeyRepo);

  // Bounded so that a deep repository cannot turn one form keystroke into hundreds of
  // requests. Three levels below the chosen directory is well past anything the curriculum
  // uses, and an instructor who needs deeper can choose a directory further down.
  const MAX_DEPTH = 3;
  const found: string[] = [];
  const root = repoPathIn(dir);

  async function walk(relative: string, depth: number): Promise<void> {
    const entries = await source.list(relative);
    if (entries === null) return;

    // Files before directories, alphabetical within each, so an instructor reads a stable
    // list rather than whatever order the API happened to return.
    const sorted = [...entries].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "file" ? -1 : 1);

    for (const entry of sorted) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.type === "file") found.push(child);
      else if (depth < MAX_DEPTH) await walk(child, depth + 1);
    }
  }

  await walk(root, 1);
  return found;
}

/**
 * Whether each of these answer key paths exists, for validation as a form is filled in.
 *
 * A path that escapes the repository is reported as a finding on that path rather than
 * thrown, so one bad entry does not hide whether the others are right — but it is the same
 * `repoPathIn` guard refusing it, so nothing can be saved here that grading would later
 * reject.
 */
export async function checkAnswerKeyPaths(
  answerKeyRepo: string,
  paths: readonly string[],
): Promise<{ path: string; found: boolean; reason?: string }[]> {
  const source = await answerKeySource(answerKeyRepo);

  return Promise.all(
    paths.map(async (relativePath) => {
      let guarded: string;
      try {
        guarded = repoPathIn(relativePath);
      } catch (err) {
        return {
          path: relativePath,
          found: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }

      const content = await source.read(guarded);
      return content === null
        ? { path: relativePath, found: false, reason: `No such file in ${answerKeyRepo}.` }
        : { path: relativePath, found: true };
    }),
  );
}

export async function loadGradingAssets(params: {
  sectionType: SectionType;
  /**
   * The repository the answer keys live in, or null when the assignment names none.
   *
   * Null is a real state rather than a configuration error: `answerKeyPaths` is allowed to
   * be empty, and an assignment with no reference solutions has no repository to name. The
   * two have to agree, which is what the schema enforces.
   */
  answerKeyRepo: string | null;
  /** Paths inside `answerKeyRepo`, from `assignment.sections`. */
  answerKeyPaths: string[];
}): Promise<GradingAssets> {
  const source = await programAssetSource();
  const config = SECTION_ASSETS[params.sectionType];

  if (params.answerKeyPaths.length > 0 && !params.answerKeyRepo) {
    throw new GradingAssetsError(
      `This section names ${params.answerKeyPaths.length} answer key path(s) but the ` +
      `assignment names no answer key repository, so there is nowhere to read them from. ` +
      `Set answerKeyRepo on the assignment.`,
    );
  }

  // In parallel, because against the API these are separate round trips and they do
  // not depend on each other. Eight sequential requests would add most of a second to
  // every section graded. The two repositories resolve in parallel with each other too.
  const [agentRules, rubric, sampleReport, keys] = await Promise.all([
    readRequired(source, "grading-toolkit/agent-rules.md"),
    readRequired(source, "grading-toolkit/rubric.md"),
    readRequired(source, `grading-toolkit/${config.sampleFile}`),
    readAnswerKeys(params.answerKeyRepo, params.answerKeyPaths),
  ]);

  return {
    agentRules,
    rubricSection: extractRubricSection(rubric, config.rubricHeading),
    sampleReport,
    answerKeys: keys.answerKeys,
    missingAnswerKeys: keys.missingAnswerKeys,
    commitSha: source.commitSha,
    answerKeyCommitSha: keys.commitSha,
  };
}

/** The reference solutions this section names, and which of them are not there. */
async function readAnswerKeys(
  answerKeyRepo: string | null,
  answerKeyPaths: readonly string[],
): Promise<{
  answerKeys: { path: string; content: string }[];
  missingAnswerKeys: string[];
  commitSha: string | null;
}> {
  if (answerKeyRepo === null || answerKeyPaths.length === 0) {
    return { answerKeys: [], missingAnswerKeys: [], commitSha: null };
  }

  const source = await answerKeySource(answerKeyRepo);
  const contents = await Promise.all(
    answerKeyPaths.map(async (relativePath) => ({
      path: relativePath,
      content: await source.read(repoPathIn(relativePath)),
    })),
  );

  const answerKeys: { path: string; content: string }[] = [];
  const missingAnswerKeys: string[] = [];
  for (const key of contents) {
    // Recorded rather than thrown. A missing key means the model grades without a
    // reference solution, which is worse but not useless, and it should surface as a
    // review reason rather than as a crash.
    if (key.content === null) missingAnswerKeys.push(key.path);
    else answerKeys.push({ path: key.path, content: key.content });
  }

  return { answerKeys, missingAnswerKeys, commitSha: source.commitSha };
}
