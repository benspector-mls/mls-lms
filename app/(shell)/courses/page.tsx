import { Suspense } from 'react';

import { CoursesList } from '@/components/student/courses-list';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * `cacheComponents` is enabled, so a route cannot block on per-request data outside a
 * Suspense boundary. Everything here depends on who is signed in, so the page renders a
 * static frame and the read happens in an async child.
 *
 * Unauthenticated visitors never arrive: the proxy redirects them to /auth/login.
 */
export default function CoursesPage() {
  return (
    <Suspense fallback={null}>
      <Courses />
    </Suspense>
  );
}

/**
 * A server component calling the procedures in this process rather than over HTTP, so
 * none of this reading costs client JavaScript.
 */
async function Courses() {
  const queryClient = getQueryClient();
  const [profile, courses] = await Promise.all([
    queryClient.fetchQuery(trpc.me.queryOptions()),
    queryClient.fetchQuery(trpc.courses.listMine.queryOptions()),
  ]);

  return (
    <CoursesList
      courses={courses}
      githubLinked={Boolean(profile?.githubUsername)}
      // Any instructor may start a cohort; the procedure is what refuses, so this decides
      // only whether the button is offered.
      canCreate={profile?.role === 'INSTRUCTOR' || profile?.role === 'ADMIN'}
    />
  );
}
