import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges an emailed one-time token for a session.
 *
 * **Kept although nothing in this application sends such an email.** Sign-in is GitHub and nothing
 * else — see `components/login-form.tsx` — so in ordinary running no link arrives here. What this
 * is for is the way back: if the Email provider is re-enabled in the Supabase dashboard because
 * everybody is locked out of GitHub, the recovery link Supabase sends lands on this route, and a
 * route that had been deleted would have to be written again during exactly the incident it exists
 * to resolve.
 *
 * Distinct from `/auth/callback`, which takes the PKCE `code` GitHub sends back.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  /*
    Only relative paths are honoured, the same rule `/auth/callback` applies and for the same
    reason — an absolute URL here would be an open redirect, and this one is worse than most: the
    person is sent onwards at the moment they have just been authenticated, so a crafted link would
    bounce a freshly signed-in account to somewhere of the sender's choosing.

    `//evil.example` is rejected alongside it. It is a relative path by the `startsWith("/")` test
    and a protocol-relative URL to every browser.
  */
  const requested = searchParams.get("next");
  const next =
    requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  if (!tokenHash || !type) {
    redirect(`/auth/error?error=${encodeURIComponent("This link is missing its token.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    redirect(`/auth/error?error=${encodeURIComponent(error.message)}`);
  }

  redirect(next);
}
