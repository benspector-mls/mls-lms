import { Suspense } from "react";

import { ProgramStudent } from "@/components/instructor/program-student";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { displayNameOf } from "@/lib/people";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * One fellow, across the whole matriculation.
 *
 * **The first of two student pages, and they answer different questions.** This one is about the
 * person: their attendance and arrival averages, their cohort, their GCF history, and a row per
 * course of the matriculation. The other, under `/instructor/courses/[courseId]/students/`, is about
 * their work in one course and is where grading happens. Splitting them is what lets grading stay
 * per course while the roster lives above every course.
 *
 * It is what the program roster's rows point at, and every course row here links into the other one.
 *
 * **It matches no sidebar item, deliberately.** A fellow's record belongs to the roster, to
 * attendance, and to the gradebook equally, so lighting one of them up would be picking arbitrarily —
 * `isActiveProgramView` leaves it dark for the same reason the per-course version is left dark.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function ProgramStudentPage({
  params,
}: {
  params: Promise<{ programId: string; studentId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
      <Student params={params} />
    </Suspense>
  );
}

async function Student({
  params,
}: {
  params: Promise<{ programId: string; studentId: string }>;
}) {
  const { programId, studentId } = await params;
  const data = await getQueryClient().fetchQuery(
    trpc.programs.student.queryOptions({ programId, studentId }),
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={displayNameOf(data.student, "Fellow")}
        description={`${data.program.name} · ${data.program.matriculation}`}
      />
      <ProgramStudent data={data} />
    </div>
  );
}
