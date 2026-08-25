import type { Prisma } from "../generated/prisma/client";

/**
 * Which assignments a student is actually being asked to do.
 *
 * One function rather than a `where` clause written twice, because two readers answer this
 * question and they must never differ: `assignments.listMine`, which draws the dashboard, and the
 * calendar feed at `app/api/calendar/[token]/route.ts`. A feed telling a fellow to hand in work for
 * a course they have finished, or hiding an assignment their dashboard shows, is the kind of
 * disagreement nobody notices until somebody misses a deadline.
 *
 * No `server-only`: it builds an argument for a query rather than running one.
 */

/**
 * Published work, in a published and unarchived course, that this fellow is actively enrolled for.
 *
 * **Narrower than a course page, on purpose, and each of the four conditions has its own reason.**
 *
 * `distributedAt` is what makes authoring safe. An assignment can be built over several sittings,
 * and a section mapping corrected, without a fellow seeing a half-finished one — and unlike the
 * course page there is no instructor mode to fall into here, because neither reader has one.
 *
 * **`publishedAt` is the course-level counterpart of it**, and it is here because being on a
 * program's roster now makes somebody a student of every course of the program. Without it, a
 * fellow's dashboard and their calendar would both carry deadlines from a course that begins in
 * March. This is the third of the three readers that have to agree about publication — the other
 * two are `courses.listMine` and `assertCourseMember` — and `verify:calendar` is what catches them
 * disagreeing, because it asserts this reader and `assignments.listMine` answer identically.
 *
 * `archivedAt` and an `ACTIVE` enrollment are the pair that differs from the course page. A removed
 * fellow keeps reading the feedback they were given and an archived course stays readable — both are
 * settled — but a *deadline* list for a course somebody has finished, or a program they have been
 * removed from, would be telling them to hand in work that would be refused.
 *
 * The enrollment is reached through the program rather than through the course, because that is
 * where it lives; the course still supplies the other two conditions.
 */
export function distributedToStudent(studentId: string): Prisma.AssignmentWhereInput {
  return {
    distributedAt: { not: null },
    course: {
      publishedAt: { not: null },
      archivedAt: null,
      program: { enrollments: { some: { studentId, status: "ACTIVE" } } },
    },
  };
}
