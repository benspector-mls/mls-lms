import { redirect } from "next/navigation";
import { Suspense } from "react";

import { triageHref } from "@/lib/links";

/**
 * The bare course address, which is a redirect rather than a screen.
 *
 * Every view a course has — triage, the gradebook, the curriculum, its team sets, the settings — is
 * its own sidebar item and its own route, which left this one with nothing to render: its heading,
 * its cohort line, its outstanding count, and its tab bar all moved or went. Triage is where it
 * lands, because a reader who names a cohort and nothing more is asking what is waiting on them in
 * it — which is the question this application is opened to ask, and the reason triage leads the
 * course's five views everywhere else.
 *
 * Kept as a route rather than deleted so that every link that names a course goes on working —
 * the breadcrumb, `sameViewInCourse` for the views that cannot travel between cohorts, and any
 * address an instructor has bookmarked.
 *
 * `cacheComponents` is enabled, so `params` is awaited inside a Suspense boundary rather than
 * in the page component.
 */
export default function InstructorCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <ToTriage params={params} />
    </Suspense>
  );
}

// `Promise<never>` rather than an inferred `Promise<void>`: `redirect` throws rather than
// returning, and without the annotation TypeScript decides this component resolves to `void`,
// which is not a `ReactNode` and fails the JSX check.
async function ToTriage({ params }: { params: Promise<{ courseId: string }> }): Promise<never> {
  const { courseId } = await params;
  redirect(triageHref(courseId));
}
