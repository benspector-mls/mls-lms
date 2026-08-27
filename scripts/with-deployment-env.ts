/**
 * Runs a command against the deployment's Supabase project instead of the development one.
 *
 *   npx tsx scripts/with-deployment-env.ts npm run db:status
 *
 * Usually reached through the three `:deployment` npm scripts rather than typed directly.
 *
 * **Why this exists.** Two Supabase projects serve this application — one for development, one
 * for the deployment — and `.env.local` names the development one. Applying a migration to the
 * deployment therefore used to mean editing `.env.local`, running the command, and editing it
 * back, which is exactly the arrangement the second project was created to end: a command run
 * one edit away from the rows that hold real grades. Here the environment is named by the
 * command, and the command is the record of which database it touched.
 *
 * **How the variables win.** `dotenv` never overwrites a variable that is already set, and every
 * script in this repository loads `.env.local` through it — including `prisma.config.ts`. So
 * setting the deployment's values in the child process's environment before the child starts is
 * all that is needed: the child's own `loadEnv(".env.local")` finds them present and leaves them
 * alone. That is the same precedence rule `prisma.config.ts` documents for `.env.local` over
 * `.env`, used one level further out.
 *
 * **Why it refuses rather than falls back.** The three checks below are one failure wearing three
 * hats: a command that reports success while having acted on the development database. Because
 * dotenv does not overwrite, a variable missing from `.env.deployment.local` does not raise an
 * error — it falls through to the development value in `.env.local`, and `migrate deploy` then
 * cheerfully reports the deployment up to date having read a different database entirely. There
 * is no safe default here, so there is no default.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { parse } from "dotenv";

/** Holds the deployment's values. Untracked: `.gitignore` covers `.env*.local`. */
const DEPLOYMENT_FILE = ".env.deployment.local";

/** Holds the development project's values, and is what every script reads by default. */
const DEVELOPMENT_FILE = ".env.local";

/**
 * What a command run out here can need, and therefore what the file must carry.
 *
 * `prisma migrate deploy` and `migrate status` read `DIRECT_URL`, falling back to `DATABASE_URL`;
 * anything going through `lib/prisma` reads `DATABASE_URL`; and `setup-storage.ts` reads the
 * other two through `storageClient()`. The publishable key is deliberately not among them — it
 * is a browser value, the deployment reads it from its own environment, and a copy here would be
 * one more thing to update after a rotation.
 */
const REQUIRED = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Parsed rather than loaded.
 *
 * `parse` over the file's text, not `config`, so that reading these values in order to check them
 * does not put the deployment's service role key into this process's own environment. Only the
 * child gets them, and only after the checks have passed.
 */
function readEnvFile(path: string): Record<string, string> | null {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * `https://wpwbltojruwgtpvlmiju.supabase.co` reduced to `wpwbltojruwgtpvlmiju`.
 *
 * Printed rather than the whole URL because the reference is the part that identifies a project
 * in the Supabase dashboard, and it is short enough to compare at a glance against the one shown
 * there. The URL is returned unchanged if it does not have the shape expected, since a value this
 * function cannot read is a value worth seeing in full.
 */
function projectRef(url: string): string {
  const match = /^https:\/\/([^.]+)\.supabase\./.exec(url.trim());
  return match ? match[1] : url.trim();
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    fail(
      `Usage: npx tsx scripts/with-deployment-env.ts <command> [args...]\n` +
        `For example: npx tsx scripts/with-deployment-env.ts npm run db:status`,
    );
  }

  const deployment = readEnvFile(DEPLOYMENT_FILE);

  if (!deployment) {
    fail(
      `Could not read ${DEPLOYMENT_FILE}.\n\n` +
        `It holds the deployment's ${REQUIRED.join(", ")} — the Supabase project's own\n` +
        `connection strings and keys, taken from its Connect dialog and its API settings.\n` +
        `Nothing runs against the deployment without it, deliberately: without the file there\n` +
        `is no way to tell "act on the deployment" from "act on development".`,
    );
  }

  const missing = REQUIRED.filter((name) => !deployment[name]?.trim());

  if (missing.length > 0) {
    fail(
      `${DEPLOYMENT_FILE} is missing ${missing.join(", ")}.\n\n` +
        `This cannot be allowed to proceed. dotenv does not overwrite a variable that is\n` +
        `already set, so a variable absent here is not an error further down — it falls through\n` +
        `to the development value in ${DEVELOPMENT_FILE}, and the command would act on the\n` +
        `development database while appearing to have acted on the deployment.`,
    );
  }

  const development = readEnvFile(DEVELOPMENT_FILE);
  const developmentUrl = development?.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const deploymentUrl = deployment.NEXT_PUBLIC_SUPABASE_URL.trim();

  if (developmentUrl && developmentUrl === deploymentUrl) {
    fail(
      `${DEPLOYMENT_FILE} and ${DEVELOPMENT_FILE} name the same Supabase project\n` +
        `(${projectRef(deploymentUrl)}).\n\n` +
        `That they name different ones is the whole of what this command is for. Either\n` +
        `${DEVELOPMENT_FILE} has been pointed at the deployment, or ${DEPLOYMENT_FILE} has been\n` +
        `filled in from the wrong dashboard. Fix whichever it is before running anything.`,
    );
  }

  console.log(
    `Against the deployment's Supabase project ${projectRef(deploymentUrl)}: ` +
      `${command} ${args.join(" ")}\n`,
  );

  // Every variable in the file, not only the four required ones, so that adding a variable to it
  // is enough to make it take effect. `deployment` last, so it wins over anything inherited.
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...deployment },
  });

  if (result.error) {
    fail(`Could not run ${command}: ${result.error.message}`);
  }

  // `status` is null when a signal killed the child, which is not a success and must not exit 0.
  process.exit(result.status ?? 1);
}

main();
