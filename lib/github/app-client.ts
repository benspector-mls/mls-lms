import "server-only";

import { createAppAuth } from "@octokit/auth-app";
import { Octokit as CoreOctokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";

/**
 * Built on @octokit/core plus @octokit/auth-app directly, rather than the
 * `octokit` convenience package's App class. That package's App class depends on
 * @octokit/app, whose package.json has no `exports` map, which breaks module
 * resolution under tsx (used to run prisma/seed.ts and any future scripts).
 * Only .request() and .paginate() are used anywhere here, so the paginate plugin
 * is the only addition needed over bare @octokit/core.
 */
const Octokit = CoreOctokit.plugin(paginateRest);
export type InstallationOctokit = InstanceType<typeof Octokit>;

/**
 * Returns false when the GitHub App environment variables are absent, so callers
 * can fail with a clear message instead of a confusing authentication error.
 */
export function isGithubAppConfigured() {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_WEBHOOK_SECRET &&
      process.env.GITHUB_APP_INSTALLATION_ID,
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The GitHub App is not configured yet — see the GitHub App setup section of the README.`,
    );
  }
  return value;
}

function getAppCredentials() {
  return {
    appId: requiredEnv("GITHUB_APP_ID"),
    // Private keys are normally pasted into env files with literal "\n"
    // sequences rather than real newlines, which the crypto library rejects.
    privateKey: requiredEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
  };
}

/**
 * Cached per installation id. Each client mints and refreshes its own
 * installation access token, so recreating one per request would waste a token
 * exchange on every call.
 *
 * On Vercel this cache lives for the lifetime of one function instance rather
 * than the lifetime of a server process, which is correct but less effective
 * than it was in a long-running process. It is still worth keeping, because a
 * warm instance handling several requests reuses the token.
 */
const installationClients = new Map<number, InstallationOctokit>();

export async function getInstallationOctokit(installationId: number): Promise<InstallationOctokit> {
  const cached = installationClients.get(installationId);
  if (cached) return cached;

  const client = new Octokit({
    authStrategy: createAppAuth,
    auth: { ...getAppCredentials(), installationId },
  });
  installationClients.set(installationId, client);
  return client;
}

/** Single-organization build: one GitHub App installation for the whole system. */
export function getConfiguredInstallationId(): number {
  return Number(requiredEnv("GITHUB_APP_INSTALLATION_ID"));
}
