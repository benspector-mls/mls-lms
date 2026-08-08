import { Suspense } from "react";

import { CourseSettings } from "@/components/instructor/course-settings";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The cohort itself, and where the bare course address lands.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function CourseSettingsPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={5} width="3xl" />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const data = await getQueryClient().fetchQuery(trpc.courses.settings.queryOptions({ courseId }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Settings"
        description={`${data.course.name} · ${data.course.cohortTerm}`}
      />
      <CourseSettings data={data} />
    </div>
  );
}
