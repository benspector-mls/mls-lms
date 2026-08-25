import { Suspense } from "react";

import { JoinProgram } from "@/components/student/join-program";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Where a matriculation's join link lands.
 *
 * Inside `(shell)`, so it is behind the same authentication as every other page: the proxy
 * sends an unauthenticated visitor to `/auth/login` and they arrive back here signed in. That
 * is the whole of the binding step — the enrollment is created against whoever is signed in
 * when the button is pressed, so there is no token left to reconcile with an identity later.
 *
 * The token is a path segment rather than a query parameter, so the link reads as a place and
 * survives being pasted into a client that trims query strings.
 *
 * `cacheComponents` is enabled, so a route cannot block on per-request data outside a Suspense
 * boundary — and `params` counts. It is passed down and awaited in the async child.
 */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={null}>
      <Join params={params} />
    </Suspense>
  );
}

async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const queryClient = getQueryClient();

  // Read on the server so the screen can name the program and its courses before anybody
  // presses anything.
  // Null when the token is unknown, which the component reports as a link that no longer works
  // rather than as an error.
  const preview = await queryClient.fetchQuery(trpc.enrollments.preview.queryOptions({ token }));

  return <JoinProgram token={token} preview={preview} />;
}
