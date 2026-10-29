import { Suspense } from "react";

import { CoachingFormsAdmin } from "@/components/admin/coaching-forms-admin";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The coaching forms, which every program shares and admins write. Admins only.
 *
 * Not gated here, for the reason the Staff and Competencies pages beside it are not: the read is
 * `coachingTemplates.all`, an `adminProcedure`, so an instructor who guesses this URL gets a
 * refusal from the procedure rather than a screen this page decided not to render.
 *
 * `cacheComponents` is enabled, so the read happens in an async child behind Suspense rather than
 * in the page itself.
 */
export default function CoachingFormsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Coaching forms"
        description="What a coaching session asks, section by section, and which of the fellow's data it shows beside the questions. A session keeps the form it was started with."
      />
      <Suspense fallback={<PageFallback rows={6} width="4xl" />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const templates = await getQueryClient().fetchQuery(trpc.coachingTemplates.all.queryOptions());

  return <CoachingFormsAdmin templates={templates} />;
}
