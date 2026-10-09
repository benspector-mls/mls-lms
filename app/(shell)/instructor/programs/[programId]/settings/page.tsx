import { Suspense } from "react";

import { ProgramSettings } from "@/components/instructor/program-settings";
import { PageFallback } from "@/components/list-states";
import { OutlinedPage, type OutlineSection } from "@/components/outlined-page";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The program itself: what it is, its courses, who instructs it, its lateness rule, and how
 * it is retired.
 *
 * **The other half of what used to be one course settings screen.** Attendance, the roster, the
 * cohorts and the two links belong to the program and are the same for every course in it, so they
 * are set here once rather than in each course. What stayed on the course is what genuinely differs
 * between two courses of one year.
 *
 * **Who instructs it is on this screen rather than one of its own**, because it is a fact about the
 * program in the same way its name and its lateness rule are. It had its own address while the
 * question was whether it was a screen; it is three cards, two of which are read far less often than
 * anything else here, and a sidebar item for them was a door onto a section.
 *
 * The course list is fetched alongside it so a new course can be copied from an earlier one. It is
 * every course the caller teaches across every program, which is the interesting half — the
 * ordinary copy is last year's course into this year's, and those are different programs by
 * definition.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function ProgramSettingsPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={5} width="3xl" />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const queryClient = getQueryClient();

  const [data, courses] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.settings.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.courses.listMine.queryOptions()),
  ]);

  /*
    The cards of `ProgramSettings` and of `ProgramInstructors` inside it, in their order and under
    their conditions: the teaching grid needs a course to put somebody on, and the delete card is
    for the owner of an archived program, as the component decides and the procedure enforces.
  */
  const archived = data.program.archivedAt !== null;
  const sections: OutlineSection[] = [
    { id: "program", label: "Program" },
    { id: "discipline", label: "Discipline" },
    { id: "test", label: data.program.isTest ? "Test program" : "Real program" },
    { id: "courses", label: "Courses" },
    { id: "instructors", label: "Instructors" },
    ...(data.program.courses.length > 0 ? [{ id: "teaching", label: "Who teaches what" }] : []),
    { id: "instructor-link", label: "Instructor link" },
    { id: "attendance", label: "Attendance" },
    { id: "archive", label: archived ? "Reopen" : "Archive" },
    ...(archived && data.callerActsAsOwner ? [{ id: "delete", label: "Delete" }] : []),
  ];

  return (
    <OutlinedPage
      width="4xl"
      header={
        <PageHeader title="Settings" description={`${data.program.name} · ${data.program.term}`} />
      }
      sections={sections}
    >
      <ProgramSettings data={data} courses={courses} />
    </OutlinedPage>
  );
}
