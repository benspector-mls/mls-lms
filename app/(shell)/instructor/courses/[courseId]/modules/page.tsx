import { Suspense } from 'react';

import { CourseModules } from '@/components/instructor/modules-view';
import { PageHeader } from '@/components/page-header';

/**
 * The course's shape: every module, in order, holding what is in it.
 *
 * The only one of the six course screens that needs no server fetch. `CourseModules` is a
 * client query against `modules.listForCourse` — it was the one tab that fetched its own data,
 * and it still is, because every control on it is a mutation against that same list.
 *
 * That also means no Suspense boundary is required around `params` for data reasons, but one is
 * still needed: `cacheComponents` refuses a route that awaits `params` outside one.
 */
export default function ModulesPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Modules"
        description="The course as your students meet it. Reorder modules here; assignments are listed by due date."
      />
      <Suspense fallback={null}>
        <Modules params={params} />
      </Suspense>
    </div>
  );
}

async function Modules({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <CourseModules courseId={courseId} />;
}
