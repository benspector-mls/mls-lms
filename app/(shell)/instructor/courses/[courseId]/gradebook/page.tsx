import { Suspense } from "react";

import { Gradebook } from "@/components/instructor/gradebook";
import { GradebookDownload } from "@/components/instructor/gradebook-download";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { GroupPicker } from "@/components/instructor/group-picker";
import { groupSelectionLabel, parseGroupSelection } from "@/lib/courses/groups";
import { gradebookCsv, gradebookIsEmpty } from "@/lib/gradebook/csv";
import { resolveGroup } from "@/lib/courses/resolve-group";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Every student against every assignment.
 *
 * The back link to the course page is gone with the tab bar that made it necessary. The
 * gradebook is its own sidebar item now, so the way to anywhere else in the cohort is the
 * sidebar rather than a link back to a page that no longer lists anything.
 */
export default function GradebookPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ group?: string }>;
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
  searchParams: Promise<{ group?: string }>;
}) {
  const { courseId } = await params;
  const groups = await resolveGroup(courseId, (await searchParams).group);
  const data = await getQueryClient().fetchQuery(
    trpc.courses.gradebook.queryOptions({ courseId, group: groups.group }),
  );

  const selection = parseGroupSelection(groups.group);

  /*
    Named once and read by both the description and the downloaded file's name, so a file taken
    from a filtered screen carries the same words the heading above it used. Null when unfiltered:
    the whole cohort needs no qualifier in either place.
  */
  const groupLabel =
    selection.kind === "all" ? null : groupSelectionLabel(selection, groups.groups);

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Gradebook"
        /*
          "Every student" stops being true the moment a group is chosen, and a grid of eight rows
          is a different claim depending on whether the cohort has eight students. So the
          description says which set it is rather than describing the unfiltered case always.
        */
        description={
          groupLabel === null
            ? `${data.course.cohortTerm} · every student against every assignment`
            : `${data.course.cohortTerm} · ${groupLabel} against every assignment`
        }
        actions={
          <>
            <GroupPicker
              courseId={courseId}
              value={groups.group}
              groups={groups.groups}
              ungroupedCount={groups.ungroupedCount}
            />
            {/*
              Built here rather than in the browser, and offered only when there is a grid. The
              string is assembled from the payload this render already holds, which is what makes
              the file and the table below it the same claim — and what keeps a term of grading
              cells out of the page for the readers who never press it.
            */}
            {!gradebookIsEmpty(data) && (
              <GradebookDownload
                csv={gradebookCsv(data)}
                cohortTerm={data.course.cohortTerm}
                groupLabel={groupLabel}
              />
            )}
          </>
        }
      />

      <Gradebook data={data} />
    </div>
  );
}
