import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { TutorPage } from "@/components/tutor/tutor-page";

/**
 * The course's Tutor, from the instructor's side; see `TutorPage`. A static segment, so it is
 * matched before the lessons' `[...slug]`.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function InstructorTutorPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="3xl" />}>
      <TutorPage params={params} side="instructor" />
    </Suspense>
  );
}
