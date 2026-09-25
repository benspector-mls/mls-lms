import "server-only";

import { Prisma } from "../generated/prisma/client";
import type { Tx } from "../prisma";

/**
 * The one statement that writes a presentation order, for every table that has one.
 *
 * **One statement, which is what makes it atomic on its own.** The obvious implementation is one
 * `update` per row, and a half-applied order is worse than none — the page would show two rows in
 * the same place with no way to tell which move failed. A single UPDATE cannot half-apply, so it
 * composes with whatever transaction is above it and needs none of its own.
 *
 * **Shared by every caller that writes a position, so one place decides what an order is.** A unit
 * created in the middle of a term, a unit dragged, a resource dragged: the sequence has one
 * definition, and a second way to write it is how two screens come to disagree about what order a
 * course is in. It was already this function for `course_units` and a copy of it was the obvious
 * way to give resources the same behaviour — which is exactly how the second copy comes to be the
 * one that was not fixed.
 *
 * The scope column is in the predicate as well as being checked by the callers, every one of which
 * already refuses a list that is not exactly the rows it is allowed to touch. This means that even
 * if one of them did not, the statement still cannot reach another course's or another module's
 * rows.
 *
 * Takes a `Tx` rather than a client, because callers may be running inside a transaction that is
 * not theirs — see `inTransaction` in lib/prisma.ts.
 */
type Sequence = {
  table: string;
  /** The column a position is dense within, or null for a sequence with nothing above it. */
  scope: string | null;
  /**
   * Whether writing a position also moves the row's `updated_at`.
   *
   * **True everywhere the Salesforce feed does not read the table, and false where it does.** This
   * statement writes `updated_at = now()` from Postgres, at microsecond precision, where Prisma's
   * `@updatedAt` writes milliseconds. `lib/integrations/salesforce/cursor.ts` relies on the latter
   * for every table it walks by `updatedAt`: a microsecond value compares greater than the
   * millisecond cursor that was written from it, so the row sits at the top of every page forever.
   *
   * `courses` is the one table here the feed does read — as a Class in
   * `lib/integrations/salesforce/collections.ts`, and as the position of every Registration hanging
   * off it in `registrationRecord`. Leaving its `updated_at` alone is also the honest answer rather
   * than merely the safe one: the feed carries a course's name and whether it is archived, and
   * nothing about where it sits in a list. A reorder is not news to Salesforce.
   *
   * A required field rather than a note in this comment, so that adding a table here is a decision
   * about the feed rather than a line somebody could copy from the entry above it.
   */
  movesUpdatedAt: boolean;
};

const SEQUENCES = {
  courseUnits: { table: "course_units", scope: "course_id", movesUpdatedAt: true },
  resources: { table: "resources", scope: "course_unit_id", movesUpdatedAt: true },
  competencies: { table: "competencies", scope: "group_id", movesUpdatedAt: true },
  competencyEntries: {
    table: "competency_entries",
    scope: "competency_id",
    movesUpdatedAt: true,
  },
  /*
    The one sequence with nothing above it: the sections are the top level of the competency list,
    so there is no column to scope them by and the predicate is left out for them. Every other
    sequence here keeps it, and the reason it is worth keeping is below.
  */
  competencyGroups: { table: "competency_groups", scope: null, movesUpdatedAt: true },
  /*
    The courses of one program, ordered by that program's owner. The only sequence whose rows the
    Salesforce feed reads, which is what `movesUpdatedAt: false` is about — see the field above.
  */
  courses: { table: "courses", scope: "program_id", movesUpdatedAt: false },
} satisfies Record<string, Sequence>;

export async function writeOrder(
  tx: Tx,
  /*
    A key of the table above rather than a table name, so the only strings that ever reach
    `Prisma.raw` are the literals written here. Nothing a request carries can reach it.
  */
  of: keyof typeof SEQUENCES,
  /** Null for a sequence that has nothing above it — see `competencyGroups` above. */
  scopeId: string | null,
  ids: string[],
): Promise<void> {
  const { table, scope, movesUpdatedAt } = SEQUENCES[of];

  const within =
    scope === null
      ? Prisma.empty
      : Prisma.sql`AND t.${Prisma.raw(`"${scope}"`)} = ${scopeId}::uuid`;

  /** See `movesUpdatedAt` above for why one table leaves the column where it is. */
  const touch = movesUpdatedAt ? Prisma.sql`, updated_at = now()` : Prisma.empty;

  await tx.$executeRaw`
    UPDATE ${Prisma.raw(`"${table}"`)} AS t
       SET position = ordered.position${touch}
      FROM (
        SELECT id, position
          FROM unnest(${ids}::text[], ${ids.map((_, index) => index)}::int[])
            AS u(id, position)
      ) AS ordered
     WHERE t.id::text = ordered.id
       ${within}
  `;
}
