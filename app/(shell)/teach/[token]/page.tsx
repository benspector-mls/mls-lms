import { Suspense } from "react";

import { AcceptInstructorLink } from "@/components/instructor/accept-instructor-link";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Where a program's instructor link lands.
 *
 * Inside `(shell)` for the same reason `/join/[token]` is: the proxy sends an unauthenticated
 * visitor to `/auth/login` and they arrive back here signed in, which is the whole of the
 * binding step — the instructor row is written against whoever is signed in when the button is
 * pressed, so there is no token left to reconcile with an identity later.
 *
 * A separate address from `/join/[token]` rather than one route that reads both tokens, because
 * the two links grant opposite things and a single screen would have to decide which it was
 * looking at before it could say anything true about it.
 *
 * `cacheComponents` is enabled, so `params` is passed down and awaited in the async child.
 */
export default function TeachPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={null}>
      <Teach params={params} />
    </Suspense>
  );
}

async function Teach({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Read on the server so the screen can name the program, and say whether this account is
  // eligible at all, before anybody presses anything. Null when the token is unknown, which the
  // component reports as a link that no longer works rather than as an error.
  const preview = await getQueryClient().fetchQuery(
    trpc.programs.previewInstructorLink.queryOptions({ token }),
  );

  return <AcceptInstructorLink token={token} preview={preview} />;
}
