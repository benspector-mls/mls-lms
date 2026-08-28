import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageFallback } from "@/components/list-states";
import { LAST_PLACE_COOKIE, viewPlaceOf } from "@/lib/instructor/last-place";
import { programsHref, triageHref } from "@/lib/links";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * `/instructor` no longer shows anything; it picks a screen and hands over.
 *
 * Triage is per-course now, and this address names no course. Rather than inventing an
 * all-courses view nobody asked for, it resolves to a real one — where the caller last was, and
 * failing that the most recent cohort they teach — so bookmarks and the "Grading triage" link keep
 * working and land somewhere the sidebar can describe. An instructor who teaches nothing and has
 * been nowhere is sent to `/programs`, which is the only useful thing to offer them: it is where a
 * program is made, and where being added to somebody else's shows up.
 *
 * **This is the one address that reads the remembered place**, and that is the whole of the
 * precedence rule: every other instructor address names its own scope, so there is nothing for a
 * remembered value to add and every reason for it not to interfere. See `lib/instructor/last-place`.
 */
export default function InstructorPage() {
  return (
    <Suspense fallback={<PageFallback rows={6} width="5xl" />}>
      <PickACourse />
    </Suspense>
  );
}

async function PickACourse() {
  const queryClient = getQueryClient();

  /*
    Programs as well as courses, because the case this feature most exists for is an instructor
    setting up next term: a program is created empty, so the program they spent yesterday in has no
    row in the course list at all. Both lists are a handful of rows and this page renders nothing.
  */
  const [courses, programs, cookieStore] = await Promise.all([
    queryClient.fetchQuery(trpc.courses.listMine.queryOptions()),
    queryClient.fetchQuery(trpc.programs.listMine.queryOptions()),
    cookies(),
  ]);

  const remembered = viewPlaceOf(cookieStore.get(LAST_PLACE_COOKIE)?.value ?? "");

  if (remembered) {
    /*
      Checked against the caller's own lists rather than trusted, which does two jobs at once. A
      cookie left in a shared browser by the instructor before them names a course they do not
      teach, and a course or program they have since been removed from names one they no longer do
      — both fall through to the guess below rather than to a screen that refuses.

      Archived is skipped for the reason the guess skips it: this is an attempt at the thing
      somebody is in the middle of, and a finished one is never that. A course archived at the end
      of a term should not be reopened every morning of the next one.
    */
    const reachable =
      remembered.scope === "courses"
        ? courses.some(
            (course) => course.id === remembered.id && course.teaches && course.archivedAt === null,
          )
        : programs.some(
            (program) =>
              program.id === remembered.id && program.instructs && program.archivedAt === null,
          );

    if (reachable) redirect(remembered.href);
  }

  // Newest first, and archived courses skipped: this address is a guess at the course somebody
  // is in the middle of, and a finished one is never that. `listMine` returns them now — it
  // has to, or an archived cohort is reachable from nowhere — so the filter is here, where
  // the question is which cohort to open rather than which cohorts exist.
  const teaching = courses.find((course) => course.teaches && course.archivedAt === null);

  // Returned rather than called bare so the inferred type stays `never`: a component whose
  // body falls off the end is typed as rendering `void`, which is not a React node.
  return redirect(teaching ? triageHref(teaching.id) : programsHref());
}
