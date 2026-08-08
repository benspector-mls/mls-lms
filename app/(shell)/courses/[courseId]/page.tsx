import { Suspense } from 'react';

import { ListSkeleton } from '@/components/list-states';
import { StudentCourseDetail } from '@/components/student/course-detail';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * `cacheComponents` is enabled, so a route cannot block on per-request data outside a
 * Suspense boundary — and `params` counts. Awaiting it here would make the whole route
 * block; it is passed down and awaited in the async child instead.
 */
export default function CourseAssignmentsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  return (
    <Suspense fallback={<CourseFallback />}>
      <CourseDetail params={params} />
    </Suspense>
  );
}

function CourseFallback() {
  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <ListSkeleton rows={6} />
    </div>
  );
}

/**
 * A server component calling the procedures in this process rather than over HTTP. The
 * assignment list, its feedback history included, therefore costs no client JavaScript —
 * only the collapsing and the two mutations run in the browser.
 */
async function CourseDetail({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  const [profile, course, assignments, resources] = await Promise.all([
    queryClient.fetchQuery(trpc.me.queryOptions()),
    queryClient.fetchQuery(trpc.courses.get.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.assignments.listForCourse.queryOptions({ courseId })),
    // Its own read rather than part of the assignment list: a resource is a sibling of an
    // assignment under a module, not a kind of assignment, and the two are merged on the page.
    queryClient.fetchQuery(trpc.resources.listForCourse.queryOptions({ courseId })),
  ]);

  return (
    <StudentCourseDetail
      course={course}
      assignments={assignments}
      resources={resources}
      githubLinked={Boolean(profile?.githubUsername)}
    />
  );
}
