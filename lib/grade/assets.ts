import "server-only";

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SectionType } from "./classify";

/**
 * The grading toolkit and answer keys: the rules, the rubric, the sample reports,
 * and the reference solutions.
 *
 * Read from a local clone through GRADING_ASSETS_PATH. That is a development
 * arrangement and is on the open items list: once this runs on Vercel rather than
 * one laptop, it has to become a fetch from the private repository at a specific
 * commit SHA through the GitHub API. Everything here reads through
 * `loadGradingAssets`, so that change lands in one place.
 *
 * The clone's current commit is recorded on every draft, so a report can be traced
 * back to the exact rubric and sample report that produced it.
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

function assetsRoot(): string {
  const root = process.env.GRADING_ASSETS_PATH;
  if (!root) {
    throw new GradingAssetsError(
      "GRADING_ASSETS_PATH is not set. It must point at a clone of the grading " +
      "toolkit and answer keys repository — see .env.example.",
    );
  }
  if (!existsSync(root)) {
    throw new GradingAssetsError(`GRADING_ASSETS_PATH points at ${root}, which does not exist.`);
  }
  return root;
}

function readAsset(root: string, relativePath: string): string {
  const full = path.join(root, relativePath);
  if (!existsSync(full)) {
    throw new GradingAssetsError(
      `Missing grading asset ${relativePath} under GRADING_ASSETS_PATH. ` +
      `The clone at ${root} may be incomplete or out of date.`,
    );
  }
  return readFileSync(full, "utf-8");
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

export function loadGradingAssets(params: {
  sectionType: SectionType;
  /** Paths relative to the answer-keys directory, from `assignment.sections`. */
  answerKeyPaths: string[];
}): GradingAssets {
  const root = assetsRoot();
  const config = SECTION_ASSETS[params.sectionType];

  const rubric = readAsset(root, path.join("grading-toolkit", "rubric.md"));

  const answerKeys: { path: string; content: string }[] = [];
  const missingAnswerKeys: string[] = [];

  for (const relativePath of params.answerKeyPaths) {
    // Confined to the answer-keys directory. These paths come from a database
    // column, so a traversal would otherwise read arbitrary files off the host.
    const resolved = path.resolve(root, "answer-keys", relativePath);
    const expectedPrefix = path.resolve(root, "answer-keys") + path.sep;
    if (!resolved.startsWith(expectedPrefix)) {
      throw new GradingAssetsError(
        `Answer key path ${JSON.stringify(relativePath)} escapes the answer-keys ` +
        `directory. Fix assignment.sections[].answerKeyPaths.`,
      );
    }

    if (existsSync(resolved)) {
      answerKeys.push({ path: relativePath, content: readFileSync(resolved, "utf-8") });
    } else {
      // Recorded rather than thrown. A missing key means the model grades without
      // a reference solution, which is worse but not useless, and it should
      // surface as a review reason rather than as a crash.
      missingAnswerKeys.push(relativePath);
    }
  }

  return {
    agentRules: readAsset(root, path.join("grading-toolkit", "agent-rules.md")),
    rubricSection: extractRubricSection(rubric, config.rubricHeading),
    sampleReport: readAsset(root, path.join("grading-toolkit", config.sampleFile)),
    answerKeys,
    missingAnswerKeys,
    commitSha: readCommitSha(root),
  };
}
