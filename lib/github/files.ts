import "server-only";

import { getInstallationOctokit } from "./app-client";
import { getDefaultBranch } from "./archives";

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
export const MAX_FETCHED_FILE_BYTES = 200_000;

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
      .filter(
        (entry): entry is typeof entry & { type: "file" | "dir" } =>
          entry.type === "file" || entry.type === "dir",
      )
      .map((entry) => ({ name: entry.name, type: entry.type }));
  } catch {
    return null;
  }
}

/** A repository as it stood at one commit, with the history that led to it. */
export type RepoSnapshot = {
  branch: string;
  commitSha: string;
  /** Every file at that commit, with its size in bytes. */
  files: { path: string; size: number }[];
  /** True when GitHub listed only part of the tree, which it does past 100,000 entries. */
  truncated: boolean;
  /** Commits on `branch` up to and including `commitSha`, newest first, at most 100. */
  commits: { sha: string; date: string; message: string }[];
  branches: string[];
};

/** Why a repository could not be read, worded to finish the sentence "Not read: <url> (…)". */
export class RepoSnapshotError extends Error {
  name = "RepoSnapshotError";
}

/**
 * A repository on its default branch, at the last commit made on or before `before`.
 *
 * For a repository a fellow owns and handed in by link. The link stays the same while the
 * repository changes, so the time of the hand-in is what fixes the work being graded.
 *
 * GitHub's `until` compares the date written into each commit, which the fellow's own machine
 * sets, rather than the time the commit was pushed. So a commit made before the hand-in and pushed
 * after it is included, and a fellow who sets the date by hand can move a commit into the window.
 * Recording the commit at the moment of hand-in would close that gap, at the cost of a column.
 *
 * `branches` is the list as it stands when this runs, not as it stood at the hand-in: GitHub keeps
 * no history of when a branch was created.
 *
 * The installation token reads any public repository, whoever owns it. A private one answers 404,
 * which becomes a `RepoSnapshotError` naming the cause, so the caller can tell the instructor that
 * the fellow has to make the repository public rather than failing the whole run.
 */
export async function readRepoSnapshot(
  installationId: number,
  params: { owner: string; repo: string; before: Date },
): Promise<RepoSnapshot> {
  const { owner, repo } = params;
  try {
    const branch = await getDefaultBranch(installationId, { owner, repo });
    const octokit = await getInstallationOctokit(installationId);

    const { data: commitList } = await octokit.request("GET /repos/{owner}/{repo}/commits", {
      owner,
      repo,
      sha: branch,
      until: params.before.toISOString(),
      per_page: 100,
    });
    const latest = commitList[0];
    if (!latest) {
      throw new RepoSnapshotError(`it has no commit on ${branch} from before it was handed in`);
    }

    const [{ data: tree }, { data: branchList }] = await Promise.all([
      octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
        owner,
        repo,
        tree_sha: latest.sha,
        recursive: "1",
      }),
      octokit.request("GET /repos/{owner}/{repo}/branches", { owner, repo, per_page: 100 }),
    ]);

    return {
      branch,
      commitSha: latest.sha,
      files: tree.tree
        .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
        .map((entry) => ({ path: entry.path as string, size: entry.size ?? 0 })),
      truncated: tree.truncated,
      commits: commitList.map((item) => ({
        sha: item.sha,
        date: item.commit.committer?.date ?? item.commit.author?.date ?? "",
        message: item.commit.message.split("\n")[0],
      })),
      branches: branchList.map((item) => item.name),
    };
  } catch (err) {
    if (err instanceof RepoSnapshotError) throw err;
    const status = (err as { status?: number }).status;
    if (status === 404) throw new RepoSnapshotError("the repository is private or does not exist");
    if (status === 409) throw new RepoSnapshotError("the repository is empty");
    throw err;
  }
}
