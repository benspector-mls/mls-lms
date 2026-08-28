import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { programsHref, triageHref } from "@/lib/links";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * `/instructor` no longer shows anything; it picks a cohort and hands over.
 *
 * Triage is per-course now, and this address names no course. Rather than inventing an
 * all-courses view nobody asked for, it resolves to a real one — the most recent cohort
 * the caller teaches — so bookmarks and the "Grading triage" link keep working and land
 * somewhere the sidebar can describe. An instructor who teaches nothing is sent to `/programs`,
 * which is the only useful thing to offer them: it is where a program is made, and where being
 * added to somebody else's shows up.
 */
export default function InstructorPage() {
  return (
    <Suspense fallback={<PageFallback rows={6} width="5xl" />}>
      <PickACourse />
    </Suspense>
  );
}

async function PickACourse() {
  const courses = await getQueryClient().fetchQuery(trpc.courses.listMine.queryOptions());

  // Newest first, and archived courses skipped: this address is a guess at the course somebody
  // is in the middle of, and a finished one is never that. `listMine` returns them now — it
  // has to, or an archived cohort is reachable from nowhere — so the filter is here, where
  // the question is which cohort to open rather than which cohorts exist.
  const teaching = courses.find((course) => course.teaches && course.archivedAt === null);

  // Returned rather than called bare so the inferred type stays `never`: a component whose
  // body falls off the end is typed as rendering `void`, which is not a React node.
  return redirect(teaching ? triageHref(teaching.id) : programsHref());
}
