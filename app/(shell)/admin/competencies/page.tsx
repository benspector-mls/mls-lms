import { Suspense } from "react";

import { CompetencyAdmin } from "@/components/admin/competency-admin";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The competency list, which every program shares and admins write. Admins only.
 *
 * Not gated here, for the reason the Staff page beside it is not: the read is `competencies.all`,
 * which is an `adminProcedure`, so an instructor who guesses this URL gets a refusal from the
 * procedure rather than a screen this page decided not to render. Prisma connects as the table
 * owner and is not restricted by row level security, so a page-level check would be decoration
 * over an unguarded read.
 *
 * `cacheComponents` is enabled, so the read happens in an async child behind Suspense rather than
 * in the page itself.
 */
export default function CompetenciesPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Competencies"
        description="What the school says a fellow is developing, and which fellowships each part of it is offered to."
      />
      <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const groups = await getQueryClient().fetchQuery(trpc.competencies.all.queryOptions());

  return <CompetencyAdmin groups={groups} />;
}
