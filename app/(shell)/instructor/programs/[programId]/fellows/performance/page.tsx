import { Suspense } from "react";

import { CourseFilter } from "@/components/instructor/course-filter";
import { FellowsPage } from "@/components/instructor/fellows-page";
import { ProgramPerformance } from "@/components/instructor/performance";
import { PageFallback } from "@/components/list-states";
import { cohortSelectionLabel, parseCohortSelection } from "@/lib/programs/cohorts";
import { resolveCohort } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * How every fellow on the program's roster is doing, and who needs support this week.
 *
 * **The Performance tab of the Fellows screen**, read weekly in the cohort meeting to decide who
 * to talk to. It sorts every fellow into a group by the attendance and work rules, and draws each
 * one's attendance and per-course work so the reader sees why.
 *
 * **It carries a course filter of its own**, which narrows the course bands drawn without changing
 * anybody's group; see `CourseFilter`. The cohort picker is the frame's, shared with every tab.
 *
 * The rule is `performanceBucket` in lib/programs/performance.ts, and the figures come from
 * `programs.performance`.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function FellowsPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="full" />}>
      <Performance params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Performance({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  const { programId } = await params;
  const query = await searchParams;
  const cohorts = await resolveCohort(programId, query.cohort);
  const queryClient = getQueryClient();

  const data = await queryClient.fetchQuery(
    trpc.programs.performance.queryOptions({ programId, cohort: cohorts.cohort }),
  );

  const selection = parseCohortSelection(cohorts.cohort);
  const cohortName = new Map(cohorts.cohorts.map((cohort) => [cohort.id, cohort.name]));
  const count = data.fellows.length;

  return (
    <FellowsPage
      programId={programId}
      cohorts={cohorts}
      cohortParam={query.cohort}
      active="performance"
      /*
        Names the set when a cohort is chosen, because "15 fellows" under a picker set to one
        cohort is otherwise a claim about the program.
      */
      description={`${count} ${count === 1 ? "fellow" : "fellows"} in ${
        selection.kind === "all" ? "this program" : cohortSelectionLabel(selection, cohorts.cohorts)
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Attendance, and work across every course.</p>
        <CourseFilter courses={data.courses} programArchived={data.programArchived} />
      </div>
      <ProgramPerformance programId={programId} data={data} cohortName={cohortName} />
    </FellowsPage>
  );
}
