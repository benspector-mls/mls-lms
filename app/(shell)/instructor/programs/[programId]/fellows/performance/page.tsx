import { Suspense } from "react";

import { CourseFilter } from "@/components/instructor/course-filter";
import { FellowsPage } from "@/components/instructor/fellows-page";
import { ProgramPerformance } from "@/components/instructor/performance";
import { WindowFilter } from "@/components/instructor/window-filter";
import { PageFallback } from "@/components/list-states";
import { cohortSelectionLabel, parseCohortSelection } from "@/lib/programs/cohorts";
import { resolveCohort } from "@/lib/programs/resolve-cohort";
import { schoolDayOf } from "@/lib/school-time";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * How every fellow on the program's roster is doing, and who needs support this week.
 *
 * **The Performance tab of the Fellows screen**, read weekly in the cohort meeting to decide who
 * to talk to. It sorts every fellow into a group by the attendance and work rules, and draws each
 * one's attendance and per-course work so the reader sees why.
 *
 * **It carries a course filter and a window filter of its own.** The course filter narrows the
 * course bands drawn and the courses the groups read; see `CourseFilter`. The window filter picks
 * the days the recent columns count over, two weeks ending today unless chosen; see
 * `WindowFilter`. The cohort picker is the frame's, shared with every tab.
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
  searchParams: Promise<{ cohort?: string; from?: string; to?: string }>;
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
  searchParams: Promise<{ cohort?: string; from?: string; to?: string }>;
}) {
  const { programId } = await params;
  const query = await searchParams;
  const cohorts = await resolveCohort(programId, query.cohort);
  const queryClient = getQueryClient();

  const data = await queryClient.fetchQuery(
    trpc.programs.performance.queryOptions({
      programId,
      cohort: cohorts.cohort,
      from: query.from,
      to: query.to,
    }),
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
        <WindowFilter window={data.window} today={schoolDayOf(new Date())} />
        <CourseFilter courses={data.courses} programArchived={data.programArchived} />
      </div>
      <ProgramPerformance programId={programId} data={data} cohortName={cohortName} />
    </FellowsPage>
  );
}
