import { Suspense } from "react";

import { LessonView } from "@/components/lesson/lesson-view";
import { PageFallback } from "@/components/list-states";

/**
 * One lesson of the course, addressed by its path in the curriculum repository without `.md`.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function LessonPage({
  params,
}: {
  params: Promise<{ courseId: string; slug: string[] }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={10} width="3xl" />}>
      <LessonView params={params} side="instructor" />
    </Suspense>
  );
}
