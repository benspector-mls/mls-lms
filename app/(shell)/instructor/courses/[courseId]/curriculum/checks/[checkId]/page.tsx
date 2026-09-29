import { Suspense } from "react";

import { CheckAttempts } from "@/components/instructor/check-attempts";
import { PageFallback } from "@/components/list-states";
import { requireCourseMatch } from "@/lib/instructor/course-scope";
import { checkAttemptsHref } from "@/lib/links";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Every fellow's attempts at one check for understanding.
 *
 * Under the course's curriculum, beside the assignments' grading queues, because it is reached from
 * the resource's row there. The static `checks` segment wins over the sibling `[assignmentId]`, so
 * the two addresses cannot collide.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here — awaiting it
 * in the page component would make the whole route block on per-request data outside a Suspense
 * boundary.
 */
export default function CheckAttemptsPage({
  params,
}: {
  params: Promise<{ courseId: string; checkId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
      <Attempts params={params} />
    </Suspense>
  );
}

async function Attempts({ params }: { params: Promise<{ courseId: string; checkId: string }> }) {
  const { courseId, checkId } = await params;

  // One read. The procedure refuses a check in a course the caller does not teach.
  const data = await getQueryClient().fetchQuery(trpc.checks.attemptsFor.queryOptions({ checkId }));

  requireCourseMatch({
    urlCourseId: courseId,
    assignmentCourseId: data.check.courseId,
    canonical: checkAttemptsHref(data.check.courseId, checkId),
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      {/* Read once and passed down, so every relative time is measured from the same instant. */}
      <CheckAttempts data={data} courseId={courseId} now={new Date()} />
    </div>
  );
}
