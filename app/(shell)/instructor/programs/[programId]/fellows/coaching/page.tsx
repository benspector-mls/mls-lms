import { Suspense } from "react";

import { CoachingOverview } from "@/components/instructor/coaching-overview";
import { FellowsPage } from "@/components/instructor/fellows-page";
import { PageFallback } from "@/components/list-states";
import { cohortSelectionLabel, parseCohortSelection } from "@/lib/programs/cohorts";
import { resolveCohort } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The same fellows read from the coaching side: the temperature and check-in answers from each
 * one's most recent completed session, and the goals they are working on in each competency group.
 *
 * **The Coaching tab of the Fellows screen.** Each name opens that fellow's record on its Coaching
 * tab, because somebody reading this table and clicking a name wants the sessions and goals behind
 * the row rather than the attendance figures.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function FellowsCoachingPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="full" />}>
      <Coaching params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Coaching({
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

  const coaching = await queryClient.fetchQuery(
    trpc.coaching.overview.queryOptions({ programId, cohort: cohorts.cohort }),
  );

  const selection = parseCohortSelection(cohorts.cohort);
  const cohortName = new Map(cohorts.cohorts.map((cohort) => [cohort.id, cohort.name]));
  const count = coaching.fellows.length;

  return (
    <FellowsPage
      programId={programId}
      cohorts={cohorts}
      cohortParam={query.cohort}
      active="coaching"
      description={`${count} ${count === 1 ? "fellow" : "fellows"} in ${
        selection.kind === "all" ? "this program" : cohortSelectionLabel(selection, cohorts.cohorts)
      }`}
    >
      <CoachingOverview programId={programId} data={coaching} cohortName={cohortName} />
    </FellowsPage>
  );
}
