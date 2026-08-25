import { Suspense } from "react";

import { ProgramsList } from "@/components/instructor/programs-list";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Every matriculation the caller belongs to.
 *
 * The instructor's way out of all of them, which is what the sidebar's "All programs" item points at.
 * A fellow's equivalent is `/courses`: they are in one matriculation at a time and what they navigate
 * by is its courses.
 *
 * `cacheComponents` is enabled, so a route cannot block on per-request data outside a Suspense
 * boundary. Everything here depends on who is signed in, so the page renders a static frame and the
 * read happens in an async child.
 *
 * Unauthenticated visitors never arrive: the proxy redirects them to /auth/login.
 */
export default function ProgramsPage() {
  return (
    <Suspense fallback={null}>
      <Programs />
    </Suspense>
  );
}

async function Programs() {
  const queryClient = getQueryClient();
  const [profile, programs] = await Promise.all([
    queryClient.fetchQuery(trpc.me.queryOptions()),
    queryClient.fetchQuery(trpc.programs.listMine.queryOptions()),
  ]);

  return (
    <ProgramsList
      programs={programs}
      // Any instructor may start a matriculation; the procedure is what refuses, so this decides
      // only whether the button is offered.
      canCreate={profile?.role === "INSTRUCTOR" || profile?.role === "ADMIN"}
    />
  );
}
