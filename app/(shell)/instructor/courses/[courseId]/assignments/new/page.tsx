import { Suspense } from "react";

import { AssignmentForm } from "@/components/instructor/assignment-form";
import { ListSkeleton } from "@/components/list-states";

/**
 * Creating an assignment.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here — a route
 * may not read uncached data outside `<Suspense>`, and `params` counts.
 */
export default function NewAssignmentPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<Fallback />}>
      <NewAssignment params={params} />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <ListSkeleton rows={6} />
    </div>
  );
}

async function NewAssignment({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <AssignmentForm courseId={courseId} />;
}
