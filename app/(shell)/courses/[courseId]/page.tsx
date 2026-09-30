import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { StudentCourseDetail } from "@/components/student/course-detail";
import { getQueryClient, trpc } from "@/trpc/server";

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
    <Suspense fallback={<PageFallback rows={6} width="4xl" />}>
      <CourseDetail params={params} />
    </Suspense>
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

  const [profile, course, assignments, resources, checkProgress, viewingAs] = await Promise.all([
    queryClient.fetchQuery(trpc.me.queryOptions()),
    queryClient.fetchQuery(trpc.courses.get.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.assignments.listForCourse.queryOptions({ courseId })),
    // Its own read rather than part of the assignment list: a resource is a sibling of an
    // assignment under a module, not a kind of assignment, and the two are merged on the page.
    queryClient.fetchQuery(trpc.resources.listForCourse.queryOptions({ courseId })),
    // The fellow's own attempts at the checks for understanding on those resources. Empty for an
    // instructor looking at the page, who has none.
    queryClient.fetchQuery(trpc.checks.myAttempts.queryOptions({ courseId })),
    // Whether an instructor is looking through this fellow's account, which greys every control
    // that would write. The server refuses those writes either way.
    queryClient.fetchQuery(trpc.viewingAs.queryOptions()),
  ]);

  return (
    <StudentCourseDetail
      course={course}
      assignments={assignments}
      resources={resources}
      checkProgress={checkProgress}
      githubLinked={Boolean(profile?.githubUsername)}
      /*
        Read once here and passed down, which is the convention every screen in this application
        follows. A component that reads its own clock renders one string on the server and another
        in the browser's first pass, which React reports as a hydration mismatch.
      */
      now={new Date()}
      readOnly={viewingAs?.readOnly ?? false}
    />
  );
}
