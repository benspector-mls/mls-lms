"use client";

import { useSearchParams } from "next/navigation";

import { GitHubAuthButton } from "@/components/github-auth-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Signing in, which is GitHub and nothing else.
 *
 * **There is deliberately no password form and no way to sign up here.** Three things follow from
 * that, and they are the reason rather than the consequence:
 *
 * Students need a GitHub account for the coursework regardless — accepting an assignment creates a
 * repository named after their login — so requiring one to sign in asks for nothing they did not
 * already need. What it removes is a whole category of surface: passwords to reset, passwords
 * reused from somewhere breached, and a reset flow that is a way in for anyone holding a mailbox.
 *
 * Two-factor authentication then comes from GitHub rather than from anything written here. A
 * GitHub organization can require it of every member in one setting, which is a stronger guarantee
 * than this application could offer and one nobody has to maintain.
 *
 * And accounts stop being self-service. There is no `signUp` call left anywhere, so every account
 * arrives through GitHub — which is what makes "a password exists only where an admin put one"
 * true rather than merely likely.
 *
 * **The Supabase side has to agree**, and this file cannot enforce it: the publishable key is
 * public, so `signUp` and `signInWithPassword` remain reachable against the Supabase API whether
 * or not a form calls them. Removing the forms is the visible half. The Email provider being
 * disabled in the Supabase dashboard is the half that actually closes it, and re-enabling it there
 * is the way back in if everybody is ever locked out of GitHub.
 */
export function LoginForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  const searchParams = useSearchParams();

  /*
    Where to land afterwards. It matters most for a join link, which is the one address somebody
    arrives at having never signed in — without it they authenticate, land on the dashboard, and
    have no idea they were one step from joining the cohort they were sent.

    Passed through rather than trusted: `GitHubAuthButton` builds a callback URL from it, and
    `/auth/callback` refuses anything that is not a relative path.
  */
  const next = searchParams.get("next") ?? undefined;

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>
            The Marcy Lab School LMS uses your GitHub account — the same one you push your
            assignments from.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <GitHubAuthButton label="Continue with GitHub" next={next} />
          <p className="text-xs text-muted-foreground">
            Signing in does not add you to a course. Your instructor sends a join link for that.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
