/**
 * Forwards GitHub webhook deliveries to the local development server.
 *
 *   npm run dev:webhook
 *
 * GitHub cannot reach localhost, so a development App points its webhook at a smee.io
 * channel and this forwards from that channel to the running dev server. Production
 * needs none of this — its App points straight at the deployment.
 *
 * This exists as a script rather than a bare `npx smee-client` because the channel URL
 * belongs in `.env.local` alongside the rest of the App's configuration, and because
 * silence is the failure mode worth avoiding: a delivery that arrives while nothing is
 * listening is recorded by GitHub as a 200 and then dropped, which reads as "the webhook
 * works and the application ignored it". Every forwarded delivery is logged here so the
 * difference is visible.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

import SmeeClient from "smee-client";

async function main() {
  const source = process.env.GITHUB_WEBHOOK_PROXY_URL;
  const port = process.env.PORT ?? "3000";
  const target = `http://localhost:${port}/api/webhooks/github`;

  if (!source) {
    console.error(
      "GITHUB_WEBHOOK_PROXY_URL is not set.\n\n" +
        "Open https://smee.io/new, copy the channel URL it gives you, and add it to\n" +
        ".env.local as GITHUB_WEBHOOK_PROXY_URL. Use the same URL as the webhook URL of\n" +
        "your development GitHub App — see the GitHub App section of .env.example.",
    );
    process.exit(1);
  }

  // A mismatched secret is the likeliest reason a forwarded delivery is rejected, and the
  // handler answers 401 with a deliberately terse body, so say it here instead.
  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    console.warn(
      "GITHUB_WEBHOOK_SECRET is not set, so every forwarded delivery will be rejected " +
        "with 401. It must match the secret on the development App exactly.\n",
    );
  }

  console.log(`Forwarding ${source}\n            → ${target}\n`);
  console.log("Leave this running alongside `npm run dev`. Ctrl-C to stop.\n");

  const smee = new SmeeClient({ source, target, logger: console });
  const events = await smee.start();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      events.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
