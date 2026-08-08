import { Suspense } from 'react';

import { CourseResources } from '@/components/instructor/resources-view';
import { ListSkeleton } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * Everything in the cohort that is not work: readings, notes, and videos.
 *
 * Its own sidebar item beside Assignments, and the seventh course-scoped view. A resource is
 * never graded, never handed in, and never in the gradebook — so nothing on this screen carries
 * a due date, a point value, or a state, and there is no group filter either: a group narrows
 * students, and a resource has none.
 *
 * No group picker for that reason, which is the only instructor screen besides the roster
 * without one.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function CourseResourcesPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  return (
    <Suspense fallback={<ResourcesFallback />}>
      <Resources params={params} />
    </Suspense>
  );
}

function ResourcesFallback() {
  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <ListSkeleton rows={6} />
    </div>
  );
}

async function Resources({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  // The modules as well as the resources: every module is a section on this screen, including
  // the empty ones, because an empty module is where the Add button for its first resource is.
  const [modules, resources] = await Promise.all([
    queryClient.fetchQuery(trpc.modules.listForCourse.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.resources.listForCourse.queryOptions({ courseId })),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Resources"
        description={
          resources.length === 0
            ? 'Readings, notes, and videos — nothing here is graded'
            : `${resources.length} in this cohort · nothing here is graded`
        }
      />
      <CourseResources modules={modules} resources={resources} />
    </div>
  );
}
