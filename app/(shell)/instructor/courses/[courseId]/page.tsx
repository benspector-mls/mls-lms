import { Suspense } from 'react';

import { InstructorCourseDetail } from '@/components/instructor/course-detail';
import { ListSkeleton } from '@/components/list-states';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * One course from the instructor's side.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function InstructorCoursePage({
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
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <ListSkeleton rows={8} />
    </div>
  );
}

async function CourseDetail({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const data = await getQueryClient().fetchQuery(
    trpc.courses.gradebook.queryOptions({ courseId }),
  );

  return <InstructorCourseDetail data={data} />;
}
