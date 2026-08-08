import "server-only";

import { getInstallationOctokit } from "./app-client";

/**
 * Repository archive downloads, so the sandbox never needs a GitHub credential.
 *
 * The obvious alternative is `git clone https://x-access-token:$TOKEN@...` inside
 * the sandbox. Do not do that. The token is an *installation* token: it carries
 * write access to every repository in the organization, including every other
 * student's. The one process it would be handed to is the process running code
 * written by a student, and a postinstall script in a modified package.json reads
 * the environment and sends it elsewhere. The sandbox has network access during
 * installation by definition, because that is what installing requires.
 *
 * So the server, which is trusted, does the downloading. The sandbox receives
 * bytes: the same files a clone would have produced, with no .git directory, no
 * credential, and no means of talking to GitHub at all.
 */

export type RepoArchive = {
  /** gzipped tar, exactly as GitHub served it. */
  tarball: Buffer;
  /** The commit the archive contains. */
  commitSha: string;
  /** "owner/repo", for error messages. */
  repoFullName: string;
};

/**
 * Downloads a repository at a specific ref as a single gzipped tar.
 *
 * `ref` may be a commit SHA, a branch name, or a tag. Prefer a commit SHA for the
 * student's code — the exact commit the webhook recorded — so that a push during
 * the run cannot change what the results describe. A branch name would fetch
 * whatever the branch points at by the time the run starts.
 *
 * One request and one upload per repository, rather than one call per file, which
 * matters because an assignment repository can hold a few hundred files.
 */
export async function downloadRepoArchive(
  installationId: number,
  params: { owner: string; repo: string; ref: string },
): Promise<RepoArchive> {
  const octokit = await getInstallationOctokit(installationId);

  // Octokit follows the 302 to codeload and returns the bytes as an ArrayBuffer.
  const response = await octokit.request("GET /repos/{owner}/{repo}/tarball/{ref}", {
    owner: params.owner,
    repo: params.repo,
    ref: params.ref,
  });

  const data = response.data as unknown;
  if (!(data instanceof ArrayBuffer) && !Buffer.isBuffer(data)) {
    throw new Error(
      `Unexpected tarball response for ${params.owner}/${params.repo}@${params.ref}: ` +
        `expected binary data, received ${typeof data}.`,
    );
  }

  return {
    tarball: Buffer.isBuffer(data) ? data : Buffer.from(data),
    commitSha: params.ref,
    repoFullName: `${params.owner}/${params.repo}`,
  };
}

/**
 * Resolves a ref to the commit SHA it currently points at.
 *
 * Called for the template before its archive is downloaded, so that the run can
 * record which template commit's tests actually ran. That is what makes "these
 * tests are newer than what the student was given" answerable after the fact.
 *
 * A ref that is already a full commit SHA is returned unchanged, which is the
 * case when an assignment names an exact commit to archive a finished cohort.
 */
export async function resolveRefToSha(
  installationId: number,
  params: { owner: string; repo: string; ref: string },
): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(params.ref)) return params.ref.toLowerCase();

  const octokit = await getInstallationOctokit(installationId);
  const { data } = await octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", {
    owner: params.owner,
    repo: params.repo,
    ref: params.ref,
    // Only the SHA is wanted, so ask for the smallest useful response.
    per_page: 1,
  });
  return data.sha;
}

/** Returns the repository's default branch name. */
export async function getDefaultBranch(
  installationId: number,
  params: { owner: string; repo: string },
): Promise<string> {
  const octokit = await getInstallationOctokit(installationId);
  const { data } = await octokit.request("GET /repos/{owner}/{repo}", {
    owner: params.owner,
    repo: params.repo,
  });
  return data.default_branch;
}

/**
 * Splits "owner/repo" into its parts.
 *
 * Throws rather than returning a partial result, because every caller passes the
 * pieces straight to the GitHub API, where an empty owner produces a confusing
 * 404 rather than an obvious configuration error.
 */
export function splitRepoFullName(repoFullName: string): { owner: string; repo: string } {
  const parts = repoFullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Expected "owner/repo", received "${repoFullName}".`);
  }
  return { owner: parts[0], repo: parts[1] };
}
