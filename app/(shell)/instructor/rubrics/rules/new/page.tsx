import { Suspense } from "react";

import { RuleSetForm } from "@/components/instructor/rubric-form";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

export default function NewRuleSetPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="New rule set"
        description="The voice every report under it is written in. Start from an existing one and change what you need."
      />
      <Suspense fallback={<PageFallback rows={6} width="4xl" />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  const ruleSets = await getQueryClient().fetchQuery(trpc.rubrics.listRuleSets.queryOptions());

  return (
    <RuleSetForm
      ruleSet={null}
      startFrom={ruleSets.map((ruleSet) => ({ id: ruleSet.id, name: ruleSet.name }))}
    />
  );
}
