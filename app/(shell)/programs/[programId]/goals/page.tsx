import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { GoalsRecord } from "@/components/student/goals-record";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * A fellow's own goals and coaching history in one program.
 *
 * The reading half of coaching: the goals agreed in sessions, each with its development marker,
 * and a dated performance snapshot per completed session. The staff half — the check-in answers
 * and the notes — is not in this payload at all; see `coaching.myGoals`.
 *
 * Beside Attendance in the sidebar and shaped like it: one address per program, because goals are
 * agreed within a program's coaching, and readable after removal for the same reason a removed
 * fellow keeps their attendance record.
 */
export default function MyGoalsPage({ params }: { params: Promise<{ programId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="4xl" />}>
      <MyGoals params={params} />
    </Suspense>
  );
}

async function MyGoals({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const data = await getQueryClient().fetchQuery(trpc.coaching.myGoals.queryOptions({ programId }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Your goals" description={`${data.program.name} · ${data.program.term}`} />
      <GoalsRecord data={data} />
    </div>
  );
}
