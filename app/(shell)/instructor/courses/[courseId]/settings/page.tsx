import { Suspense } from "react";

import { CourseSettings } from "@/components/instructor/course-settings";
import { PageFallback } from "@/components/list-states";
import { OutlinedPage, type OutlineSection } from "@/components/outlined-page";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The course itself, and where the bare course address lands.
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

  /*
    The cards of `CourseSettings`, in its order and under its conditions. The delete card is on the
    page only for an archived course and only for the program's owner, which is the condition the
    component applies and the procedure enforces; a link to a card that is not there would be a
    link to nothing.
  */
  const archived = data.course.archivedAt !== null;
  const sections: OutlineSection[] = [
    { id: "name", label: "Name" },
    { id: "visibility", label: "Visibility" },
    { id: "test", label: data.course.isTest ? "Test course" : "Real course" },
    { id: "short-name", label: "Short name" },
    { id: "instructors", label: "Instructors" },
    { id: "archive", label: archived ? "Reopen" : "Archive" },
    ...(archived && data.callerActsAsOwner ? [{ id: "delete", label: "Delete" }] : []),
  ];

  return (
    <OutlinedPage
      width="4xl"
      header={
        <PageHeader
          title="Settings"
          description={`${data.course.name} · ${data.course.program.term}`}
        />
      }
      sections={sections}
    >
      <CourseSettings data={data} />
    </OutlinedPage>
  );
}
