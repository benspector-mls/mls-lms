import { Suspense } from "react";

import {
  SECTIONS,
  StudentCoaching,
  StudentIdentity,
} from "@/components/instructor/program-student";
import { RecordTabs } from "@/components/instructor/record-tabs";
import { PageFallback } from "@/components/list-states";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The Coaching tab of a fellow's record: what they want to raise, their goals, their sessions, and
 * the instructor's notes — what passes between a coach and a fellow. Claude's reading of the
 * record is on the Trends tab, beside the figures it is read from.
 *
 * **Its own address, because it is where two kinds of link arrive.** A name in the Fellows screen's
 * Coaching table opens here, and finishing or discarding a session returns here, so a reader lands
 * on the sessions and goals rather than on the attendance figures. A session itself is one segment
 * deeper, at `coaching/[sessionId]`.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function ProgramStudentCoachingPage({
  params,
}: {
  params: Promise<{ programId: string; studentId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
      <Coaching params={params} />
    </Suspense>
  );
}

async function Coaching({ params }: { params: Promise<{ programId: string; studentId: string }> }) {
  const { programId, studentId } = await params;
  const queryClient = getQueryClient();
  const [data, coaching, fellows] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.student.queryOptions({ programId, studentId })),
    queryClient.fetchQuery(trpc.coaching.forStudent.queryOptions({ programId, studentId })),
    queryClient.fetchQuery(trpc.enrollments.listForProgram.queryOptions({ programId })),
  ]);

  return (
    <RecordTabs
      programId={programId}
      studentId={studentId}
      header={<StudentIdentity data={data} fellows={fellows} />}
      active="coaching"
      sections={SECTIONS.coaching}
    >
      <StudentCoaching data={data} coaching={coaching} />
    </RecordTabs>
  );
}
