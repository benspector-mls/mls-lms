import { Suspense } from "react";

import { AssignmentForm } from "@/components/instructor/assignment-form";
import { PageFallback } from "@/components/list-states";

/**
 * Creating an assignment.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here — a route
 * may not read uncached data outside `<Suspense>`, and `params` counts.
 */
export default function NewAssignmentPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="3xl" />}>
      <NewAssignment params={params} />
    </Suspense>
  );
}

async function NewAssignment({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <AssignmentForm courseId={courseId} />;
}
