import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { StudentAttendanceRecord } from "@/components/student/attendance-record";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * A fellow's own attendance in one cohort.
 *
 * Reached from the check-in card and from their course page — deliberately not a sidebar item, and
 * deliberately not on the dashboard. It is a fact about one course, and the dashboard's own group
 * is the one place in this application that spans them.
 *
 * `attendance.myHistory` is guarded by `assertCourseMember` rather than `assertActiveStudent`, so
 * a fellow removed from a cohort keeps reading their own record here — the same rule that keeps
 * their released feedback readable.
 */
export default function MyAttendancePage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="4xl" />}>
      <MyAttendance params={params} />
    </Suspense>
  );
}

async function MyAttendance({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  const data = await queryClient.fetchQuery(trpc.attendance.myHistory.queryOptions({ courseId }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Your attendance" description={data.course.name} />
      <StudentAttendanceRecord data={data} />
    </div>
  );
}
