import { Suspense } from "react";

import { ProgramInstructors } from "@/components/instructor/program-instructors";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Who instructs this matriculation, who teaches which of its courses, and who owns it.
 *
 * **Its own screen because the grant is the matriculation's.** An instructor of a program may act in
 * any of its courses, so there is one link to send and one list to keep — where before there was a
 * link and a list inside every course of the term, all saying the same thing. What is left per course
 * is whose name is on it, which is the grid in the middle of this screen.
 *
 * Reads `programs.settings`, the same payload the settings screen reads. One procedure rather than
 * two, because both screens are views of the same matriculation and a second read would be a second
 * place for "who owns this" to be derived.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function ProgramInstructorsPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={5} width="3xl" />}>
      <Instructors params={params} />
    </Suspense>
  );
}

async function Instructors({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const data = await getQueryClient().fetchQuery(
    trpc.programs.settings.queryOptions({ programId }),
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Instructors"
        description={`${data.program.name} · ${data.program.matriculation}`}
      />
      <ProgramInstructors data={data} />
    </div>
  );
}
