import { Suspense } from "react";

import { CheckAttempts } from "@/components/instructor/check-attempts";
import { PageFallback } from "@/components/list-states";
import { requireCourseMatch } from "@/lib/instructor/course-scope";
import { checkAttemptsHref } from "@/lib/links";
import { resolveCohortForCourse } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Every fellow's attempts at one check for understanding.
 *
 * Under the course's curriculum, beside the assignments' grading queues, because it is reached from
 * the resource's row there. The static `checks` segment wins over the sibling `[assignmentId]`, so
 * the two addresses cannot collide.
 *
 * The cohort picker is the one the other course screens carry, resolved the same way: the query
 * string, then the instructor's remembered cohort, then every fellow. The procedure returns every
 * fellow and the screen narrows, so the picker changes nothing about the read.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here — awaiting it
 * in the page component would make the whole route block on per-request data outside a Suspense
 * boundary.
 */
export default function CheckAttemptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; checkId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
      <Attempts params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Attempts({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; checkId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  const { courseId, checkId } = await params;
  const query = await searchParams;

  const [data, cohorts] = await Promise.all([
    // The procedure refuses a check in a course the caller does not teach.
    getQueryClient().fetchQuery(trpc.checks.attemptsFor.queryOptions({ checkId })),
    resolveCohortForCourse(courseId, query.cohort),
  ]);

  requireCourseMatch({
    urlCourseId: courseId,
    assignmentCourseId: data.check.courseId,
    canonical: checkAttemptsHref(data.check.courseId, checkId),
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      {/* Read once and passed down, so every relative time is measured from the same instant. */}
      <CheckAttempts data={data} courseId={courseId} choice={cohorts} now={new Date()} />
    </div>
  );
}
