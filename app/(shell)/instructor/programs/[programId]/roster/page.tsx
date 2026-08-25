import { Suspense } from "react";

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
 * **Two tabs, because the screen answers two questions that are asked months apart.** Running a
 * matriculation means reading the roster; starting one means writing down who is expected and
 * sending them the link. Both were on one page, so the work of an ordinary week sat below the work
 * of a single afternoon in September.
 *
 * **The cohorts are named here and placed elsewhere.** A column says which cohort each fellow is
 * in, because "who has nobody grading them" is a question asked while reading the roster; assigning
 * them is a placement for every fellow at once and has its own screen. Team sets are not here at
 * all any more — a set divides one course's fellows for one project, so it belongs beside that
 * course's curriculum.
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
  const [data, cohorts, expected] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.roster.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.cohorts.listForProgram.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.enrollments.roster.queryOptions({ programId })),
  ]);

  const active = data.enrollments.filter((enrollment) => enrollment.status === "ACTIVE").length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Roster"
        description={`${active} ${active === 1 ? "fellow" : "fellows"} in ${data.program.matriculation}`}
      />
      {/*
        The roster first, and it is the tab an instructor lands on. Enrolling is what you do once
        at the start of a matriculation; reading the roster is what you do every week after that.

        All three queries are fetched above regardless of which tab is open. They are one round
        trip on a screen whose whole content is three lists, and fetching the second tab's data
        only when it is opened would put a spinner between a click and a table.
      */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active Roster</TabsTrigger>
          <TabsTrigger value="enroll">Enroll New Fellows</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 flex flex-col gap-6">
          <ProgramRoster data={data} cohorts={cohorts.cohorts} />
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
