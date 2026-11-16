import { Suspense } from "react";

import { RubricList } from "@/components/instructor/rubric-list";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Every rubric and rule set, for any instructor.
 *
 * Not gated here: both reads are `instructorProcedure`, so a student who types the URL is refused
 * by the procedures rather than by a page that declined to render. `cacheComponents` is enabled,
 * so the reads happen in an async child behind Suspense.
 */
export default function RubricsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Rubrics"
        description="What the model grades against, and the voice it writes in. Written here, in markdown, and saved as versions so a report always names the exact text that produced it."
      />
      <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
        <Lists />
      </Suspense>
    </div>
  );
}

async function Lists() {
  const client = getQueryClient();
  const [rubrics, ruleSets] = await Promise.all([
    client.fetchQuery(trpc.rubrics.list.queryOptions()),
    client.fetchQuery(trpc.rubrics.listRuleSets.queryOptions()),
  ]);

  return <RubricList rubrics={rubrics} ruleSets={ruleSets} />;
}
