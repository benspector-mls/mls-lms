import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { TriageOverview } from "@/components/instructor/triage-overview";
import { resolveCohortForCourse } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * What is waiting on the instructor in one course.
 *
 * Under the course rather than at `/instructor`, because the course is what scopes it. An
 * instructor teaching two courses at once was previously shown both piles interleaved, with no
 * way to ask about one of them, and the sidebar had no course to name while they read it. Both
 * are the same missing fact: which course this screen is about.
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
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="5xl" />}>
      <Triage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Triage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  /*
    Before the pile, because the pile is fetched for a particular cohort. `resolveCohortForCourse`
    is what decides which: the query string if there is one, the instructor's remembered cohort if
    not. It reads the course to find the program the cohorts divide, which is the same read as the
    one below — the request's query client answers the second from what the first fetched.
  */
  const cohorts = await resolveCohortForCourse(courseId, (await searchParams).cohort);

  // The course as well as the pile, because the heading names the course and its term — and
  // because a heading that named nothing would leave two courses' triage screens looking
  // identical, which is the thing this route exists to fix.
  const [course, triage] = await Promise.all([
    queryClient.fetchQuery(trpc.courses.get.queryOptions({ courseId })),
    queryClient.fetchQuery(
      trpc.submissions.triage.queryOptions({ courseId, cohort: cohorts.cohort }),
    ),
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
      courseName={course.name}
      term={course.program.term}
      archived={course.archivedAt !== null}
      cohorts={cohorts}
      now={new Date()}
    />
  );
}
