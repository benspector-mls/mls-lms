import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { StudentOverview } from "@/components/instructor/student-overview";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * One student's record within one cohort.
 *
 * Under the course, like every other instructor route, because a student's work only means
 * something inside a cohort — the same person repeating a module has two records, and an address
 * naming only the student would have to pick one.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here — awaiting it
 * in the page component would make the whole route block on per-request data outside a Suspense
 * boundary.
 */
export default function StudentPage({
  params,
}: {
  params: Promise<{ courseId: string; studentId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} />}>
      <Student params={params} />
    </Suspense>
  );
}

async function Student({ params }: { params: Promise<{ courseId: string; studentId: string }> }) {
  const { courseId, studentId } = await params;

  /*
    One read. The procedure refuses a course the caller does not teach and a student who is not in
    it, so there is no separate guard here — and `NOT_FOUND` for a fellow who is not on this course's roster
    is the honest answer, where an empty list would read as somebody who had done nothing.
  */
  const data = await getQueryClient().fetchQuery(
    trpc.submissions.listForStudent.queryOptions({ courseId, studentId }),
  );

  // Read once and passed down, so every relative time on the screen is measured from the same
  // instant. Safe here because the await above already made this render dynamic.
  return <StudentOverview data={data} now={new Date()} />;
}
