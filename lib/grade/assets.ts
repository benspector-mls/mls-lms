import "server-only";

import path from "node:path";

import type { SectionType } from "./classify";

/**
 * The grading toolkit and answer keys: the rules, the rubric, the sample reports,
 * and the reference solutions.
 *
 * **One source: the private repository, over the GitHub API.** Development and deployment
 * read the same thing the same way, so there is no second implementation to keep in step
 * and no class of bug where an assignment authored against one listing is graded against
 * another.
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
  /** The commit the assets were read at, recorded on the draft for reproducibility. */
  commitSha: string;
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

let cachedHead: { repo: string; sha: string; at: number } | null = null;

/**
 * File contents keyed by commit SHA and path.
 *
 * Cached without expiry, and safe to: the content of a path at a given commit cannot
 * change. Each deployment starts empty and each instance fills its own, which is the
 * right trade for a few dozen small files.
 */
const contentCache = new Map<string, string | null>();

/** Directory listings, keyed and cached on the same reasoning as `contentCache`. */
const directoryCache = new Map<string, AssetEntry[] | null>();

/**
 * The one way assets are read.
 *
 * Every caller in this module goes through here, so there is a single place where the
 * repository, the installation, and the commit are decided.
 */
async function assetSource(): Promise<AssetSource> {
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

  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new GradingAssetsError(
      `GRADING_ASSETS_REPO is "${repoFullName}". It must be "owner/repo".`,
    );
  }

  const { getConfiguredInstallationId } = await import("../github/app-client");
  const { fetchRepoFile, listRepoDirectory } = await import("../github/files");

  // A GitHub App is installed per organization, each with its own id and its own
  // token. The grading guides live in a different organization from the student
  // repositories, so reading them needs that organization's installation — the one
  // that can see `marcy-lms-test` cannot see anything in `The-Marcy-Lab-School`.
  //
  // Falls back to the main installation for the case where both end up in one
  // organization, which is the simpler arrangement if it ever happens.
  const configured = process.env.GRADING_ASSETS_INSTALLATION_ID;
  const installationId = configured ? Number(configured) : getConfiguredInstallationId();
  if (Number.isNaN(installationId)) {
    throw new GradingAssetsError(
      `GRADING_ASSETS_INSTALLATION_ID is "${configured}", which is not a number.`,
    );
  }

  const now = Date.now();
  if (!cachedHead || cachedHead.repo !== repoFullName || now - cachedHead.at > HEAD_SHA_TTL_MS) {
    const { resolveRefToSha, getDefaultBranch } = await import("../github/archives");
    try {
      const branch = process.env.GRADING_ASSETS_REF
        ?? (await getDefaultBranch(installationId, { owner, repo }));
      cachedHead = {
        repo: repoFullName,
        sha: await resolveRefToSha(installationId, { owner, repo, ref: branch }),
        at: now,
      };
    } catch (err) {
      throw new GradingAssetsError(
        `Could not reach ${repoFullName} to read the grading assets: ` +
        `${err instanceof Error ? err.message : String(err)}.\n` +
        `Installation ${installationId} may not cover that repository. A GitHub App ` +
        `is installed per organization, so if the grading guides are in a different ` +
        `organization from the student repositories, install the app there too and ` +
        `set GRADING_ASSETS_INSTALLATION_ID to that installation's id. ` +
        `\`npx tsx --conditions=react-server scripts/list-installations.ts\` prints them.`,
      );
    }
  }

  const sha = cachedHead.sha;

  return {
    describe: `${repoFullName} at ${sha.slice(0, 7)}`,
    commitSha: sha,
    read: async (relativePath) => {
      const key = `${sha}:${relativePath}`;
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
      const key = `${sha}:dir:${relativeDir}`;
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

/** Best-effort. A clone that is not a git repository is usable, just untraceable. */
/**
 * Rejects an answer key path that would escape the answer-keys directory.
 *
 * These paths come from a database column rather than from code. Against a local clone
 * a traversal reads arbitrary files off the host; against the API it reads arbitrary
 * files out of a private repository. Checked with plain string logic so the rule is the
 * same for both, rather than relying on a filesystem resolver the API source does not
 * use.
 */
function answerKeyPathIn(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || normalized.startsWith("/") || path.isAbsolute(relativePath)) {
    throw new GradingAssetsError(
      `Answer key path ${JSON.stringify(relativePath)} escapes the answer-keys ` +
      `directory. Fix assignment.sections[].answerKeyPaths.`,
    );
  }
  return `answer-keys/${normalized}`;
}

/**
 * The answer-keys repository as the catalogue of what repository-backed assignments the
 * curriculum contains.
 *
 * `answer-keys/{moduleTag}/{assignmentRepoName}/` is the shape the seed already encodes.
 * Reading it rather than asking an instructor to retype it removes the most error-prone
 * field in an assignment, and makes the repository the single source of truth for what
 * exists: putting a directory there is what makes an assignment available to add to a
 * course, and there is no second list to keep in step.
 *
 * All three functions below go through `assetSource()`, so they list the same set the
 * grading pipeline would read from, and through `answerKeyPathIn()`, so authoring cannot
 * admit a path grading would refuse.
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
  const source = await assetSource();
  return source.read(`grading-toolkit/${name}`);
}

/** Which assignments the curriculum has answer keys for, in one module. */
export async function listAssignmentDirs(moduleTag: string): Promise<string[]> {
  const source = await assetSource();
  const entries = await source.list(answerKeyPathIn(moduleTag));
  if (entries === null) return [];
  return entries
    .filter((entry) => entry.type === "dir")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Every answer key file inside one assignment's directory, as paths relative to
 * `answer-keys/` — the exact form `sections[].answerKeyPaths` stores, so what this returns
 * can be written to the column without rewriting.
 *
 * Recursive, because answer keys nest: `swe-1-3-node-modules` keeps its under
 * `madlib-challenge/`, and a form offering only the top level would silently omit them.
 */
export async function listAnswerKeys(moduleTag: string, repoName: string): Promise<string[]> {
  const source = await assetSource();
  const root = `${moduleTag}/${repoName}`;

  // Depth is bounded to stop a symlink loop in a local clone from recursing forever. Three
  // is well past anything the curriculum uses and cheap to raise if that changes.
  const MAX_DEPTH = 3;
  const found: string[] = [];

  async function walk(relative: string, depth: number): Promise<void> {
    const entries = await source.list(answerKeyPathIn(relative));
    if (entries === null) return;

    // Files before directories, alphabetical within each, so an instructor reads a stable
    // list rather than whatever order the filesystem or the API happened to return.
    const sorted = [...entries].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "file" ? -1 : 1);

    for (const entry of sorted) {
      const child = `${relative}/${entry.name}`;
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
 * A path that escapes the answer-keys directory is reported as a finding on that path
 * rather than thrown, so one bad entry does not hide whether the others are right — but it
 * is the same `answerKeyPathIn` guard refusing it, so nothing can be saved here that
 * grading would later reject.
 */
export async function checkAnswerKeyPaths(
  paths: readonly string[],
): Promise<{ path: string; found: boolean; reason?: string }[]> {
  const source = await assetSource();

  return Promise.all(
    paths.map(async (relativePath) => {
      let guarded: string;
      try {
        guarded = answerKeyPathIn(relativePath);
      } catch (err) {
        return {
          path: relativePath,
          found: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }

      const content = await source.read(guarded);
      return content === null
        ? { path: relativePath, found: false, reason: "No such file in the answer keys." }
        : { path: relativePath, found: true };
    }),
  );
}

export async function loadGradingAssets(params: {
  sectionType: SectionType;
  /** Paths relative to the answer-keys directory, from `assignment.sections`. */
  answerKeyPaths: string[];
}): Promise<GradingAssets> {
  const source = await assetSource();
  const config = SECTION_ASSETS[params.sectionType];

  // In parallel, because against the API these are separate round trips and they do
  // not depend on each other. Eight sequential requests would add most of a second to
  // every section graded.
  const [agentRules, rubric, sampleReport, keyContents] = await Promise.all([
    readRequired(source, "grading-toolkit/agent-rules.md"),
    readRequired(source, "grading-toolkit/rubric.md"),
    readRequired(source, `grading-toolkit/${config.sampleFile}`),
    Promise.all(
      params.answerKeyPaths.map(async (relativePath) => ({
        path: relativePath,
        content: await source.read(answerKeyPathIn(relativePath)),
      })),
    ),
  ]);

  const answerKeys: { path: string; content: string }[] = [];
  const missingAnswerKeys: string[] = [];
  for (const key of keyContents) {
    // Recorded rather than thrown. A missing key means the model grades without a
    // reference solution, which is worse but not useless, and it should surface as a
    // review reason rather than as a crash.
    if (key.content === null) missingAnswerKeys.push(key.path);
    else answerKeys.push({ path: key.path, content: key.content });
  }

  return {
    agentRules,
    rubricSection: extractRubricSection(rubric, config.rubricHeading),
    sampleReport,
    answerKeys,
    missingAnswerKeys,
    commitSha: source.commitSha,
  };
}
