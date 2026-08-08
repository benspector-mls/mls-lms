import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (
    request.nextUrl.pathname !== "/" &&
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    // Data requests must NOT be redirected. Redirecting to a login page is the
    // right answer for a human asking for a page, and the wrong answer for
    // JavaScript asking for JSON — it would receive an HTML login page and fail
    // with an opaque parse error instead of "you are not signed in".
    // tRPC's protectedProcedure answers these itself with a proper 401.
    //
    // Note this exclusion is here and NOT in the matcher in proxy.ts: /api still
    // passes through this function so session-refresh above keeps running for
    // data requests. Only the redirect is skipped.
    !request.nextUrl.pathname.startsWith("/api")
  ) {
    /*
      No user: send them to sign in, and remember where they were going.

      `next` matters most for a course join link, which is the one address a person arrives at
      having never signed in — that is what it is for. Without it they would authenticate,
      land on `/courses`, and have no idea they were one step from joining the cohort somebody
      sent them. `login-form.tsx` and `/auth/callback` both already honour `next` and both
      refuse anything that is not a relative path, so this only has to set it.

      The search string is carried along with the path, because a link's query is part of where
      the person was going.
    */
    const destination = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = `?next=${encodeURIComponent(destination)}`;
    return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
