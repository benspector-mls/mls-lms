import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * The column sets more than one procedure reads, written once.
 *
 * Not every repeated select belongs here — a fragment that two procedures happen to share today
 * and would diverge tomorrow is better spelled out. What is here is the three that are *the same
 * question*: who a person is, which cohort this is, and where a module sits. A field added to one
 * of those and missed at another call site is not a visible difference; it is a crash in a
 * component that both screens render, or a column that silently reads as absent.
 *
 * `satisfies` rather than a type annotation, so each keeps its literal type — Prisma derives the
 * payload from the object, and annotating it as `Prisma.XSelect` would widen every field to
 * `boolean` and take the inferred result type with it.
 *
 * **Some narrow selects are deliberate and are not here.** `courses.previewCoTeach` and
 * `enrollments.preview` read `displayName` alone, because they answer somebody who is not yet in
 * the course — widening those to `personSelect` would hand an instructor's email address to a
 * stranger holding a link. A narrow select is sometimes a decision rather than an omission.
 */

/**
 * Who somebody is, wherever a screen shows a person.
 *
 * The first four columns because the interface falls back through them: a display name if they set
 * one, their GitHub login if not, their email as the last resort. `displayNameOf` below is that
 * fallback, and it reads exactly these.
 *
 * `testStudentNumber` is here rather than added at the three call sites that need it, which is what
 * this module is for: the roster, the gradebook, and triage all draw a person, and all three have to
 * be able to say this one is not real. A screen that read a person without it would show a test
 * student as a student who has not started — the exact failure the badge exists to prevent, arrived
 * at by omission.
 */
export const personSelect = {
  id: true,
  displayName: true,
  email: true,
  githubUsername: true,
  testStudentNumber: true,
} satisfies Prisma.ProfileSelect;

/**
 * The same, without the id, for the places that only need to name somebody in a sentence.
 *
 * A refusal message says who owns a cohort; it does not need their id, and selecting one would
 * put a column in a payload for no reader.
 */
export const personNameSelect = {
  displayName: true,
  email: true,
  githubUsername: true,
} satisfies Prisma.ProfileSelect;

/**
 * Whatever this person is best called, re-exported from `lib/people.ts` so a procedure can take
 * it from the same module as the select it has to agree with.
 *
 * It lives there rather than here because the browser asks the same question — every roster row
 * and every avatar — and this module imports Prisma's generated types and belongs to the
 * transport layer, so a component reaching for it would be reaching across two boundaries to
 * borrow four lines with no imports of their own.
 */
export { displayNameOf } from "@/lib/people";

/**
 * A course, as every screen that names one reads it.
 *
 * `archivedAt` is in it rather than optional because *every* reader has to know: an archived course
 * is readable, is in the course list, and takes nothing new — and a screen that fetched the name
 * without it would render a finished term as a live one. `publishedAt` is in it for the mirror of
 * that reason: an unpublished course is one no fellow can see, and an instructor's screen has to say
 * so rather than leave them wondering why nobody has submitted.
 *
 * The program comes with it because a course's name does not identify it on its own — a program runs
 * the same courses every term, so "Fullstack Software Engineering" needs the term beside it
 * before anybody knows which one they are looking at.
 */
export const courseHeaderSelect = {
  id: true,
  name: true,
  publishedAt: true,
  archivedAt: true,
  program: { select: { id: true, name: true, term: true } },
} satisfies Prisma.CourseSelect;

/**
 * A module, as everything that groups by one reads it.
 *
 * `position` is in it because the order is the whole point — a module list without it sorts
 * alphabetically, which is an ordering of the names rather than of the course.
 */
export const courseUnitSummarySelect = {
  id: true,
  name: true,
  position: true,
  /*
    What the unit is for, which is what every reader of this select turns into a label, a tab, or
    a badge. Here rather than added per call site because ten of them read this object, and a
    category fetched by nine of them and missed by the tenth is a screen that silently calls a
    project a module.
  */
  category: true,
} satisfies Prisma.CourseUnitSelect;

/**
 * A resource, as every screen that shows one reads it.
 *
 * **The whole row, including the body of a note and the id of a video**, because both sides of the
 * application now render a resource the same way. A student's course page opens a note in place
 * and plays a video where it sits; the instructor's Curriculum screen shows each resource exactly
 * as the cohort meets it, and the edit form fills its fields from the same object. A select
 * narrowed to a title and a kind would leave the instructor with a list of names and no way to
 * read what is in them without opening the form.
 *
 * `courseUnitId` is in it because a resource can be moved between the units of its course, and the
 * form's Module field has to arrive holding the one it is in.
 */
export const resourceSelect = {
  id: true,
  kind: true,
  title: true,
  url: true,
  description: true,
  body: true,
  videoProvider: true,
  videoId: true,
  courseUnitId: true,
} satisfies Prisma.ResourceSelect;
