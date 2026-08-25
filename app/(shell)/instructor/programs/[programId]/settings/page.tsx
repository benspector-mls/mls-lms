import { Suspense } from "react";

import { ProgramSettings } from "@/components/instructor/program-settings";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The matriculation itself: what it is, its courses, its lateness rule, and how it is retired.
 *
 * **The other half of what used to be one course settings screen.** Attendance, the roster, the
 * cohorts and the two links belong to the program and are the same for every course in it, so they
 * are set here once rather than in each course. What stayed on the course is what genuinely differs
 * between two courses of one year.
 *
 * The course list is fetched alongside it so a new course can be copied from an earlier one. It is
 * every course the caller teaches across every matriculation, which is the interesting half — the
 * ordinary copy is last year's course into this year's, and those are different programs by
 * definition.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function ProgramSettingsPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={5} width="3xl" />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const queryClient = getQueryClient();

  const [data, courses] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.settings.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.courses.listMine.queryOptions()),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Settings"
        description={`${data.program.name} · ${data.program.matriculation}`}
      />
      <ProgramSettings data={data} courses={courses} />
    </div>
  );
}
