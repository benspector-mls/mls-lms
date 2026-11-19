import { Suspense } from "react";

import { LessonView } from "@/components/lesson/lesson-view";
import { PageFallback } from "@/components/list-states";

/**
 * The course's first lesson, the results of a search with `?q=`, or a page saying the course has
 * no lessons; see `LessonView`.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function LessonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={10} width="3xl" />}>
      <LessonView params={params} searchParams={searchParams} side="fellow" />
    </Suspense>
  );
}
