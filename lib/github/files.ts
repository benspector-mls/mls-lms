import "server-only";

import { getInstallationOctokit } from "./app-client";

/**
 * Reading single files out of a repository at a given commit.
 *
 * Deliberately one file at a time rather than a tarball. The grading assets repository
 * is 23MB and takes over 20 seconds to download, almost all of it images that grading
 * never reads; a run needs the rubric, the agent rules, one sample report, and a
 * handful of answer keys. Eight small requests beat one large one by a wide margin, and
 * they parallelize.
 */

/** Large enough for any answer key, small enough to refuse a minified bundle. */
const MAX_FETCHED_FILE_BYTES = 200_000;

/**
 * File contents, or null when the file does not exist, is too large, or the request
 * failed.
 *
 * Null rather than throwing because every caller has a reasonable response to an
 * absent file — a missing answer key is recorded and grading continues, a missing
 * README is simply not included — and none of them can do anything about the
 * difference between "absent" and "unreachable".
 */
export async function fetchRepoFile(
  installationId: number,
  params: { owner: string; repo: string; ref: string; path: string },
): Promise<string | null> {
  const octokit = await getInstallationOctokit(installationId);
  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref,
    });
    if (!("content" in data) || typeof data.content !== "string") return null;
    if (typeof data.size === "number" && data.size > MAX_FETCHED_FILE_BYTES) return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}
