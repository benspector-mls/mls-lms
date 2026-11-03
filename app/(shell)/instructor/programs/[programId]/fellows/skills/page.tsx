import { Suspense } from "react";

import { FellowsPage } from "@/components/instructor/fellows-page";
import { ProgramSkills } from "@/components/instructor/program-skills";
import { PageFallback } from "@/components/list-states";
import { cohortSelectionLabel, parseCohortSelection } from "@/lib/programs/cohorts";
import { resolveCohort } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * How every fellow on the roster is developing in each graded skill.
 *
 * **The Skills tab of the Fellows screen.** One column per group of the program's taxonomy,
 * each opening to a column per skill, and in each cell the fellow's points earned over points
 * possible on every approved section tagged with it, so far this term. Every column sorts.
 * Nothing is colored: a skill share is a grade, and the Performance tab already reads who needs
 * support. The figures come from `programs.skills`.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function FellowsSkillsPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="full" />}>
      <Skills params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Skills({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ cohort?: string }>;
}) {
  const { programId } = await params;
  const query = await searchParams;
  const cohorts = await resolveCohort(programId, query.cohort);

  const data = await getQueryClient().fetchQuery(
    trpc.programs.skills.queryOptions({ programId, cohort: cohorts.cohort }),
  );

  const selection = parseCohortSelection(cohorts.cohort);
  const cohortName = new Map(cohorts.cohorts.map((cohort) => [cohort.id, cohort.name]));
  const count = data.fellows.length;

  return (
    <FellowsPage
      programId={programId}
      cohorts={cohorts}
      cohortParam={query.cohort}
      active="skills"
      description={`${count} ${count === 1 ? "fellow" : "fellows"} in ${
        selection.kind === "all" ? "this program" : cohortSelectionLabel(selection, cohorts.cohorts)
      }`}
    >
      <ProgramSkills programId={programId} data={data} cohortName={cohortName} />
    </FellowsPage>
  );
}
