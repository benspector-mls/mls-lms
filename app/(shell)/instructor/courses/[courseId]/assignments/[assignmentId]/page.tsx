import { Suspense } from "react";

import { GradingQueue } from "@/components/instructor/grading-queue";
import { ListSkeleton } from "@/components/list-states";
import { resolveGroup } from "@/lib/courses/resolve-group";
import { requireCourseMatch } from "@/lib/instructor/course-scope";
import { gradingQueueHref } from "@/lib/links";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The grading queue for one assignment.
 *
 * Beside `edit/`, under the course that owns the assignment. The course is redundant here
 * — an assignment already knows its course — and it is in the address anyway, because the
 * sidebar reads the current cohort from the URL and nowhere else. Without it, walking from
 * triage into a queue would silently change which course the switcher claimed you were in.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here —
 * awaiting it in the page component would make the whole route block on per-request data
 * outside a Suspense boundary.
 */
export default function GradingQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  return (
    <Suspense fallback={<QueueFallback />}>
      <Queue params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function QueueFallback() {
  return (
    <div className="p-4 md:p-6">
      <ListSkeleton rows={8} />
    </div>
  );
}

/**
 * The list is read here; each review pane loads its own draft and test runs in the
 * browser, since selecting a student must not cost a page navigation.
 */
async function Queue({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { courseId, assignmentId } = await params;
  const queryClient = getQueryClient();

  /*
    Resolved against the course in the address rather than the assignment's own, which are the
    same course — `requireCourseMatch` below redirects when they are not. Reading the URL's is
    what lets this happen before the assignment has been fetched.
  */
  const groups = await resolveGroup(courseId, (await searchParams).group);

  // Both, because the completion threshold decides whether a score passes and is not on
  // the submission list.
  const [data, assignment] = await Promise.all([
    queryClient.fetchQuery(
      trpc.submissions.listForAssignment.queryOptions({ assignmentId, group: groups.group }),
    ),
    queryClient.fetchQuery(trpc.assignments.get.queryOptions({ assignmentId })),
  ]);

  requireCourseMatch({
    urlCourseId: courseId,
    assignmentCourseId: assignment.courseId,
    canonical: gradingQueueHref(assignment.courseId, assignmentId),
  });

  return (
    <GradingQueue
      data={data}
      courseId={courseId}
      groups={groups}
      completionThreshold={assignment.completionThreshold}
      now={new Date()}
    />
  );
}
