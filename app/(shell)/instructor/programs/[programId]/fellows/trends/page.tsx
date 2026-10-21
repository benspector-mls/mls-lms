import { Suspense } from "react";

import { FellowsPage } from "@/components/instructor/fellows-page";
import { PageFallback } from "@/components/list-states";
import { cohortSelectionLabel, parseCohortSelection } from "@/lib/programs/cohorts";
import { resolveCohort } from "@/lib/programs/resolve-cohort";

/**
 * Trends across the whole roster.
 *
 * **A placeholder.** The per-fellow reading of the last few weeks exists on each record's Trends
 * tab and at the top of every coaching session; a reading of the same drift across every fellow at
 * once is not written yet. The tab is here so that the Fellows screen and a fellow's record offer
 * the same tabs, and so the reading has an address waiting for it.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function FellowsTrendsPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={4} width="full" />}>
      <Trends params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Trends({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  const { programId } = await params;
  const query = await searchParams;
  const cohorts = await resolveCohort(programId, query.cohort);
  const selection = parseCohortSelection(cohorts.cohort);

  return (
    <FellowsPage
      programId={programId}
      cohorts={cohorts}
      cohortParam={query.cohort}
      active="trends"
      description={
        selection.kind === "all"
          ? "Every fellow in this program"
          : `Every fellow in ${cohortSelectionLabel(selection, cohorts.cohorts)}`
      }
    >
      <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
        Coming soon. Trends across the whole roster are not read yet; each fellow&apos;s own trends
        are on the Trends tab of their record.
      </p>
    </FellowsPage>
  );
}
