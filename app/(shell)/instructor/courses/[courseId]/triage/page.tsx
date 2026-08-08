import { Suspense } from "react";

import { ListSkeleton } from "@/components/list-states";
import { TriageOverview } from "@/components/instructor/triage-overview";
import { resolveGroup } from "@/lib/courses/resolve-group";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * What is waiting on the instructor in one cohort.
 *
 * Under the course rather than at `/instructor`, because the course is what scopes it. An
 * instructor teaching two cohorts at once was previously shown both piles interleaved,
 * with no way to ask about one of them, and the sidebar had no course to name while they
 * read it. Both are the same missing fact: which cohort this screen is about.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here —
 * awaiting it in the page component would make the whole route block on per-request data
 * outside a Suspense boundary.
 */
export default function TriagePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  return (
    <Suspense fallback={<TriageFallback />}>
      <Triage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function TriageFallback() {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <ListSkeleton rows={6} />
    </div>
  );
}

async function Triage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  /*
    Before the pile, because the pile is fetched for a particular group. `resolveGroup` is what
    decides which: the query string if there is one, the instructor's remembered group if not.
  */
  const groups = await resolveGroup(courseId, (await searchParams).group);

  // The course as well as the pile, because the heading names the cohort — and because a
  // heading that named nothing would leave two cohorts' triage screens looking identical,
  // which is the thing this route exists to fix.
  const [course, triage] = await Promise.all([
    queryClient.fetchQuery(trpc.courses.get.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.submissions.triage.queryOptions({ courseId, group: groups.group })),
  ]);

  /*
    Read once, here, and passed down. Every "3 hr ago" on the screen is then measured
    from the same instant, and reading the clock inside a component cannot make two of
    them disagree. Safe in this position because the render is already dynamic — the
    awaits above see to that — where a cached one would refuse.
  */
  return (
    <TriageOverview
      triage={triage}
      courseId={courseId}
      courseName={course.name}
      cohortTerm={course.cohortTerm}
      archived={course.archivedAt !== null}
      groups={groups}
      now={new Date()}
    />
  );
}
