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

/**
 * A client authenticated as the App itself rather than as one installation.
 *
 * Needed for the handful of questions that are about installations rather than about
 * repositories — chiefly "is this App installed on that owner at all", which is the only
 * way to tell a repository that does not exist from a private one nobody granted access to.
 * Both answer 404 to an installation token.
 */
async function getAppOctokit(): Promise<InstallationOctokit> {
  return new Octokit({ authStrategy: createAppAuth, auth: getAppCredentials() });
}

/**
 * Which installation can see this owner's repositories, or null when the App is not
 * installed there.
 *
 * The reason this exists: an assignment names its own answer-key repository, which is
 * private, and a GitHub App is installed per organization with its own id and its own
 * token. The installation that can see the student repositories cannot read a private
 * repository in another organization, so the installation follows from the owner rather
 * than from an environment variable.
 *
 * **Null is a distinct and useful answer**, not a failure. It is what turns "that
 * repository cannot be read" into either "check the name" or "install the App on that
 * organization" — the second being something no instructor can fix from a form, and the
 * first being a typo they can fix in seconds.
 */
export async function installationIdForOwner(owner: string): Promise<number | null> {
  const cached = installationByOwner.get(owner.toLowerCase());
  if (cached !== undefined) return cached;

  const octokit = await getAppOctokit();

  // Organizations and user accounts have separate endpoints and an owner name says which
  // it is only by asking. The org endpoint is tried first because every owner in play is
  // an organization; a personal account holding a template is legitimate and cheap to
  // allow for.
  for (const route of [
    "GET /orgs/{owner}/installation",
    "GET /users/{owner}/installation",
  ] as const) {
    try {
      const { data } = await octokit.request(route, { owner });
      installationByOwner.set(owner.toLowerCase(), data.id);
      return data.id;
    } catch (err) {
      if (err instanceof Object && "status" in err && err.status === 404) continue;
      throw err;
    }
  }

  installationByOwner.set(owner.toLowerCase(), null);
  return null;
}

/**
 * Cached for the life of the instance, including the negative answer.
 *
 * Installing the App on an organization is a deliberate act by a person, so this changes
 * about as often as a deployment. Caching the null matters more than caching the hit: the
 * authoring form validates as fields change, and an instructor typing an organization the
 * App is not on would otherwise cost two App-authenticated requests per keystroke.
 */
const installationByOwner = new Map<string, number | null>();
