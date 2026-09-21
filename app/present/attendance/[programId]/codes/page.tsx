import { Suspense } from "react";

import { AttendanceCodesSheet } from "@/components/instructor/attendance-codes-sheet";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The fortnight of codes, laid out to be printed.
 *
 * **Outside `app/(shell)/`**, like the projector page beside it and for a related reason: what
 * comes out of a printer should be the sheet and nothing else — no sidebar naming every other
 * program, no breadcrumb, no header band.
 *
 * Leaving the shell costs no authorization. `lib/supabase/proxy.ts` redirects every path except
 * `/`, `/login`, and `/auth`, so an unauthenticated visitor never arrives here — and
 * `attendance.upcoming` is instructor-gated behind that, so a signed-in fellow who guesses the
 * address is refused by the procedure rather than by the route.
 */
export default function PresentAttendanceCodesPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <Sheet params={params} />
    </Suspense>
  );
}

async function Sheet({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const queryClient = getQueryClient();

  const upcoming = await queryClient.fetchQuery(
    trpc.attendance.upcoming.queryOptions({ programId }),
  );

  return (
    <AttendanceCodesSheet
      programName={upcoming.program.name}
      term={upcoming.program.term}
      days={upcoming.days}
    />
  );
}
