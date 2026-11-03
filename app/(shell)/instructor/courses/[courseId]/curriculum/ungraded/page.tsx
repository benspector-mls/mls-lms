import { Suspense } from "react";

import { GradingQueue } from "@/components/instructor/grading-queue";
import { PageFallback } from "@/components/list-states";
import { resolveCohortForCourse } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The grading queue opened on every ungraded submission in the course, across its assignments.
 *
 * A static segment beside `[assignmentId]`, which Next.js matches before the dynamic one, so
 * `ungraded` is never read as an assignment id. The same screen as one assignment's queue, given
 * a different list; see `GradingQueue` for what changes.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here, for the
 * reason the assignment queue's page gives.
 */
export default function UngradedQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} />}>
      <Queue params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Queue({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  const cohorts = await resolveCohortForCourse(courseId, (await searchParams).cohort);
  const data = await queryClient.fetchQuery(
    trpc.submissions.listUngraded.queryOptions({ courseId, cohort: cohorts.cohort }),
  );

  return (
    <GradingQueue
      queue={{ kind: "ungraded", courseId, data }}
      cohorts={cohorts}
      now={new Date()}
    />
  );
}
