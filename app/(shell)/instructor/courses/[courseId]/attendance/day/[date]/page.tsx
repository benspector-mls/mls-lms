import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { AttendanceDay } from "@/components/instructor/attendance-day";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { attendanceHref } from "@/lib/links";
import { formatSchoolDay, schoolDaySchema } from "@/lib/school-time";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * One earlier session, for correcting it.
 *
 * The same component as today's board with a session that is no longer open — every status is
 * still settable, and a correction made three weeks later records *its own* timestamp rather than
 * the session's. "Marked on 26 August" against a column headed 12 August is the audit fact, and it
 * is the one somebody asks about.
 *
 * **Today redirects to the canonical address.** `/attendance` and `/attendance/day/<today>` would
 * otherwise be two addresses for one screen, and the sidebar can only highlight one of them.
 */
export default function AttendanceDayPage({
  params,
}: {
  params: Promise<{ courseId: string; date: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="5xl" />}>
      <Day params={params} />
    </Suspense>
  );
}

async function Day({ params }: { params: Promise<{ courseId: string; date: string }> }) {
  const { courseId, date } = await params;

  // A segment that is not a date at all reaches this before any query runs. `notFound` rather
  // than a refusal, because there is no such address rather than no such session.
  const parsed = schoolDaySchema.safeParse(date);
  if (!parsed.success) notFound();

  const queryClient = getQueryClient();
  const grid = await queryClient.fetchQuery(
    trpc.attendance.grid.queryOptions({ courseId, day: parsed.data }),
  );

  if (grid.isToday) redirect(attendanceHref(courseId));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={formatSchoolDay(grid.day)}
        description={
          grid.session
            ? "Every status here can still be changed. A correction records when you made it."
            : "Nobody started a check-in on this day. Starting one now records it by hand."
        }
      />
      <AttendanceDay data={grid} />
    </div>
  );
}
