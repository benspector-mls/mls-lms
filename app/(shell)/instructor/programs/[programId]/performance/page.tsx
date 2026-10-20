import { Suspense } from "react";

import { CoachingOverview } from "@/components/instructor/coaching-overview";
import { CohortPicker } from "@/components/instructor/cohort-picker";
import { CourseFilter } from "@/components/instructor/course-filter";
import { ProgramPerformance } from "@/components/instructor/performance";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cohortSelectionLabel, parseCohortSelection } from "@/lib/programs/cohorts";
import { resolveCohort } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * How every fellow on the program's roster is doing, and who needs support this week.
 *
 * **Its own screen rather than a tab of the roster.** The roster is where membership is managed —
 * who is enrolled, which cohort they are in, the join link — and that is done at the start of a
 * term and when somebody arrives or leaves. This is read weekly to decide who to talk to, and an
 * instructor doing that has no reason to be on the roster's tabs in the same sitting.
 *
 * **It carries the cohort picker**, so an instructor who works with fifteen fellows reads their
 * fifteen, and No cohort shows the fellows nobody has placed. **And a course filter**, which narrows
 * the course bands drawn without changing anybody's group; see `CourseFilter`.
 *
 * The rule is `performanceBucket` in lib/programs/performance.ts, and the figures come from
 * `programs.performance`.
 *
 * **A second tab, Coaching**, reads the same fellows from the other side: the temperature and
 * check-in answers from each one's most recent completed session, and the goals they are working on
 * in each competency group. The cohort picker stays in the header and narrows both tabs. The course
 * filter sits inside the Performance tab, because coaching is about the program rather than any
 * course. Both payloads are fetched here regardless of which tab is open, as on the Attendance
 * screen, so that switching tabs never puts a spinner between a click and a table.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="full" />}>
      <Performance params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Performance({
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

  const [data, coaching] = await Promise.all([
    queryClient.fetchQuery(
      trpc.programs.performance.queryOptions({ programId, cohort: cohorts.cohort }),
    ),
    queryClient.fetchQuery(
      trpc.coaching.overview.queryOptions({ programId, cohort: cohorts.cohort }),
    ),
  ]);

  const selection = parseCohortSelection(cohorts.cohort);
  const cohortName = new Map(cohorts.cohorts.map((cohort) => [cohort.id, cohort.name]));
  const count = data.fellows.length;

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Performance"
        /*
          Names the set when a cohort is chosen, because "15 fellows" under a picker set to one
          cohort is otherwise a claim about the program.
        */
        description={`${count} ${count === 1 ? "fellow" : "fellows"} in ${
          selection.kind === "all"
            ? "this program"
            : cohortSelectionLabel(selection, cohorts.cohorts)
        }`}
        actions={<CohortPicker choice={cohorts} />}
      />

      <Tabs defaultValue="performance">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="coaching">Coaching</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Attendance, and work across every course.
            </p>
            <CourseFilter courses={data.courses} programArchived={data.programArchived} />
          </div>
          <ProgramPerformance programId={programId} data={data} cohortName={cohortName} />
        </TabsContent>

        <TabsContent value="coaching" className="mt-4">
          <CoachingOverview programId={programId} data={coaching} cohortName={cohortName} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
