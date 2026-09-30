import { Suspense } from "react";

import { CohortPicker } from "@/components/instructor/cohort-picker";
import { ProgramPerformance } from "@/components/instructor/performance";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { cohortSelectionLabel, parseCohortSelection } from "@/lib/programs/cohorts";
import { resolveCohort } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * How every fellow on the program's roster is doing, and who needs support this week.
 *
 * **Its own screen rather than a tab of the roster.** The roster is where membership is managed —
 * who is enrolled, which cohort they are in, the join link — and that is done at the start of a
 * term and when somebody arrives or leaves. This is read weekly to decide who to talk to, and an
 * instructor doing that has no reason to be on the roster's tabs in the same sitting.
 *
 * **It carries the cohort picker**, so an instructor who works with fifteen fellows reads their
 * fifteen, and No cohort shows the fellows nobody has placed.
 *
 * The rule is `performanceBucket` in lib/programs/performance.ts, and the figures come from
 * `programs.performance`.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function PerformancePage({
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
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Performance"
        /*
          Names the set when a cohort is chosen, because "15 fellows" under a picker set to one
          cohort is otherwise a claim about the program.
        */
        description={`${count} ${count === 1 ? "fellow" : "fellows"} in ${
          selection.kind === "all"
            ? "this program"
            : cohortSelectionLabel(selection, cohorts.cohorts)
        } · attendance, and work across every course`}
        actions={<CohortPicker choice={cohorts} />}
      />
      <ProgramPerformance programId={programId} data={data} cohortName={cohortName} />
    </div>
  );
}
