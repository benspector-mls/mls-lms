/**
 * Exercises the Slack integration against the real workspace, from the terminal.
 *
 *   npm run verify:slack -- --lookup you@example.com     # resolve an email to a member id
 *   npm run verify:slack -- --digest you@example.com     # print that profile's derived digest
 *   npm run verify:slack -- --dm you@example.com         # show the test DM that would be sent
 *   npm run verify:slack -- --dm you@example.com --post  # actually send it
 *
 * **`--dm --post` messages a real person in the real workspace**, which is why it follows the
 * `scripts/approve.ts` contract: dry-run by default, `--post` to act. `--lookup` and `--digest`
 * only read — the digest is printed without advancing anybody's watermark, so running it changes
 * nothing about what the next real digest says.
 *
 * Needs SLACK_BOT_TOKEN in .env.local (see the Slack app setup section of the README) and
 * --conditions=react-server, as the modules it reaches import "server-only".
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

function argAfter(flag: string): string | null {
  const at = process.argv.indexOf(flag);
  return at !== -1 ? (process.argv[at + 1] ?? null) : null;
}

async function main() {
  const { isSlackConfigured, lookupUserIdByEmail, sendDm } = await import("../lib/slack/client");

  if (!isSlackConfigured()) {
    console.error("SLACK_BOT_TOKEN is not set. Add it to .env.local — see the README.");
    process.exit(1);
  }

  const lookup = argAfter("--lookup");
  const digest = argAfter("--digest");
  const dm = argAfter("--dm");

  if (lookup) {
    const result = await lookupUserIdByEmail(lookup.toLowerCase());
    console.log(
      result.ok
        ? `Found: ${lookup} is member ${result.userId}.`
        : result.notFound
          ? `Not found: no workspace member uses ${lookup}.`
          : `Lookup failed: ${result.error}`,
    );
    return;
  }

  if (digest || dm) {
    const email = (digest ?? dm)!.toLowerCase();
    const { db } = await import("../lib/prisma");
    const profile = await db.profile.findFirst({
      where: { OR: [{ email }, { slackEmail: email }] },
      select: { id: true, role: true, email: true, slackEmail: true, slackUserId: true, slackEventCadence: true, slackDigestedTo: true },
    });

    if (!profile) {
      console.error(`No profile uses ${email}.`);
      process.exit(1);
    }

    if (digest) {
      const { studentDigestLines, instructorDigestLines } = await import(
        "../lib/notifications/digest"
      );
      const { digestDm } = await import("../lib/notifications/messages");

      const now = new Date();
      const window = { gt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), lte: now };
      const lines =
        profile.role === "STUDENT"
          ? await studentDigestLines(db, profile.id, window)
          : await instructorDigestLines(db, profile.id, window);

      console.log(
        `${profile.role} ${email} — cadence ${profile.slackEventCadence}, watermark ` +
          `${profile.slackDigestedTo?.toISOString() ?? "unset"}.\n` +
          `Over the last 7 days their digest would say:\n`,
      );
      console.log(lines.length ? digestDm(lines) : "(nothing — the window is empty)");
      console.log("\nNothing was sent and no watermark moved.");
    } else {
      const { resolveSlackUserId } = await import("../lib/notifications/slack");
      const text = "Test message from the LMS — Slack notifications are wired correctly.";
      const post = process.argv.includes("--post");

      if (!post) {
        console.log(`Would DM ${email}: "${text}"\nRe-run with --post to send it for real.`);
      } else {
        const slackUserId = await resolveSlackUserId(db, profile);
        if (!slackUserId) {
          console.error(`Could not resolve ${email} to a workspace member — try --lookup first.`);
          process.exit(1);
        }
        const sent = await sendDm(slackUserId, text);
        console.log(sent.ok ? `Sent. Check ${email}'s Slack.` : `Send failed: ${sent.error}`);
      }
    }

    await db.$disconnect();
    return;
  }

  console.error(
    "Usage: npm run verify:slack -- --lookup <email> | --digest <email> | --dm <email> [--post]",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
