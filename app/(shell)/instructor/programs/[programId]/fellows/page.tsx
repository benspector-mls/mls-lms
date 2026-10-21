import { Suspense } from "react";

import { FellowsPage } from "@/components/instructor/fellows-page";
import { ProgramRoster } from "@/components/instructor/roster";
import { PageFallback } from "@/components/list-states";
import {
  cohortSelectionLabel,
  inCohortSelection,
  parseCohortSelection,
} from "@/lib/programs/cohorts";
import { resolveCohort } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The roster: who is in this program, in alphabetical order.
 *
 * **The first tab of the Fellows screen, and the one its bare address lands on.** An instructor
 * looking for one fellow finds them here by name and opens their record, or views the program as
 * them; that is the ordinary week's use of this screen, and it is where a program's name leads from
 * everywhere else. How the same fellows are doing is the Performance and Coaching tabs beside it.
 *
 * **Enrolling and placing fellows are on Settings.** Both are done in the first week of a term and
 * revised a few times after, so they sit with the other things set up once a year rather than
 * beside a list read every day.
 *
 * **The cohort picker narrows the table**, so an instructor who works with fifteen fellows can read
 * their fifteen here as they do in the gradebook. Its No cohort entry is how the fellow nobody has
 * placed is found; the roster carries a cohort column for the same reason.
 *
 * Team sets are not here at all — a set divides one course's fellows for one project, so it belongs
 * beside that course's curriculum.
 *
 * Reads `programs.roster` rather than the gradebook, which is the point of that procedure existing:
 * the roster needs every enrollment and no submissions at all.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function FellowsRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="full" />}>
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

  const data = await queryClient.fetchQuery(trpc.programs.roster.queryOptions({ programId }));

  const selection = parseCohortSelection(cohorts.cohort);

  /*
    Real fellows only. A test student is listed in its own table and is nobody's fellow, so
    counting it would put a number in the header that no table on the screen adds up to. Filtered,
    the count names what it is a count of, because "15 fellows" under a picker set to one cohort
    is otherwise a claim about the program.
  */
  const real = data.enrollments.filter(
    (enrollment) => enrollment.status === "ACTIVE" && enrollment.student.testStudentNumber === null,
  );
  const inSelection = real.filter((enrollment) =>
    inCohortSelection(selection, enrollment.cohortId),
  ).length;

  return (
    <FellowsPage
      programId={programId}
      cohorts={cohorts}
      cohortParam={query.cohort}
      active="roster"
      description={
        selection.kind === "all"
          ? `${inSelection} ${inSelection === 1 ? "fellow" : "fellows"} in ${data.program.term}`
          : `${inSelection} ${inSelection === 1 ? "fellow" : "fellows"} in ${cohortSelectionLabel(selection, cohorts.cohorts)}`
      }
    >
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <ProgramRoster data={data} cohorts={cohorts.cohorts} cohort={cohorts.cohort} />
      </div>
    </FellowsPage>
  );
}
