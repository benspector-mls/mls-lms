import { Suspense } from "react";

import { CurriculaAdmin } from "@/components/admin/curricula-admin";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The curricula the lessons are copied from. Admins only.
 *
 * Not gated here, for the reason the pages beside it are not: adding, copying and removing are
 * `adminProcedure`s, so an instructor who guesses this URL can read the list, which the course
 * Settings screen already shows them, and is refused by the procedures if they press anything.
 *
 * `cacheComponents` is enabled, so the read happens in an async child behind Suspense rather than
 * in the page itself.
 */
export default function AdminLessonsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Lessons"
        description="The curricula on GitHub that courses show as lessons. Each is copied every hour; a course's instructors choose which one it shows on its Settings screen."
      />
      <Suspense fallback={<PageFallback rows={4} width="4xl" />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const curricula = await getQueryClient().fetchQuery(trpc.curricula.list.queryOptions());
  return <CurriculaAdmin curricula={curricula} />;
}
