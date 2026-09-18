import "server-only";

/**
 * The two Slack Web API calls this application makes, and nothing else.
 *
 * Plain `fetch` rather than `@slack/web-api`, because two endpoints do not need a dependency.
 * The one Slack subtlety worth knowing is that the API answers HTTP 200 with `{ok: false, error}`
 * on almost every failure, so HTTP status alone says nothing — every result here is read through
 * that envelope.
 *
 * The bot the token belongs to needs four scopes: `chat:write` and `im:write` to open and post
 * into a direct message, `users:read` and `users:read.email` for `users.lookupByEmail`. Nothing
 * here reads messages, channels, or anyone else's data — the token's whole blast radius is
 * posting as the bot and resolving an email to a member id.
 */

/**
 * Whether the Slack integration's credential is present, so callers can no-op quietly instead of
 * failing with a confusing authentication error. Mirrors `isGithubAppConfigured`.
 *
 * Unset in development on purpose: a laptop pointed at the dev database must not be able to DM
 * anyone, and leaving the token out of `.env.local` is what guarantees that.
 */
export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

function requiredToken(): string {
  const value = process.env.SLACK_BOT_TOKEN;
  if (!value) {
    throw new Error(
      "SLACK_BOT_TOKEN is not set. Slack notifications are not configured — see the Slack app " +
        "setup section of the README.",
    );
  }
  return value;
}

/** What Slack's envelope looks like for the two calls made here. */
type SlackEnvelope = { ok: boolean; error?: string; user?: { id?: string } };

export type LookupResult =
  | { ok: true; userId: string }
  /** `notFound` separates "this email is not in the workspace" — a state the profile card
   *  renders — from a transport or auth failure, which is only worth a log line. */
  | { ok: false; notFound: boolean; error: string };

/**
 * The workspace member id for an email address, via `users.lookupByEmail`.
 */
export async function lookupUserIdByEmail(email: string): Promise<LookupResult> {
  try {
    const response = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${requiredToken()}` } },
    );
    const body = (await response.json()) as SlackEnvelope;

    if (body.ok && body.user?.id) return { ok: true, userId: body.user.id };
    const error = body.error ?? `HTTP ${response.status}`;
    return { ok: false, notFound: error === "users_not_found", error };
  } catch (err) {
    return { ok: false, notFound: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * One direct message to one member.
 *
 * `chat.postMessage` accepts the bare member id as `channel` and opens the DM itself when the
 * token holds `im:write`, so there is no separate `conversations.open` call. If Slack ever
 * refuses the bare id (`channel_not_found`), the fallback belongs inside this function — no
 * caller knows about channels.
 */
export async function sendDm(
  slackUserId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requiredToken()}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: slackUserId, text }),
    });
    const body = (await response.json()) as SlackEnvelope;

    if (body.ok) return { ok: true };
    return { ok: false, error: body.error ?? `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
