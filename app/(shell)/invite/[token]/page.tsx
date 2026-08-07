import { Suspense } from 'react';

import { AcceptInvite } from '@/components/admin/accept-invite';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * Where an instructor invitation lands.
 *
 * Inside `(shell)`, so it is behind the same authentication as every other page: the proxy sends
 * an unauthenticated visitor to `/auth/login` and they arrive back here signed in. That is the
 * whole of the binding step — the role is granted to whoever is signed in when the button is
 * pressed, so there is no token left to reconcile with an identity later, and an invitation can be
 * sent to somebody who has no account yet.
 *
 * The token is a path segment rather than a query parameter, so the link reads as a place and
 * survives being pasted into a client that trims query strings.
 *
 * `cacheComponents` is enabled, so a route cannot block on per-request data outside a Suspense
 * boundary — and `params` counts. It is passed down and awaited in the async child.
 */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={null}>
      <Invite params={params} />
    </Suspense>
  );
}

async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Read on the server so the screen can say what accepting would do before anything is pressed.
  // Null when the token is unknown, which the component reports as a link that does not work
  // rather than as an error.
  const preview = await getQueryClient().fetchQuery(
    trpc.staff.previewInvite.queryOptions({ token }),
  );

  return <AcceptInvite token={token} preview={preview} />;
}
