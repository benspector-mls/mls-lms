import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { ListSkeleton } from '@/components/list-states';
import { triageHref } from '@/lib/links';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * `/instructor` no longer shows anything; it picks a cohort and hands over.
 *
 * Triage is per-course now, and this address names no course. Rather than inventing an
 * all-courses view nobody asked for, it resolves to a real one — the most recent cohort
 * the caller teaches — so bookmarks and the "Grading triage" link keep working and land
 * somewhere the sidebar can describe. An instructor who teaches nothing is sent to the
 * course list, which is the only useful thing to offer them.
 */
export default function InstructorPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <PickACourse />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <ListSkeleton rows={6} />
    </div>
  );
}

async function PickACourse() {
  const courses = await getQueryClient().fetchQuery(trpc.courses.listMine.queryOptions());

  // `listMine` is newest first and already excludes archived cohorts, so the first one the
  // caller teaches is the term they are most likely in the middle of.
  const teaching = courses.find((course) => course.teaches);

  // Returned rather than called bare so the inferred type stays `never`: a component whose
  // body falls off the end is typed as rendering `void`, which is not a React node.
  return redirect(teaching ? triageHref(teaching.id) : "/courses");
}
