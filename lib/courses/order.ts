import "server-only";

import { Prisma } from "../generated/prisma/client";
import type { Tx } from "../prisma";

/**
 * The one statement that writes a presentation order, for the two tables that have one.
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
const SEQUENCES = {
  courseUnits: { table: "course_units", scope: "course_id" },
  resources: { table: "resources", scope: "course_unit_id" },
} as const;

export async function writeOrder(
  tx: Tx,
  /*
    A key of the table above rather than a table name, so the only strings that ever reach
    `Prisma.raw` are the two literals written here. Nothing a request carries can reach it.
  */
  of: keyof typeof SEQUENCES,
  scopeId: string,
  ids: string[],
): Promise<void> {
  const { table, scope } = SEQUENCES[of];

  await tx.$executeRaw`
    UPDATE ${Prisma.raw(`"${table}"`)} AS t
       SET position = ordered.position, updated_at = now()
      FROM (
        SELECT id, position
          FROM unnest(${ids}::text[], ${ids.map((_, index) => index)}::int[])
            AS u(id, position)
      ) AS ordered
     WHERE t.id::text = ordered.id
       AND t.${Prisma.raw(`"${scope}"`)} = ${scopeId}::uuid
  `;
}
