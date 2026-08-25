import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { StudentAttendanceRecord } from "@/components/student/attendance-record";
import { CheckInCard } from "@/components/student/check-in-card";
import { schoolDayOf } from "@/lib/school-time";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * A fellow's own attendance in one matriculation, and where they check in.
 *
 * **Both halves on one screen**, which is the whole reason check-in moved off the dashboard. A
 * fellow had a card stacked above the one screen that answers "what is due", and typing a code is
 * not something anybody does from a list of overdue assignments. Here the code goes in beside the
 * record it becomes a row of.
 *
 * **One address per matriculation rather than per course.** A fellow arrives at the building once, so
 * three courses meeting on a Tuesday are one morning and one code — which is why this screen is
 * reached from beside the program's name in the sidebar rather than from inside a course.
 *
 * `attendance.myHistory` is guarded by `assertProgramMember` rather than `assertActiveInProgram`, so
 * a fellow removed from a program keeps reading their own record here — the same rule that keeps
 * their released feedback readable. Check-in itself refuses them, which is the right pair.
 */
export default function MyAttendancePage({ params }: { params: Promise<{ programId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="4xl" />}>
      <MyAttendance params={params} />
    </Suspense>
  );
}

async function MyAttendance({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const queryClient = getQueryClient();

  const [data, openNow] = await Promise.all([
    queryClient.fetchQuery(trpc.attendance.myHistory.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.attendance.today.queryOptions()),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Your attendance" description={data.program.name} />

      {/*
        Above the record, and it renders nothing on the days there is no session — so this screen
        is a record most of the time and a place to check in for ten minutes a day.
      */}
      <CheckInCard programId={programId} initial={openNow} />

      {/*
        The clock is read once, here, and handed down, so the server and the browser agree about
        which square on the calendar is today. Reading it inside the component would put a
        different answer in each render, which React reports as a hydration mismatch.
      */}
      <StudentAttendanceRecord data={data} today={schoolDayOf(new Date())} />
    </div>
  );
}
