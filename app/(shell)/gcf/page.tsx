import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { GcfHistory } from "@/components/student/gcf-history";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * A fellow's own General Coding Framework results.
 *
 * **Outside every course, which is the one student screen that is.** The GCF is sat at CodeSignal
 * on a fellow's own schedule; a result carries no cohort, and somebody who repeats a term should
 * find one history rather than two halves of it. Scoping this to a course would mean deciding
 * which of their enrollments a sitting belonged to, and there is no honest answer.
 *
 * **Their own and nobody else's.** `gcf.mine` takes no student id, so there is no argument that
 * could name somebody else — the access control is the shape of the procedure rather than a check
 * inside it. An instructor reading a cohort's results uses the gradebook's own tab, which gates on
 * the course and narrows to its enrollments.
 */
export default function MyGcfPage() {
  return (
    <Suspense fallback={<PageFallback rows={5} width="4xl" />}>
      <MyGcf />
    </Suspense>
  );
}

async function MyGcf() {
  const attempts = await getQueryClient().fetchQuery(trpc.gcf.mine.queryOptions());

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Your GCF"
        description="The General Coding Framework, sat at CodeSignal. Proctored sittings and the mocks you practised against."
      />

      <GcfHistory attempts={attempts} />
    </div>
  );
}
