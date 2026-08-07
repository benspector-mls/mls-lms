import Link from 'next/link';
import { Suspense } from 'react';
import { Plus } from 'lucide-react';

import { CourseAssignments } from '@/components/instructor/assignments-list';
import { ListSkeleton } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { newAssignmentHref } from '@/lib/links';
import { cn } from '@/lib/utils';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * Every assignment in one cohort, and where new ones are made.
 *
 * An index route sitting alongside `assignments/new` and `assignments/[assignmentId]`, which
 * are one assignment rather than the list. `sameViewInCourse` tells the two apart by segment
 * count, because only the list exists in every cohort and can carry across a switch.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function CourseAssignmentsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  return (
    <Suspense fallback={<AssignmentsFallback />}>
      <Assignments params={params} />
    </Suspense>
  );
}

function AssignmentsFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <ListSkeleton rows={8} />
    </div>
  );
}

async function Assignments({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const data = await getQueryClient().fetchQuery(
    trpc.courses.assignmentsOverview.queryOptions({ courseId }),
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Assignments"
        description={`${data.assignments.length} in this cohort`}
        actions={
          <Link href={newAssignmentHref(courseId)} className={cn(buttonVariants({ size: 'sm' }))}>
            <Plus data-icon="inline-start" />
            New assignment
          </Link>
        }
      />
      <CourseAssignments data={data} />
    </div>
  );
}
