/**
 * Checks that the GitHub App this environment is configured with actually works.
 *
 *   npm run verify:app
 *
 * There are two apps — one per environment, because an app has a single webhook URL and
 * GitHub cannot reach localhost. Four environment variables select between them, and a
 * mistake in any of them fails somewhere unhelpful: a malformed private key surfaces as
 * `DECODER routines::unsupported` from inside a crypto library, and a wrong installation
 * id surfaces as a 404 on a repository that plainly exists.
 *
 * The private key check is deliberately not "does it look like a PEM". A value containing
 * only the first line passes that, because the first line contains both "BEGIN" and
 * "PRIVATE KEY" — which is exactly the mistake this script was written after. The only
 * check worth making is whether the crypto library will parse it.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

import { createPrivateKey } from "node:crypto";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}${detail && `\n       ${detail}`}`);
  } else console.log(`ok   ${label}${detail && `  (${detail})`}`);
}

/** The production app's shape, which a development app should mirror. */
const REQUIRED_PERMISSIONS: Record<string, string> = {
  administration: "write",
  contents: "write",
  members: "write",
  metadata: "read",
  pull_requests: "write",
};

async function main() {
  const { createAppAuth } = await import("@octokit/auth-app");
  const { Octokit } = await import("@octokit/core");

  for (const key of [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "GITHUB_APP_INSTALLATION_ID",
  ]) {
    check(`${key} is set`, Boolean(process.env[key]));
  }
  if (failures > 0) {
    console.log("\nSet the missing values before the rest can be checked — see .env.example.");
    process.exit(1);
  }

  // --- the private key, checked by parsing it ------------------------------
  const raw = process.env.GITHUB_APP_PRIVATE_KEY!;
  const pem = raw.replace(/\\n/g, "\n");

  // Detail only when the check fails: a hint printed beside "ok" reads as a problem.
  const hasEnd = /-----END [A-Z ]*PRIVATE KEY-----/.test(pem);
  check(
    "GITHUB_APP_PRIVATE_KEY holds a whole key, not just its first line",
    hasEnd,
    hasEnd
      ? ""
      : `${raw.length} chars and no END marker — a multi-line value must be quoted, or ` +
          `written on one line with literal \\n between lines`,
  );

  const repeatsName = pem.trimStart().startsWith("GITHUB_APP_PRIVATE_KEY=");
  check(
    "GITHUB_APP_PRIVATE_KEY does not repeat its own name",
    !repeatsName,
    repeatsName
      ? "the value itself begins with GITHUB_APP_PRIVATE_KEY= — remove the duplicated prefix"
      : "",
  );

  let keyParses = false;
  try {
    const parsed = createPrivateKey(pem);
    keyParses = true;
    check(
      "the private key parses",
      true,
      `${parsed.asymmetricKeyType} ${parsed.asymmetricKeyDetails?.modulusLength} bits`,
    );
  } catch (err) {
    check("the private key parses", false, err instanceof Error ? err.message : String(err));
  }
  if (!keyParses) {
    console.log("\nNothing further can be checked without a usable key.");
    process.exit(1);
  }

  // --- app identity --------------------------------------------------------
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: process.env.GITHUB_APP_ID!, privateKey: pem },
  });

  const { data: app } = await octokit.request("GET /app");
  if (!app) {
    check("GET /app returned an app", false);
    process.exit(1);
  }

  const owner = app.owner && "login" in app.owner ? app.owner.login : "unknown";
  console.log(`\napp: ${app.name} (slug ${app.slug}, id ${app.id}), owned by ${owner}`);

  check(
    "subscribed to pull_request",
    (app.events ?? []).includes("pull_request"),
    (app.events ?? []).join(", ") || "no events",
  );

  const permissions = (app.permissions ?? {}) as Record<string, string>;
  for (const [name, level] of Object.entries(REQUIRED_PERMISSIONS)) {
    check(
      `permission ${name}: ${level}`,
      permissions[name] === level,
      permissions[name] ? `is "${permissions[name]}"` : "not granted",
    );
  }

  // --- installation --------------------------------------------------------
  const configured = Number(process.env.GITHUB_APP_INSTALLATION_ID);
  const { data: installations } = await octokit.request("GET /app/installations");

  console.log(`\ninstallations of this app:`);
  for (const installation of installations) {
    const account =
      installation.account && "login" in installation.account
        ? installation.account.login
        : "unknown";
    console.log(
      `   id=${installation.id}  ${account}  repositories=${installation.repository_selection}` +
        (installation.id === configured ? "   <- GITHUB_APP_INSTALLATION_ID" : ""),
    );
  }
  check(
    "GITHUB_APP_INSTALLATION_ID is one of them",
    installations.some((installation) => installation.id === configured),
    `configured ${configured}`,
  );

  // --- can it reach a real repository? -------------------------------------
  const { db } = await import("../lib/prisma");
  const submission = await db.submission.findFirst({
    where: { repoFullName: { not: null } },
    select: { repoFullName: true },
  });

  if (!submission?.repoFullName) {
    console.log("\nskip the repository check — no submission has a repository yet");
  } else {
    const [repoOwner, repoName] = submission.repoFullName.split("/");
    const { getRepo } = await import("../lib/github/repos");
    const repo = await getRepo(configured, { owner: repoOwner, repo: repoName });
    check(
      `can read ${submission.repoFullName}`,
      repo !== null,
      repo ? `default branch ${repo.default_branch}` : "not visible to this installation",
    );
  }

  // --- webhook wiring ------------------------------------------------------
  const proxy = process.env.GITHUB_WEBHOOK_PROXY_URL;
  const { data: deliveries } = await octokit.request("GET /app/hook/deliveries", {
    per_page: 5,
  });

  console.log(`\nrecent webhook deliveries (${deliveries.length}):`);
  for (const delivery of deliveries) {
    console.log(
      `   ${delivery.delivered_at}  ${delivery.event}` +
        `${delivery.action ? `.${delivery.action}` : ""}  → ${delivery.status} ${delivery.status_code}`,
    );
  }

  if (deliveries.length === 0) {
    check(
      "the app has received at least one delivery",
      false,
      "not even the ping GitHub sends when a webhook is first saved — check the webhook URL",
    );
  } else {
    const { data: latest } = await octokit.request("GET /app/hook/deliveries/{delivery_id}", {
      delivery_id: deliveries[0].id,
    });
    console.log(`\nthis app posts webhooks to: ${latest.url ?? "(not reported)"}`);

    if (proxy) {
      check(
        "its webhook URL is the smee channel in GITHUB_WEBHOOK_PROXY_URL",
        latest.url === proxy,
        `app posts to ${latest.url ?? "unknown"}, GITHUB_WEBHOOK_PROXY_URL is ${proxy}`,
      );
      console.log(
        "\nRemember that smee.io answers GitHub with 200 whether or not anything is\n" +
          "listening, so run `npm run dev:webhook` before expecting a push to land.",
      );
    } else {
      check(
        "no proxy configured, so this should post straight to a deployment",
        !latest.url?.includes("smee.io"),
        "GITHUB_WEBHOOK_PROXY_URL is unset but the app still posts to smee.io",
      );
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} problem(s) above.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
