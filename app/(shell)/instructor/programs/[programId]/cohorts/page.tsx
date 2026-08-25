import { Suspense } from "react";

import { CohortManager } from "@/components/instructor/cohort-manager";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * How this matriculation's roster is divided among its instructors.
 *
 * **Its own screen rather than a card on the roster**, which is where it lived when it was a
 * per-course grading group. Placing fellows is a decision about every fellow at once — one select
 * per name, saved together — and a control of that size sitting under the roster's tables meant
 * scrolling past the week's work to reach the term's.
 *
 * **No cohort filter, and this is one of two instructor screens without one.** The other is the
 * roster, and for the same reason: a screen narrowed to one cohort could not show the fellow who is
 * in none, who is exactly who an instructor opens this to place.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function CohortsPage({ params }: { params: Promise<{ programId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="5xl" />}>
      <Cohorts params={params} />
    </Suspense>
  );
}

async function Cohorts({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const queryClient = getQueryClient();

  /*
    Both reads, because the screen is a list of cohorts and a placement for every fellow, and
    neither is useful without the other: the list without the placement cannot say who is in a
    cohort, and the placement without the list has nothing to place anybody into.
  */
  const [cohorts, memberships] = await Promise.all([
    queryClient.fetchQuery(trpc.cohorts.listForProgram.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.cohorts.membershipsForProgram.queryOptions({ programId })),
  ]);

  const placed = memberships.length - cohorts.unassignedCount;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Cohorts"
        /*
          Both numbers, because either alone is the wrong claim. "Four cohorts" says nothing about
          whether anybody is in them; "twenty placed" says nothing about how many are left over.
        */
        description={
          cohorts.cohorts.length === 0
            ? "No cohorts yet — every screen shows the whole roster"
            : `${cohorts.cohorts.length} ${cohorts.cohorts.length === 1 ? "cohort" : "cohorts"} · ` +
              `${placed} of ${memberships.length} placed`
        }
      />
      <CohortManager programId={programId} data={cohorts} memberships={memberships} />
    </div>
  );
}
