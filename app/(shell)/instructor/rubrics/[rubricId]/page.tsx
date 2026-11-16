import { Suspense } from "react";

import { RubricForm } from "@/components/instructor/rubric-form";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/** One rubric's current text, editable by its author or an admin and readable by everyone else. */
export default function RubricPage({ params }: { params: Promise<{ rubricId: string }> }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
        <Rubric params={params} />
      </Suspense>
    </div>
  );
}

async function Rubric({ params }: { params: Promise<{ rubricId: string }> }) {
  const { rubricId } = await params;
  const rubric = await getQueryClient().fetchQuery(trpc.rubrics.get.queryOptions({ rubricId }));

  return (
    <>
      <PageHeader
        title={rubric.name}
        eyebrow="Rubric"
        description={
          rubric.version === null
            ? "No version has been written yet."
            : `Version ${rubric.version}${rubric.author ? `, by ${rubric.author}` : ""}.`
        }
      />
      <RubricForm key={rubric.id} rubric={rubric} />
    </>
  );
}
