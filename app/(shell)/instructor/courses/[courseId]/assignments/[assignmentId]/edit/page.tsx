import { Suspense } from "react";

import { editAssignmentHref } from "@/lib/links";
import { AssignmentForm } from "@/components/instructor/assignment-form";
import { PageFallback } from "@/components/list-states";
import { requireCourseMatch } from "@/lib/instructor/course-scope";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Editing an assignment.
 *
 * The draft is fetched on the server so the form renders filled in rather than empty and then
 * populated. `getDraft` is instructor-only and teach-gated, which is also what refuses a
 * caller who reaches this URL for a course they do not teach.
 */
export default function EditAssignmentPage({
  params,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="3xl" />}>
      <EditAssignment params={params} />
    </Suspense>
  );
}

async function EditAssignment({
  params,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
}) {
  const { courseId, assignmentId } = await params;
  const existing = await getQueryClient().fetchQuery(
    trpc.assignments.getDraft.queryOptions({ assignmentId }),
  );

  requireCourseMatch({
    urlCourseId: courseId,
    assignmentCourseId: existing.courseId,
    canonical: editAssignmentHref(existing.courseId, assignmentId),
  });

  return <AssignmentForm courseId={courseId} existing={existing} />;
}
