import { Suspense } from "react";

import { TeamSetManager } from "@/components/instructor/team-set-manager";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The team sets of one course: the divisions of the matriculation's fellows that hand work in
 * together.
 *
 * **Its own screen rather than a card on the roster it used to share.** The roster moved up to the
 * program and a team set did not: a set divides one matriculation's fellows for one *course's*
 * projects, and it is that course's assignments that point at it. So it belongs beside that
 * course's curriculum, and a screen that held both would have put a decision about one course under
 * a list of people who are in four.
 *
 * **No cohort filter, deliberately.** A team set is a partition of the whole roster and every
 * fellow's select has to be reachable; narrowing to one cohort would hide the fellows an instructor
 * still has to place, and a set with somebody left off it silently gives that fellow no work to
 * accept.
 *
 * The roster is fetched from the cohorts router rather than the course, because it is already the
 * list of active enrollments with their fellows and there is no second version of that list to
 * disagree with.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function TeamsPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={6} width="5xl" />}>
      <Teams params={params} />
    </Suspense>
  );
}

async function Teams({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  // The course first, because the roster belongs to its matriculation and this address names only
  // the course. The heading reads it too, so it is one read serving both.
  const course = await queryClient.fetchQuery(trpc.courses.get.queryOptions({ courseId }));

  const [teamSets, roster] = await Promise.all([
    queryClient.fetchQuery(trpc.teamSets.listForCourse.queryOptions({ courseId })),
    queryClient.fetchQuery(
      trpc.cohorts.membershipsForProgram.queryOptions({ programId: course.program.id }),
    ),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Teams"
        description={
          teamSets.sets.length === 0
            ? `${course.name} · every assignment is handed in by one fellow`
            : `${course.name} · ${teamSets.sets.length} ` +
              `${teamSets.sets.length === 1 ? "team set" : "team sets"}`
        }
      />
      <TeamSetManager courseId={courseId} data={teamSets} roster={roster} />
    </div>
  );
}
