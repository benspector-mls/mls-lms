import { Suspense } from "react";

import { CohortManager } from "@/components/instructor/cohort-manager";
import { ExpectedStudents } from "@/components/instructor/expected-students";
import { JoinLinkCard, ProgramRoster } from "@/components/instructor/roster";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Who is in this matriculation, and the link that puts them there.
 *
 * **One roster where there used to be one per course.** A fellow joins a matriculation once and is
 * a student of every course in it, so this is entered once rather than once per course of a term —
 * which is the duplication the program above the course removed.
 *
 * **Three tabs, because the screen answers three questions asked at different times.** Reading the
 * roster is the work of an ordinary week. Dividing it into cohorts is done once at the start and
 * revised a few times after. Writing down who is expected and sending them the link is a single
 * afternoon in September. All three used to be one page or three addresses; tabs are what separates
 * them without making the second and third somewhere you have to go.
 *
 * **Cohorts are a tab rather than a screen of their own, and the roster is why.** Placing every
 * fellow is one control the size of the roster — a select per name — so it cannot sit *under* the
 * tables without making somebody scroll past the week's work to reach the term's. But it is a thing
 * done to the roster, and "who has nobody grading them" is asked while reading it, which is why the
 * roster carries a cohort column and the placement is one tab away rather than one address away.
 *
 * Team sets are not here at all — a set divides one course's fellows for one project, so it belongs
 * beside that course's curriculum.
 *
 * Reads `programs.roster` rather than the gradebook, which is the point of that procedure existing:
 * this screen needs every enrollment and no submissions at all, and it used to fetch a term's worth
 * of grading cells to display a list of names.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function RosterPage({ params }: { params: Promise<{ programId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="5xl" />}>
      <Roster params={params} />
    </Suspense>
  );
}

async function Roster({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const queryClient = getQueryClient();

  /*
    No cohort filter on this screen, deliberately, and it is one of two instructor screens without
    one. The roster is what cohorts divide; a roster narrowed to a cohort could not show the fellow
    who is in none, which is exactly who an instructor comes here to find.
  */
  const [data, cohorts, memberships, expected] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.roster.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.cohorts.listForProgram.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.cohorts.membershipsForProgram.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.enrollments.roster.queryOptions({ programId })),
  ]);

  const active = data.enrollments.filter((enrollment) => enrollment.status === "ACTIVE").length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Roster"
        /*
          Both figures, because the tabs below are about both. "24 fellows" alone says nothing about
          whether anybody has been placed, and a screen whose second tab is a placement should say so
          before somebody opens it.
        */
        description={[
          `${active} ${active === 1 ? "fellow" : "fellows"} in ${data.program.matriculation}`,
          cohorts.cohorts.length === 0
            ? "no cohorts yet"
            : `${cohorts.cohorts.length} ${cohorts.cohorts.length === 1 ? "cohort" : "cohorts"}`,
        ].join(" · ")}
      />
      {/*
        The roster first, and it is the tab an instructor lands on. Enrolling is what you do once at
        the start of a matriculation; reading the roster is what you do every week after that. The
        cohorts sit between them because that is where they fall on the same scale.

        Every query is fetched above regardless of which tab is open. They are one round trip on a
        screen whose whole content is four lists, and fetching a tab's data only when it is opened
        would put a spinner between a click and a table.
      */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active Roster</TabsTrigger>
          <TabsTrigger value="cohorts">Cohorts</TabsTrigger>
          <TabsTrigger value="enroll">Enroll New Fellows</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 flex flex-col gap-6">
          <ProgramRoster data={data} cohorts={cohorts.cohorts} />
        </TabsContent>

        {/*
          No cohort filter on this tab either, which is the point of it being here: a screen narrowed
          to one cohort could not show the fellow who is in none, who is exactly who somebody opens
          this to place.
        */}
        <TabsContent value="cohorts" className="mt-4 flex flex-col gap-6">
          <CohortManager programId={programId} data={cohorts} memberships={memberships} />
        </TabsContent>

        {/*
          The expected list above the join link, because it is the first step rather than an extra
          one: the link admits nobody who is not on this list, so an instructor who meets the link
          first has a program that silently refuses everybody they send it to.
        */}
        <TabsContent value="enroll" className="mt-4 flex flex-col gap-6">
          <ExpectedStudents programId={programId} entries={expected} />
          <JoinLinkCard programId={programId} joinToken={data.program.joinToken} active={active} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
