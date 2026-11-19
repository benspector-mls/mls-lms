import "server-only";

import {
  getConfiguredInstallationId,
  getInstallationOctokit,
  installationIdForOwner,
} from "../github/app-client";
import { getDefaultBranch, resolveRefToSha, splitRepoFullName } from "../github/archives";
import { fetchRepoFile } from "../github/files";

/**
 * Reading the curriculum repository, which the sync copies into the `lessons` table.
 *
 * Four calls written out here rather than a reuse of `lib/grade/assets.ts`. That module reads small
 * files from a branch's head, cached per commit, which is close to what the sync needs, but its one
 * exported entry point only reaches the `grading-toolkit/` folder of the grading repository, and
 * its errors are worded for grading. The sync needs the head commit, the file tree and one file at
 * a time, and each of those is one call to the GitHub helpers already in `lib/github/`.
 */

/**
 * Why a sync could not run, worded for the admin who pressed "Sync now" as something they can fix.
 * Any other error is a fault, and reaches them in whatever words GitHub or the database used.
 */
export class LessonSyncError extends Error {
  name = "LessonSyncError";
}

export type CurriculumRepo = {
  owner: string;
  repo: string;
  fullName: string;
  /** The branch to copy, or null for the default branch. */
  ref: string | null;
  installationId: number;
};

/**
 * A curriculum's repository, and the GitHub App installation that reads it.
 *
 * The repositories are public, and an installation token reads any public repository, so any
 * installation will do: the one on the repository's owner when the App is installed there, and the
 * LMS's own installation otherwise.
 */
export async function curriculumRepo(curriculum: {
  name: string;
  repo: string;
  ref: string | null;
}): Promise<CurriculumRepo> {
  let parts: { owner: string; repo: string };
  try {
    parts = splitRepoFullName(curriculum.repo);
  } catch {
    throw new LessonSyncError(
      `${curriculum.name} names the repository "${curriculum.repo}", which is not owner/repo.`,
    );
  }

  const installationId =
    (await installationIdForOwner(parts.owner)) ?? getConfiguredInstallationId();

  return { ...parts, fullName: curriculum.repo, ref: curriculum.ref, installationId };
}

/**
 * The commit to copy: the head of the curriculum's branch, or of the default branch when it names
 * none. A branch lets an author check an edit by adding a second curriculum for it.
 */
export async function headSha(source: CurriculumRepo): Promise<string> {
  const { owner, repo, installationId } = source;
  try {
    const ref = source.ref || (await getDefaultBranch(installationId, { owner, repo }));
    return await resolveRefToSha(installationId, { owner, repo, ref });
  } catch (err) {
    /*
      GitHub answers 404 both for a repository that does not exist or is private and for a
      branch that does not exist, and an installation token cannot tell them apart. Each is a
      setting somebody can fix, so the message names them all.
    */
    if ((err as { status?: number }).status === 404) {
      throw new LessonSyncError(
        `GitHub could not find ${source.fullName}` +
          (source.ref ? ` at the branch ${source.ref}` : "") +
          ". Check that the repository exists and is public" +
          (source.ref ? ", and that the branch exists." : "."),
      );
    }
    throw err;
  }
}

/**
 * Every file in the repository at `sha`, as its path and the hash of its contents.
 *
 * One request for the whole tree. The hash is what lets the sync fetch only the lessons whose
 * contents changed since the last copy, and the list of paths is what lets it check that every
 * image a lesson shows is really there.
 *
 * GitHub answers with part of the tree, and says so, past 100,000 entries or 7 MB. A partial tree
 * is refused rather than used, because the sync would read every lesson missing from it as deleted
 * and take it off the Lessons page.
 */
export async function listTree(source: CurriculumRepo, sha: string): Promise<Map<string, string>> {
  const octokit = await getInstallationOctokit(source.installationId);
  const { data } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
    owner: source.owner,
    repo: source.repo,
    tree_sha: sha,
    recursive: "1",
  });

  if (data.truncated) {
    throw new LessonSyncError(
      `GitHub listed only part of ${source.fullName} at ${sha.slice(0, 7)}, so nothing was ` +
        "changed. The repository has outgrown a single tree listing.",
    );
  }

  const files = new Map<string, string>();
  for (const entry of data.tree) {
    if (entry.type === "blob" && entry.path && entry.sha) files.set(entry.path, entry.sha);
  }
  return files;
}

/**
 * One file's text at `sha`, or null when it cannot be read.
 *
 * `fetchRepoFile` refuses anything over 200,000 bytes; the largest lesson is 42 KB.
 */
export async function readText(
  source: CurriculumRepo,
  sha: string,
  path: string,
): Promise<string | null> {
  return fetchRepoFile(source.installationId, {
    owner: source.owner,
    repo: source.repo,
    ref: sha,
    path,
  });
}
