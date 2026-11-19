import { Suspense } from "react";

import { SECTIONS, StudentIdentity } from "@/components/instructor/program-student";
import { RecordTabs } from "@/components/instructor/record-tabs";
import { PageFallback } from "@/components/list-states";
import { StudentTutor } from "@/components/tutor/tutor-transcripts";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The Tutor tab of a fellow's record: their conversations with the Tutor across the program's
 * courses. See `StudentTutor`.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function ProgramStudentTutorPage({
  params,
}: {
  params: Promise<{ programId: string; studentId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
      <Tutor params={params} />
    </Suspense>
  );
}

async function Tutor({ params }: { params: Promise<{ programId: string; studentId: string }> }) {
  const { programId, studentId } = await params;
  const queryClient = getQueryClient();
  const [data, transcripts, fellows] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.student.queryOptions({ programId, studentId })),
    queryClient.fetchQuery(trpc.tutor.transcripts.queryOptions({ programId, studentId })),
    queryClient.fetchQuery(trpc.enrollments.listForProgram.queryOptions({ programId })),
  ]);

  return (
    <RecordTabs
      programId={programId}
      studentId={studentId}
      header={<StudentIdentity data={data} fellows={fellows} />}
      active="tutor"
      sections={SECTIONS.tutor}
    >
      <StudentTutor transcripts={transcripts} />
    </RecordTabs>
  );
}
