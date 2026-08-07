import { Suspense } from 'react';

import { StaffAdmin } from '@/components/admin/staff-admin';
import { ListSkeleton } from '@/components/list-states';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * Who may teach, and who may decide that. Admins only.
 *
 * Not gated here. Both reads are `adminProcedure`, so an instructor who guesses this URL gets a
 * refusal from the procedures rather than a screen this page decided not to render — which is the
 * same reason every other guard in this application is in procedure code: Prisma connects as the
 * table owner and is not restricted by row level security, so a page-level check would be
 * decoration over an unguarded read.
 *
 * `cacheComponents` is enabled, so the reads happen in an async child behind Suspense rather than
 * in the page itself.
 */
export default function AdminPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <Staff />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <ListSkeleton rows={6} />
    </div>
  );
}

async function Staff() {
  const queryClient = getQueryClient();

  const [people, invites] = await Promise.all([
    queryClient.fetchQuery(trpc.staff.people.queryOptions()),
    queryClient.fetchQuery(trpc.staff.invites.queryOptions()),
  ]);

  /*
    Read once, here, and passed down, so every "expires in 3 days" on the screen is measured from
    the same instant — two invitations created a second apart must not disagree about whether they
    have expired. Safe in this position because the render is already dynamic.
  */
  return <StaffAdmin people={people} invites={invites} now={new Date()} />;
}
