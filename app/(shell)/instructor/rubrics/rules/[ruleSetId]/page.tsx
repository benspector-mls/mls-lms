import { Suspense } from "react";

import { RuleSetForm } from "@/components/instructor/rubric-form";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/** One rule set's current text, editable by its author or an admin and readable by everyone else. */
export default function RuleSetPage({ params }: { params: Promise<{ ruleSetId: string }> }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
        <RuleSet params={params} />
      </Suspense>
    </div>
  );
}

async function RuleSet({ params }: { params: Promise<{ ruleSetId: string }> }) {
  const { ruleSetId } = await params;
  const ruleSet = await getQueryClient().fetchQuery(
    trpc.rubrics.getRuleSet.queryOptions({ ruleSetId }),
  );

  return (
    <>
      <PageHeader
        title={ruleSet.name}
        eyebrow="Rule set"
        description={
          ruleSet.version === null
            ? "No version has been written yet."
            : `Version ${ruleSet.version}${ruleSet.author ? `, by ${ruleSet.author}` : ""}.`
        }
      />
      <RuleSetForm key={ruleSet.id} ruleSet={ruleSet} startFrom={[]} />
    </>
  );
}
