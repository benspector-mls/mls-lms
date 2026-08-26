import { Suspense } from "react";

import { StaffAdmin } from "@/components/admin/staff-admin";
import { PageFallback } from "@/components/list-states";
import { getQueryClient, trpc } from "@/trpc/server";

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
    <Suspense fallback={<PageFallback rows={6} width="4xl" />}>
      <Staff />
    </Suspense>
  );
}

async function Staff() {
  const queryClient = getQueryClient();

  /*
    Every program, which is what `programs.listMine` already answers for an admin: they belong
    to none of them and see all. A read of its own rather than a field on `staff.people`, because it
    is a list of what exists rather than a fact about any of these people.
  */
  const [people, programs, invites] = await Promise.all([
    queryClient.fetchQuery(trpc.staff.people.queryOptions()),
    queryClient.fetchQuery(trpc.programs.listMine.queryOptions()),
    queryClient.fetchQuery(trpc.staff.invites.queryOptions()),
  ]);

  /*
    Read once, here, and passed down, so every "expires in 3 days" on the screen is measured from
    the same instant — two invitations created a second apart must not disagree about whether they
    have expired. Safe in this position because the render is already dynamic.
  */
  return <StaffAdmin people={people} programs={programs} invites={invites} now={new Date()} />;
}
