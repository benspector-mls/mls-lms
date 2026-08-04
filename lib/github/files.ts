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

/** One entry in a repository directory. Same shape the local clone reports. */
export type RepoDirectoryEntry = { name: string; type: "file" | "dir" };

/**
 * What a directory contains, or null when it does not exist.
 *
 * Non-recursive on purpose. The alternative is the git trees API with `recursive=1`,
 * which fetches every path in the repository in one request — for this repository that
 * is thousands of image paths to find a handful of answer keys. Walking the two or three
 * levels an assignment actually has costs two or three small requests instead.
 *
 * Null rather than throwing, matching `fetchRepoFile`: a caller listing a module that
 * has no answer-keys directory yet wants an empty catalogue, not an exception.
 */
export async function listRepoDirectory(
  installationId: number,
  params: { owner: string; repo: string; ref: string; path: string },
): Promise<RepoDirectoryEntry[] | null> {
  const octokit = await getInstallationOctokit(installationId);
  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref,
    });

    // A file rather than a directory comes back as an object. That is a caller error
    // rather than an empty directory, and null says so without inventing an entry.
    if (!Array.isArray(data)) return null;

    return data
      .filter((entry): entry is typeof entry & { type: "file" | "dir" } =>
        entry.type === "file" || entry.type === "dir")
      .map((entry) => ({ name: entry.name, type: entry.type }));
  } catch {
    return null;
  }
}
