import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

/**
 * OAuth callback. Distinct from /auth/confirm, which handles emailed
 * `token_hash` links — this handles the PKCE `code` that GitHub (via Supabase)
 * sends back, and exchanges it for a session cookie.
 *
 * Supabase redirects here because it is passed as `redirectTo` when
 * signInWithOAuth is called. This URL must also be listed under
 * Authentication > URL Configuration > Redirect URLs in the Supabase dashboard.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // GitHub/Supabase report a denied consent screen or misconfiguration here
  // rather than by omitting `code`, so surface it instead of showing a generic
  // "no code" message.
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  if (oauthError) {
    redirect(`/auth/error?error=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    redirect(`/auth/error?error=${encodeURIComponent("No OAuth code in callback URL")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    redirect(`/auth/error?error=${encodeURIComponent(error.message)}`);
  }

  // `next` lets a caller send the user somewhere specific after login. Only
  // relative paths are honoured — an absolute URL here would be an open
  // redirect, letting a crafted link bounce a freshly authenticated user to an
  // attacker's site.
  const next = searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/protected";

  redirect(`${origin}${safeNext}`);
}
