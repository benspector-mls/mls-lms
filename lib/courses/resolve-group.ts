import "server-only";

import { getQueryClient, trpc } from "@/trpc/server";

import { ALL_STUDENTS } from "./groups";

/**
 * Which group a screen should be built for, and the list its picker draws.
 *
 * Called by every screen that carries the picker, so the precedence rule exists once. It is:
 * **the query string, then the instructor's remembered group, then all students.**
 *
 * The URL winning is what makes a filtered screen linkable — a colleague's link, a bookmark, and
 * the picker's own writes all land the same way. The remembered group filling in when the URL is
 * silent is what makes the feature worth having: an instructor who grades the same fifteen every
 * week would otherwise pick them again on four screens every sitting.
 *
 * `ALL_STUDENTS` last rather than as an error case, because it is the behaviour that existed
 * before groups: a course with none, an admin with nowhere to remember a selection, and a
 * cleared filter all mean the same thing.
 *
 * Resolved before the screen's own read rather than beside it, since that read takes the answer
 * as an argument. One extra query per page load against a table of a handful of rows.
 */
export async function resolveGroup(courseId: string, requested: string | undefined) {
  const queryClient = getQueryClient();
  const groups = await queryClient.fetchQuery(trpc.groups.listForCourse.queryOptions({ courseId }));

  return {
    ...groups,
    /** The value to pass to the screen's own procedure, and to render the picker with. */
    group: requested ?? groups.gradingGroupId ?? ALL_STUDENTS,
  };
}
