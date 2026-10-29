import { Suspense } from "react";

import { CoachingFormBuilder } from "@/components/admin/coaching-form-builder";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * One coaching form, open in the builder. Admins only, by the same rule as the list: the read is
 * `coachingTemplates.get`, an `adminProcedure`.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function CoachingFormPage({ params }: { params: Promise<{ templateId: string }> }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
        <Form params={params} />
      </Suspense>
    </div>
  );
}

async function Form({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const template = await getQueryClient().fetchQuery(
    trpc.coachingTemplates.get.queryOptions({ id: templateId }),
  );

  return (
    <>
      <PageHeader
        title={template.name}
        eyebrow="Coaching form"
        description="Sections hold questions and data panels. Drag to reorder; Save writes the whole form."
      />
      <CoachingFormBuilder template={template} />
    </>
  );
}
