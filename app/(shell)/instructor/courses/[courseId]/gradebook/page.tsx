import { Suspense } from "react";

import { Gradebook, parseGradebookTab } from "@/components/instructor/gradebook";
import { GradebookDownload } from "@/components/instructor/gradebook-download";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { CohortPicker } from "@/components/instructor/cohort-picker";
import { cohortSelectionLabel, parseCohortSelection } from "@/lib/programs/cohorts";
import { gradebookCsv, gradebookIsEmpty } from "@/lib/gradebook/csv";
import { resolveCohortForCourse } from "@/lib/programs/resolve-cohort";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Every fellow against every assignment.
 *
 * The back link to the course page is gone with the tab bar that made it necessary. The
 * gradebook is its own sidebar item now, so the way to anywhere else in the course is the
 * sidebar rather than a link back to a page that no longer lists anything.
 */
export default function GradebookPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ cohort?: string; tab?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={10} />}>
      <FullGradebook params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function FullGradebook({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ cohort?: string; tab?: string }>;
}) {
  const { courseId } = await params;
  const query = await searchParams;
  const cohorts = await resolveCohortForCourse(courseId, query.cohort);
  // Anything unrecognised becomes the overview, so a stale link lands on the tab that
  // describes all three of the others rather than on an error.
  const tab = parseGradebookTab(query.tab);
  const queryClient = getQueryClient();

  /*
    The GCF is a second read, and only for the two tabs that show it.

    Its rows live in their own tables — a GCF result is not coursework and carries no course — so
    it cannot ride along on the gradebook query. Fetching it unconditionally would pull a term of
    CodeSignal results every time somebody opened the Assignments tab, which never draws them.
  */
  const wantsGcf = tab === "overview" || tab === "GCF";

  const [data, gcf] = await Promise.all([
    queryClient.fetchQuery(
      trpc.courses.gradebook.queryOptions({ courseId, cohort: cohorts.cohort }),
    ),
    wantsGcf
      ? queryClient.fetchQuery(
          trpc.gcf.forCourse.queryOptions({ courseId, cohort: cohorts.cohort }),
        )
      : null,
  ]);

  const selection = parseCohortSelection(cohorts.cohort);

  /*
    Named once and read by both the description and the downloaded file's name, so a file taken
    from a filtered screen carries the same words the heading above it used. Null when unfiltered:
    the whole roster needs no qualifier in either place.
  */
  const cohortLabel =
    selection.kind === "all" ? null : cohortSelectionLabel(selection, cohorts.cohorts);

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Gradebook"
        /*
          "Every fellow" stops being true the moment a cohort is chosen, and a grid of eight rows
          is a different claim depending on whether the roster has eight fellows. So the
          description says which set it is rather than describing the unfiltered case always.
        */
        description={
          cohortLabel === null
            ? `${data.course.program.term} · every fellow against every assignment`
            : `${data.course.program.term} · ${cohortLabel} against every assignment`
        }
        actions={
          <>
            <CohortPicker choice={cohorts} />
            {/*
              Built here rather than in the browser, and offered only when there is a grid. The
              string is assembled from the payload this render already holds, which is what makes
              the file and the table below it the same claim — and what keeps a term of grading
              cells out of the page for the readers who never press it.
            */}
            {!gradebookIsEmpty(data) && (
              <GradebookDownload
                csv={gradebookCsv(data)}
                term={data.course.program.term}
                cohortLabel={cohortLabel}
              />
            )}
          </>
        }
      />

      <Gradebook data={data} gcf={gcf} tab={tab} cohort={cohorts.cohort} />
    </div>
  );
}
