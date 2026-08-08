/**
 * Lists every organization the GitHub App is installed on, with its installation id.
 *
 * Run with `npx tsx --conditions=react-server scripts/list-installations.ts`.
 *
 * Useful when a repository the application needs sits in a different organization from
 * the one holding the student repositories: each organization is a separate
 * installation with its own id and its own token.
 */
import { config as loadEnv } from "dotenv";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

async function main() {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    },
  });

  const { data } = await octokit.request("GET /app/installations");
  for (const installation of data) {
    const login =
      installation.account && "login" in installation.account
        ? installation.account.login
        : "(unknown)";
    console.log(`${installation.id}\t${login}\t${installation.repository_selection}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
