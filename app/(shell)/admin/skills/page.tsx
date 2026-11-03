import { Suspense } from "react";

import { SkillTaxonomyAdmin } from "@/components/admin/skill-taxonomy-admin";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The skills taxonomies, one per discipline, which assignments are tagged from and the Skills
 * tabs read. Admins only.
 *
 * Not gated here, for the reason the Competencies page beside it is not: the read is
 * `skills.all`, which is an `adminProcedure`, so an instructor who guesses this URL gets a refusal
 * from the procedure rather than a screen this page decided not to render.
 *
 * `cacheComponents` is enabled, so the read happens in an async child behind Suspense rather than
 * in the page itself.
 */
export default function SkillsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Skills"
        description="Each fellowship's taxonomy of graded skills: the groups, and the skills an assignment's sections are tagged with."
      />
      <Suspense fallback={<PageFallback rows={6} width="4xl" />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const taxonomies = await getQueryClient().fetchQuery(trpc.skills.all.queryOptions());

  return <SkillTaxonomyAdmin taxonomies={taxonomies} />;
}
