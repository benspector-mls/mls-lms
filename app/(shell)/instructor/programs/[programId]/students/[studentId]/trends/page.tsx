import { Suspense } from "react";

import { PreparationSummary } from "@/components/instructor/preparation-summary";
import { SECTIONS, StudentIdentity } from "@/components/instructor/program-student";
import { RecordTabs } from "@/components/instructor/record-tabs";
import { Trends } from "@/components/instructor/trends";
import { PageFallback } from "@/components/list-states";
import { displayNameOf } from "@/lib/people";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The Trends tab of a fellow's record: the last few weeks across attendance, work and
 * understanding in one card, and beneath it Themes, Claude's reading of the whole record.
 *
 * **The same card a coaching session opens with**, drawn from the same figures `programs.student`
 * returns for the Performance tab's inline readings, so the two tabs cannot disagree about the
 * same fellow. The Performance tab draws each reading inside the area it belongs to; this tab is
 * for the reader who wants every recent reading in one place.
 *
 * **Themes are here rather than on the Coaching tab** because they are the same kind of thing as
 * the card above them: a reading of the fellow, made for the coach and never shown to the fellow.
 * The card is the figures of the last few weeks; the themes are what Claude makes of the record,
 * figures and writing together. The Coaching tab is left to what passes between a coach and a
 * fellow — topics, goals, sessions and notes.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function ProgramStudentTrendsPage({
  params,
}: {
  params: Promise<{ programId: string; studentId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
      <StudentTrends params={params} />
    </Suspense>
  );
}

async function StudentTrends({
  params,
}: {
  params: Promise<{ programId: string; studentId: string }>;
}) {
  const { programId, studentId } = await params;
  const queryClient = getQueryClient();
  const [data, fellows, summaries] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.student.queryOptions({ programId, studentId })),
    queryClient.fetchQuery(trpc.enrollments.listForProgram.queryOptions({ programId })),
    queryClient.fetchQuery(
      trpc.coachingSummaries.forStudent.queryOptions({ programId, studentId }),
    ),
  ]);

  return (
    <RecordTabs
      programId={programId}
      studentId={studentId}
      header={<StudentIdentity data={data} fellows={fellows} />}
      active="trends"
      sections={SECTIONS.trends}
    >
      <Trends
        id="trends"
        level={2}
        recentAttendance={data.recentAttendance}
        arrivals={data.arrivals}
        courses={data.courses}
        note="Every coaching session opens with this same card."
      />
      <PreparationSummary
        id="themes"
        programId={programId}
        studentId={studentId}
        name={displayNameOf(data.student, "Unnamed")}
        summaries={summaries}
      />
    </RecordTabs>
  );
}
