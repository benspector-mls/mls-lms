import { Suspense } from "react";

import { Curriculum } from "@/components/instructor/curriculum-view";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";

/**
 * The whole of a course's curriculum: its modules, projects, and assessments, and the assignments
 * and resources inside each.
 *
 * **One screen where there were three.** Modules, Coursework, and Resources were separate pages
 * because a project used to be a different kind of row from a module and an assignment was
 * authored somewhere other than where it lived. All three are course units now, so there is one
 * place to see what is in a course and one place to add to it.
 *
 * No group picker, and no grading figures. A group narrows students, and nothing on this screen
 * counts students; what needs grading is Triage's question.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here — a route may
 * not read uncached data outside `<Suspense>`, and `params` counts.
 */
export default function CurriculumPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
      <CourseCurriculum params={params} />
    </Suspense>
  );
}

async function CourseCurriculum({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Curriculum"
        description="The course as your students meet it. Everything lives in a module, a project, or an assessment."
      />
      <Curriculum courseId={courseId} />
    </div>
  );
}
