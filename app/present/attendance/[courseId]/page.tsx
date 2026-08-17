import { Suspense } from "react";

import { AttendanceDisplay } from "@/components/instructor/attendance-display";
import { EmptyState } from "@/components/list-states";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The code, on a screen the room can read.
 *
 * **Outside `app/(shell)/` deliberately**, so it renders with nothing on it — no sidebar naming
 * every other cohort, no breadcrumb, no header band. That is what a projector wants, and it is
 * also what makes this the one window an instructor can safely share into Zoom: everything on it
 * is meant for the class.
 *
 * Leaving the shell costs no authorization. `lib/supabase/proxy.ts` redirects every path except
 * `/`, `/login`, and `/auth`, so an unauthenticated visitor never arrives here — and
 * `attendance.sessionCode` is instructor-gated behind that, so a signed-in student who guesses the
 * address is refused by the procedure rather than by the route.
 *
 * **Opening this is optional.** The code is fixed for the session, so an instructor who is sharing a
 * single application window can copy it off the attendance screen instead. This route is for the
 * case where a room has a projector and the digits can simply stay up.
 */
export default function PresentAttendancePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <Present params={params} />
    </Suspense>
  );
}

async function Present({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  const grid = await queryClient.fetchQuery(trpc.attendance.grid.queryOptions({ courseId }));

  if (!grid.session) {
    return (
      <main className="flex min-h-svh items-center justify-center p-8">
        <EmptyState
          title="No check-in is open"
          description="Start one from the attendance screen and this window will show the code."
        />
      </main>
    );
  }

  const initial = await queryClient.fetchQuery(
    trpc.attendance.sessionCode.queryOptions({ sessionId: grid.session.id }),
  );

  return <AttendanceDisplay initial={initial} />;
}
