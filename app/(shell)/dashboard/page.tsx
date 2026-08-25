import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { StudentDashboard } from "@/components/student/dashboard";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Where a student lands. The one screen in this application that spans courses.
 *
 * `cacheComponents` is enabled, so a route cannot block on per-request data outside a Suspense
 * boundary. Everything here depends on who is signed in, so the page renders a static frame and
 * the read happens in an async child.
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<PageFallback rows={6} width="4xl" />}>
      <Dashboard />
    </Suspense>
  );
}

/**
 * A server component calling the procedures in this process rather than over HTTP. The lists cost
 * no client JavaScript at all; the attendance strip is the one interactive piece, and it is handed
 * its first answer here so it draws with the page rather than after it.
 */
async function Dashboard() {
  const queryClient = getQueryClient();

  const [profile, assignments, week] = await Promise.all([
    queryClient.fetchQuery(trpc.me.queryOptions()),
    queryClient.fetchQuery(trpc.assignments.listMine.queryOptions()),
    queryClient.fetchQuery(trpc.attendance.myWeek.queryOptions()),
  ]);

  /*
    Routing, not authorization. `listMine` is scoped to the caller's own enrollments and would
    answer an instructor honestly — with the handful of courses they happen to be enrolled in as a
    student, which is not what they came for. An instructor's landing screen is their grading
    queue, so send them there rather than showing them a nearly empty dashboard.

    Deliberately not a role guard: the page below is safe for anybody the procedure will answer,
    and a check here would be decoration over an unguarded read. See `app/(shell)/admin/page.tsx`,
    which spells out the same rule.
  */
  if (profile && profile.role !== "STUDENT") redirect("/instructor");

  /*
    The clock is read once, here, and handed down. Reading it inside the component would put a
    different "now" in the server's render and the browser's, which React reports as a hydration
    mismatch — and it is the reason `dashboardSections` takes it as an argument.
  */
  return <StudentDashboard assignments={assignments} week={week} now={new Date()} />;
}
