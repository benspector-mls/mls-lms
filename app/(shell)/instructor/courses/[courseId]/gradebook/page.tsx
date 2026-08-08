import { Suspense } from 'react';

import { Gradebook } from '@/components/instructor/gradebook';
import { ListSkeleton } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { GroupPicker } from '@/components/instructor/group-picker';
import { groupSelectionLabel, parseGroupSelection } from '@/lib/courses/groups';
import { resolveGroup } from '@/lib/courses/resolve-group';
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
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  return (
    <Suspense fallback={<GradebookFallback />}>
      <FullGradebook params={params} searchParams={searchParams} />
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

async function FullGradebook({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { courseId } = await params;
  const groups = await resolveGroup(courseId, (await searchParams).group);
  const data = await getQueryClient().fetchQuery(
    trpc.courses.gradebook.queryOptions({ courseId, group: groups.group }),
  );

  const selection = parseGroupSelection(groups.group);

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Gradebook"
        /*
          "Every student" stops being true the moment a group is chosen, and a grid of eight rows
          is a different claim depending on whether the cohort has eight students. So the
          description says which set it is rather than describing the unfiltered case always.
        */
        description={
          selection.kind === 'all'
            ? `${data.course.cohortTerm} · every student against every assignment`
            : `${data.course.cohortTerm} · ${groupSelectionLabel(selection, groups.groups)} against every assignment`
        }
        actions={
          <GroupPicker
            courseId={courseId}
            value={groups.group}
            groups={groups.groups}
            ungroupedCount={groups.ungroupedCount}
          />
        }
      />

      <Gradebook data={data} />
    </div>
  );
}
