import { Suspense } from 'react';

import { Gradebook } from '@/components/instructor/gradebook';
import { ListSkeleton } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * Every student against every assignment.
 *
 * The back link to the course page is gone with the tab bar that made it necessary. The
 * gradebook is its own sidebar item now, so the way to anywhere else in the cohort is the
 * sidebar rather than a link back to a page that no longer lists anything.
 */
export default function GradebookPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  return (
    <Suspense fallback={<GradebookFallback />}>
      <FullGradebook params={params} />
    </Suspense>
  );
}

function GradebookFallback() {
  return (
    <div className="p-4 md:p-6">
      <ListSkeleton rows={10} />
    </div>
  );
}

async function FullGradebook({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const data = await getQueryClient().fetchQuery(
    trpc.courses.gradebook.queryOptions({ courseId }),
  );

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Gradebook"
        description={`${data.course.cohortTerm} · every student against every assignment`}
      />

      <Gradebook data={data} />
    </div>
  );
}
