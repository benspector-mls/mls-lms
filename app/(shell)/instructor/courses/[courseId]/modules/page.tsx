import { Suspense } from 'react';

import { ModulesTab } from '@/components/instructor/modules-tab';
import { PageHeader } from '@/components/page-header';

/**
 * The modules of one cohort: create, rename, reorder, remove.
 *
 * The only one of the six course screens that needs no server fetch. `ModulesTab` has always
 * been a client query against `modules.listForCourse` — it was the one tab that fetched its own
 * data — so splitting the tabs into routes left it needing nothing but a course id.
 *
 * That also means no Suspense boundary is required around `params` for data reasons, but one is
 * still needed: `cacheComponents` refuses a route that awaits `params` outside one.
 */
export default function ModulesPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Modules"
        description="The order this cohort is taught in. Assignments group by module everywhere they are listed."
      />
      <Suspense fallback={null}>
        <Modules params={params} />
      </Suspense>
    </div>
  );
}

async function Modules({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <ModulesTab courseId={courseId} />;
}
