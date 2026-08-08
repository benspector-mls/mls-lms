import Link from 'next/link';
import { Suspense } from 'react';
import { Plus } from 'lucide-react';

import { CourseAssignments } from '@/components/instructor/assignments-list';
import { ListSkeleton } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { GroupPicker } from '@/components/instructor/group-picker';
import { groupSelectionLabel, parseGroupSelection } from '@/lib/courses/groups';
import { resolveGroup } from '@/lib/courses/resolve-group';
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
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  return (
    <Suspense fallback={<AssignmentsFallback />}>
      <Assignments params={params} searchParams={searchParams} />
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

async function Assignments({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { courseId } = await params;
  const groups = await resolveGroup(courseId, (await searchParams).group);
  const data = await getQueryClient().fetchQuery(
    trpc.courses.assignmentsOverview.queryOptions({ courseId, group: groups.group }),
  );

  const selection = parseGroupSelection(groups.group);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Assignments"
        /*
          The count of assignments never changes with the group — a group narrows students, never
          work — so the group is named beside it rather than instead of it. Every "to grade"
          figure in the table below *is* narrowed, which is what has to be said out loud.
        */
        description={
          selection.kind === 'all'
            ? `${data.assignments.length} in this cohort`
            : `${data.assignments.length} in this cohort · to grade counted for ${groupSelectionLabel(selection, groups.groups)}`
        }
        actions={
          <>
            <GroupPicker
              courseId={courseId}
              value={groups.group}
              groups={groups.groups}
              ungroupedCount={groups.ungroupedCount}
            />
            <Link href={newAssignmentHref(courseId)} className={cn(buttonVariants({ size: 'sm' }))}>
              <Plus data-icon="inline-start" />
              New assignment
            </Link>
          </>
        }
      />
      <CourseAssignments data={data} />
    </div>
  );
}
