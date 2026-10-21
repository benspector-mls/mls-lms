import { Suspense } from "react";

import {
  SECTIONS,
  StudentIdentity,
  StudentPerformance,
} from "@/components/instructor/program-student";
import { RecordTabs } from "@/components/instructor/record-tabs";
import { PageFallback } from "@/components/list-states";
import { schoolDayOf } from "@/lib/school-time";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * One fellow, across the whole program: the Performance tab of their record.
 *
 * **The first of two student pages, and they answer different questions.** This one is about the
 * person: their attendance and arrival averages, their cohort, their GCF history, and a row per
 * course of the program. The other, under `/instructor/courses/[courseId]/students/`, is about
 * their work in one course and is where grading happens. Splitting them is what lets grading stay
 * per course while the roster lives above every course.
 *
 * It is what the Fellows screen's roster rows point at, and every course row here links into the
 * other one.
 *
 * **The bare record address is this tab.** Coaching and Trends are one segment beneath it, each a
 * page that fetches what its tab needs and shares this page's header. The three are read in one
 * sitting, often switching between them, so each has an address the back button can return to.
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

async function Student({ params }: { params: Promise<{ programId: string; studentId: string }> }) {
  const { programId, studentId } = await params;
  const queryClient = getQueryClient();
  const [data, fellows] = await Promise.all([
    queryClient.fetchQuery(trpc.programs.student.queryOptions({ programId, studentId })),
    /*
      The roster, for the record's own switcher. Fetched here rather than by the picker so the
      names are in the first paint — one more query on a screen that already makes one, against a
      list of about twenty-five.
    */
    queryClient.fetchQuery(trpc.enrollments.listForProgram.queryOptions({ programId })),
  ]);

  /*
    The clock is read once, here, and handed down, so the server and the browser agree about which
    square on the attendance calendar is today. Reading it inside the component would put a
    different answer in each render, which React reports as a hydration mismatch.
  */
  return (
    <RecordTabs
      programId={programId}
      studentId={studentId}
      header={<StudentIdentity data={data} fellows={fellows} />}
      active="performance"
      sections={SECTIONS.performance}
    >
      <StudentPerformance data={data} today={schoolDayOf(new Date())} />
    </RecordTabs>
  );
}
