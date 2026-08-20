import type { Prisma } from "../generated/prisma/client";

/**
 * Which assignments a student is actually being asked to do.
 *
 * One function rather than a `where` clause written twice, because two readers answer this
 * question and they must never differ: `assignments.listMine`, which draws the dashboard, and the
 * calendar feed at `app/api/calendar/[token]/route.ts`. A feed telling a student to hand in work
 * for a cohort they have finished, or hiding an assignment their dashboard shows, is the kind of
 * disagreement nobody notices until somebody misses a deadline.
 *
 * No `server-only`: it builds an argument for a query rather than running one.
 */

/**
 * Published work, in a cohort that is still running, that this student is actively enrolled in.
 *
 * **Narrower than a course page, on purpose, and each of the three conditions has its own reason.**
 *
 * `distributedAt` is what makes authoring safe. An assignment can be built over several sittings,
 * and a section mapping corrected, without a student seeing a half-finished one — and unlike the
 * course page there is no instructor mode to fall into here, because neither reader has one.
 *
 * `archivedAt` and an `ACTIVE` enrollment are the pair that differs from the course page. A removed
 * student keeps reading the feedback they were given and an archived cohort stays readable — both
 * are settled — but a *deadline* list for a cohort somebody has finished or been removed from would
 * be telling them to hand in work that would be refused.
 */
export function distributedToStudent(studentId: string): Prisma.AssignmentWhereInput {
  return {
    distributedAt: { not: null },
    course: {
      archivedAt: null,
      enrollments: { some: { studentId, status: "ACTIVE" } },
    },
  };
}
