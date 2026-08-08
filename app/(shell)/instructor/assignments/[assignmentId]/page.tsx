import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/list-states";
import { gradingQueueHref } from "@/lib/links";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The grading queue's old address, which named the assignment and not the course.
 *
 * Kept because links to it are already in the wild — in a browser history, in a message
 * to a colleague — and because it costs one lookup to answer correctly. The assignment
 * knows its course, so there is exactly one right destination.
 */
export default function LegacyGradingQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ submission?: string }>;
}) {
  return (
    <Suspense fallback={<Fallback />}>
      <ToCourseScopedQueue params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="p-4 md:p-6">
      <ListSkeleton rows={8} />
    </div>
  );
}

async function ToCourseScopedQueue({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ submission?: string }>;
}) {
  const [{ assignmentId }, { submission }] = await Promise.all([params, searchParams]);

  // Carried across, because this is the shape the triage list and the gradebook cells
  // linked to: the address that opens one student's work rather than the whole pile.
  const assignment = await getQueryClient().fetchQuery(
    trpc.assignments.get.queryOptions({ assignmentId }),
  );

  // Returned rather than called bare so the inferred type stays `never`: a component whose
  // body falls off the end is typed as rendering `void`, which is not a React node.
  return redirect(gradingQueueHref(assignment.courseId, assignmentId, submission));
}
