import { Suspense } from "react";

import { CohortManager } from "@/components/instructor/cohort-manager";
import { CohortPicker } from "@/components/instructor/cohort-picker";
import { ExpectedStudents } from "@/components/instructor/expected-students";
import { JoinLinkCard, ProgramRoster } from "@/components/instructor/roster";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  cohortSelectionLabel,
  inCohortSelection,
  parseCohortSelection,
} from "@/lib/programs/cohorts";
import { resolveCohort } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Who is in this program, and the link that puts them there.
 *
 * **One roster where there used to be one per course.** A fellow joins a program once and is
 * a student of every course in it, so this is entered once rather than once per course of a term —
 * which is the duplication the program above the course removed.
 *
 * **This screen manages the roster, and how the fellows on it are doing is a screen of its own**,
 * Performance, beside this one in the sidebar. The two are read for different reasons at different
 * times, and an instructor rarely wants both in one sitting.
 *
 * **Three tabs, because the screen answers three questions asked at different times.** Reading the
 * roster is the work of an ordinary week. Dividing it into cohorts is done once at the start and
 * revised a few times after. Writing down who is expected and sending them the link is a single
 * afternoon in September. Tabs are what separates them without making any of them somewhere you
 * have to go.
 *
 * **The cohort picker narrows the Active Roster tab**, so an instructor who works with fifteen
 * fellows can read their fifteen here as they do in the gradebook. Its No cohort entry is how the
 * fellow nobody has placed is found. It does not narrow the Cohorts tab, where placement is done to
 * the whole roster, or the join link, which is the program's.
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
 * the roster tab needs every enrollment and no submissions at all.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="5xl" />}>
      <Roster params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Roster({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  const { programId } = await params;
  const query = await searchParams;
  const cohorts = await resolveCohort(programId, query.cohort);
  const queryClient = getQueryClient();

  const [data, memberships, expected] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.roster.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.cohorts.membershipsForProgram.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.enrollments.roster.queryOptions({ programId })),
  ]);

  const selection = parseCohortSelection(cohorts.cohort);

  /*
    Real fellows only, in both counts. A test student is listed in its own table and is nobody's
    fellow, so counting it would put a number in the header that no table on the screen adds up to.
    The join link's confirmation counts the whole program, because the link is the program's.
  */
  const real = data.enrollments.filter(
    (enrollment) => enrollment.status === "ACTIVE" && enrollment.student.testStudentNumber === null,
  );
  const inSelection = real.filter((enrollment) =>
    inCohortSelection(selection, enrollment.cohortId),
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Roster"
        /*
          Both figures, because the tabs below are about both. "24 fellows" alone says nothing about
          whether anybody has been placed, and a screen whose third tab is a placement should say so
          before somebody opens it. Filtered, the count names what it is a count of, because "15
          fellows" under a picker set to one cohort is otherwise a claim about the program.
        */
        description={[
          selection.kind === "all"
            ? `${inSelection} ${inSelection === 1 ? "fellow" : "fellows"} in ${data.program.term}`
            : `${inSelection} ${inSelection === 1 ? "fellow" : "fellows"} in ${cohortSelectionLabel(selection, cohorts.cohorts)}`,
          cohorts.cohorts.length === 0
            ? "no cohorts yet"
            : `${cohorts.cohorts.length} ${cohorts.cohorts.length === 1 ? "cohort" : "cohorts"}`,
        ].join(" · ")}
        actions={<CohortPicker choice={cohorts} />}
      />
      {/*
        The roster first, and it is the tab an instructor lands on. Enrolling is what you do once at
        the start of a program, and the cohorts sit between because that is where they fall on the
        same scale.

        Every query is fetched above regardless of which tab is open. They are one round trip, and
        fetching a tab's data only when it is opened would put a spinner between a click and a table.
      */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active Roster</TabsTrigger>
          <TabsTrigger value="cohorts">Cohorts</TabsTrigger>
          <TabsTrigger value="enroll">Enroll New Fellows</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 flex flex-col gap-6">
          <ProgramRoster data={data} cohorts={cohorts.cohorts} cohort={cohorts.cohort} />
        </TabsContent>

        {/*
          Not narrowed by the picker, which is the point of it being here: a screen narrowed to one
          cohort could not show the fellow who is in none, who is exactly who somebody opens this to
          place.
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
          <JoinLinkCard
            programId={programId}
            joinToken={data.program.joinToken}
            active={real.length}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
