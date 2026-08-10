import { Suspense } from "react";

import { ErrorState, PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { ProfileView } from "@/components/profile-view";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Your own account, for everybody who has one.
 *
 * **Not under `/instructor` and not under a course**, because it is the one screen in the signed-in
 * application that belongs to a person rather than to a cohort. A student and an instructor reach
 * the same address from the same place — the account menu at the foot of the sidebar — and see the
 * same screen with a different role on it.
 *
 * No role gate, and there is nothing here for one to protect: every read and the single write are
 * scoped to `ctx.user.id` by the procedures themselves, so the only profile this address can show
 * or change is the caller's own.
 *
 * `cacheComponents` is enabled, so the read happens in an async child behind Suspense rather than
 * in the page itself.
 */
export default function ProfilePage() {
  return (
    <Suspense fallback={<PageFallback rows={3} width="3xl" />}>
      <Profile />
    </Suspense>
  );
}

async function Profile() {
  const profile = await getQueryClient().fetchQuery(trpc.me.queryOptions());

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Profile"
        description="Your name, your account, and what this application stores about you."
      />
      {/*
        `me` answers null for a signed-in account with no profile row, which the signup trigger
        makes impossible and which is therefore worth reporting rather than rendering around. An
        empty form here would invite somebody to type a name into a row that does not exist.
      */}
      {profile ? (
        <ProfileView profile={profile} />
      ) : (
        <ErrorState
          title="This account has no profile"
          description="Every account gets one when it is created, so this should not be possible. Signing out and back in is worth trying; if it persists, it is worth reporting."
        />
      )}
    </div>
  );
}
