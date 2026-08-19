import { Suspense } from "react";

import { AssignmentForm } from "@/components/instructor/assignment-form";
import { PageFallback } from "@/components/list-states";

/**
 * Creating an assignment.
 *
 * One form for every assignment in the application, whatever it belongs to. A `?unit=` in the
 * address is what the "Add …" button inside a unit on the Curriculum screen sends, and it does
 * nothing but pre-select which unit the assignment goes in — so there is one place every field is
 * defined rather than a second form that a later field could be added to only one of.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here — a route
 * may not read uncached data outside `<Suspense>`, and `params` counts.
 */
export default function NewAssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ unit?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="3xl" />}>
      <NewAssignment params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function NewAssignment({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ unit?: string }>;
}) {
  const { courseId } = await params;
  const { unit } = await searchParams;

  return <AssignmentForm courseId={courseId} initialCourseUnitId={unit} />;
}
