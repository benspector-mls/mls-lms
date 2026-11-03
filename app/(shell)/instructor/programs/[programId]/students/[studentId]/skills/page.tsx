import { Suspense } from "react";

import { SECTIONS, StudentIdentity } from "@/components/instructor/program-student";
import { RecordTabs } from "@/components/instructor/record-tabs";
import { StudentSkills } from "@/components/instructor/student-skills";
import { PageFallback } from "@/components/list-states";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The Skills tab of a fellow's record: their term figure for each graded skill, and beneath it
 * every section those figures rest on, in date order under the skill it counted toward.
 *
 * **The same figures the Fellows Skills tab shows for the roster, for one person**, from the same
 * computation (`programs.studentSkills` and `programs.skills` both go through `skillFigures`), so
 * the two tabs cannot disagree about the same fellow. What this tab adds is the history, which is
 * the reading of development that a single figure hides.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function ProgramStudentSkillsPage({
  params,
}: {
  params: Promise<{ programId: string; studentId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
      <StudentSkillsTab params={params} />
    </Suspense>
  );
}

async function StudentSkillsTab({
  params,
}: {
  params: Promise<{ programId: string; studentId: string }>;
}) {
  const { programId, studentId } = await params;
  const queryClient = getQueryClient();
  const [data, fellows, skills] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.student.queryOptions({ programId, studentId })),
    queryClient.fetchQuery(trpc.enrollments.listForProgram.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.programs.studentSkills.queryOptions({ programId, studentId })),
  ]);

  return (
    <RecordTabs
      programId={programId}
      studentId={studentId}
      header={<StudentIdentity data={data} fellows={fellows} />}
      active="skills"
      sections={SECTIONS.skills}
    >
      <StudentSkills skills={skills} studentId={studentId} />
    </RecordTabs>
  );
}
