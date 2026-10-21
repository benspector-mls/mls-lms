import { Suspense } from "react";

import { ProgramSettings } from "@/components/instructor/program-settings";
import { PageFallback } from "@/components/list-states";
import { OutlinedPage, type OutlineSection } from "@/components/outlined-page";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The program itself: what it is, its courses, who instructs it, who is enrolled and how they are
 * divided into cohorts, and how it is retired.
 *
 * **The other half of what used to be one course settings screen.** Attendance, the roster, the
 * cohorts and the two links belong to the program and are the same for every course in it, so they
 * are set here once rather than in each course. What stayed on the course is what genuinely differs
 * between two courses of one year.
 *
 * **Who instructs it is on this screen rather than one of its own**, because it is a fact about the
 * program in the same way its name and its lateness rule are. It had its own address while the
 * question was whether it was a screen; it is two cards, read far less often than
 * anything else here, and a sidebar item for them was a door onto a section.
 *
 * **Enrolling fellows and placing them in cohorts are here for the same reason.** Writing down who
 * is expected and sending them the link is a single afternoon in September, and dividing the
 * roster among instructors is done once at the start and revised a few times after. Both are set
 * up once a year, like everything else on this screen, and the Fellows screen is left to the
 * reading of fellows that happens every week.
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

  /*
    The cohort manager wants the whole program's cohorts with their counts and nothing narrowed,
    so the list is read directly rather than through `resolveCohort`: there is no picker here, and
    a screen narrowed to one cohort could not show the fellow who is in none, who is exactly who
    somebody opens the Cohorts card to place. The roster is read for the join link's confirmation,
    which names how many fellows are already enrolled.
  */
  const [data, courses, cohorts, memberships, expected, roster] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.settings.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.courses.listMine.queryOptions()),
    queryClient.fetchQuery(trpc.cohorts.listForProgram.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.cohorts.membershipsForProgram.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.enrollments.roster.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.programs.roster.queryOptions({ programId })),
  ]);

  /*
    Real fellows only, as the Fellows screen counts them: a test student is nobody's fellow, and the
    join link's confirmation should name a number the roster adds up to.
  */
  const activeFellows = roster.enrollments.filter(
    (enrollment) => enrollment.status === "ACTIVE" && enrollment.student.testStudentNumber === null,
  ).length;

  /*
    The cards of `ProgramSettings` and of `ProgramInstructors` inside it, in their order and under
    their conditions: the teaching grid needs a course to put somebody on, and the delete card is
    for the owner of an archived program, as the component decides and the procedure enforces. The
    discipline, the test flag and the instructor link are inside the Program and Instructors cards
    rather than cards of their own, so they have no entry here.
  */
  const archived = data.program.archivedAt !== null;
  const sections: OutlineSection[] = [
    { id: "program", label: "Program" },
    { id: "courses", label: "Courses" },
    { id: "instructors", label: "Instructors" },
    ...(data.program.courses.length > 0 ? [{ id: "teaching", label: "Who teaches what" }] : []),
    { id: "enrollment", label: "Enrollment" },
    { id: "cohorts", label: "Cohorts" },
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
      <ProgramSettings
        data={data}
        courses={courses}
        cohorts={cohorts}
        memberships={memberships}
        expected={expected}
        activeFellows={activeFellows}
      />
    </OutlinedPage>
  );
}
