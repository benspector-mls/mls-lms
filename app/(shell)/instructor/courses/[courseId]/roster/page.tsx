import { Suspense } from 'react';

import { GroupManager } from '@/components/instructor/group-manager';
import { CourseRoster } from '@/components/instructor/roster';
import { ListSkeleton } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * Who is in this cohort, and the link that puts them there.
 *
 * Reads `courses.roster` rather than the gradebook, which is the point of that procedure
 * existing: this screen needs every enrollment and no submissions at all, and it used to fetch
 * a term's worth of grading cells to display a list of names.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function RosterPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<RosterFallback />}>
      <Roster params={params} />
    </Suspense>
  );
}

function RosterFallback() {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <ListSkeleton rows={6} />
    </div>
  );
}

async function Roster({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  /*
    No group filter on this screen, deliberately, and it is the only instructor screen without
    one. The roster is where groups are *made*; a roster narrowed to a group could not show the
    student who is in none, which is exactly who an instructor comes here to place.
  */
  const [data, groups, memberships] = await Promise.all([
    queryClient.fetchQuery(trpc.courses.roster.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.groups.listForCourse.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.groups.membershipsForCourse.queryOptions({ courseId })),
  ]);

  const active = data.enrollments.filter((enrollment) => enrollment.status === 'ACTIVE').length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Roster"
        description={`${active} ${active === 1 ? 'student' : 'students'} in this cohort`}
      />
      <CourseRoster data={data} />
      <GroupManager courseId={courseId} data={groups} memberships={memberships} />
    </div>
  );
}
