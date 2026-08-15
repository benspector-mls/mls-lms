import { Suspense } from "react";

import { ExpectedStudents } from "@/components/instructor/expected-students";
import { GroupManager } from "@/components/instructor/group-manager";
import { CourseRoster, JoinLinkCard } from "@/components/instructor/roster";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Who is in this cohort, and the link that puts them there.
 *
 * **Two tabs, because the screen answers two questions that are asked months apart.** Running a
 * cohort means reading the roster and arranging groups; starting one means writing down who is
 * expected and sending them the link. Both were on one page, so the work of an ordinary week sat
 * below the work of a single afternoon in September.
 *
 * Reads `courses.roster` rather than the gradebook, which is the point of that procedure
 * existing: this screen needs every enrollment and no submissions at all, and it used to fetch
 * a term's worth of grading cells to display a list of names.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function RosterPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="5xl" />}>
      <Roster params={params} />
    </Suspense>
  );
}

async function Roster({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  /*
    No group filter on this screen, deliberately, and it is the only instructor screen without
    one. The roster is where groups are *made*; a roster narrowed to a group could not show the
    student who is in none, which is exactly who an instructor comes here to place.
  */
  const [data, groups, memberships, expected] = await Promise.all([
    queryClient.fetchQuery(trpc.courses.roster.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.groups.listForCourse.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.groups.membershipsForCourse.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.enrollments.roster.queryOptions({ courseId })),
  ]);

  const active = data.enrollments.filter((enrollment) => enrollment.status === "ACTIVE").length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Roster"
        description={`${active} ${active === 1 ? "student" : "students"} in this cohort`}
      />
      {/*
        The roster first, and it is the tab an instructor lands on. Enrolling is what you do once
        at the start of a term; reading the roster is what you do every week after that.

        All four queries are fetched above regardless of which tab is open. They are one round
        trip on a screen whose whole content is four lists, and fetching the second tab's data
        only when it is opened would put a spinner between a click and a table.
      */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active Roster</TabsTrigger>
          <TabsTrigger value="enroll">Enroll New Students</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 flex flex-col gap-6">
          <CourseRoster data={data} />
          <GroupManager courseId={courseId} data={groups} memberships={memberships} />
        </TabsContent>

        {/*
          The expected list above the join link, because it is the first step rather than an extra
          one: the link admits nobody who is not on this list, so an instructor who meets the link
          first has a cohort that silently refuses everybody they send it to.
        */}
        <TabsContent value="enroll" className="mt-4 flex flex-col gap-6">
          <ExpectedStudents courseId={courseId} entries={expected} />
          <JoinLinkCard courseId={courseId} joinToken={data.course.joinToken} active={active} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
