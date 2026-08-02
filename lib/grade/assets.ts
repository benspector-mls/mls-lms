import "server-only";

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SectionType } from "./classify";

/**
 * The grading toolkit and answer keys: the rules, the rubric, the sample reports,
 * and the reference solutions.
 *
 * Two sources, chosen by whether `GRADING_ASSETS_PATH` is set.
 *
 * **A local clone**, when it is. Editing `rubric.md` and immediately re-grading is how
 * the rubric actually gets tuned, and a loop that requires committing and pushing
 * first would make that painful enough to stop happening. Development only — the path
 * is a directory on somebody's laptop.
 *
 * **The private repository over the GitHub API**, otherwise. This is what runs on a
 * deployed host, where no clone exists.
 *
 * Either way a commit SHA is recorded on every draft, so a report can be traced back
 * to the exact rubric and sample report that produced it. Content is fetched at that
 * SHA rather than at a branch name: a run that takes ninety seconds must not read half
 * its rubric from before a push and half from after.
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
  /** The clone's HEAD, recorded on the draft for reproducibility. */
  commitSha: string | null;
};

export class GradingAssetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradingAssetsError";
  }
}

/**
 * Where a set of files is being read from, and at which commit.
 *
 * `read` returns null for an absent file. Callers decide whether that is fatal: a
 * missing rubric is, a missing answer key is not.
 */
type AssetSource = {
  describe: string;
  commitSha: string | null;
  read: (relativePath: string) => Promise<string | null>;
};

function localSource(root: string): AssetSource {
  if (!existsSync(root)) {
    throw new GradingAssetsError(`GRADING_ASSETS_PATH points at ${root}, which does not exist.`);
  }
  return {
    describe: `the clone at ${root}`,
    commitSha: readCommitSha(root),
    read: async (relativePath) => {
      const full = path.join(root, relativePath);
      return existsSync(full) ? readFileSync(full, "utf-8") : null;
    },
  };
}

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

async function githubSource(): Promise<AssetSource> {
  const repoFullName = process.env.GRADING_ASSETS_REPO;
  if (!repoFullName) {
    throw new GradingAssetsError(
      "Neither GRADING_ASSETS_PATH nor GRADING_ASSETS_REPO is set, so there is no " +
      "rubric to grade against. Set GRADING_ASSETS_REPO to owner/repo on a deployed " +
      "host, or GRADING_ASSETS_PATH to a local clone — see .env.example.",
    );
  }

  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new GradingAssetsError(
      `GRADING_ASSETS_REPO is "${repoFullName}". It must be "owner/repo".`,
    );
  }

  const { getConfiguredInstallationId } = await import("../github/app-client");
  const { fetchRepoFile } = await import("../github/files");

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
  };
}

async function resolveSource(): Promise<AssetSource> {
  const root = process.env.GRADING_ASSETS_PATH;
  return root ? localSource(root) : githubSource();
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
function readCommitSha(root: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

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

export async function loadGradingAssets(params: {
  sectionType: SectionType;
  /** Paths relative to the answer-keys directory, from `assignment.sections`. */
  answerKeyPaths: string[];
}): Promise<GradingAssets> {
  const source = await resolveSource();
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
