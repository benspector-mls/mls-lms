import "server-only";

import type { ViewingAs } from "../auth/view-as";
import type { AuditAction, Prisma } from "../generated/prisma/client";
import { displayNameOf } from "../people";
import type { Tx } from "../prisma";

/**
 * Writing to the append-only record of who did what.
 *
 * **Every guard in `trpc/init.ts` answers a different question from this one.** They decide
 * whether an act is permitted; this records that it happened. The second question is the one
 * asked afterwards — a grade nobody remembers changing, a student who says they never joined a
 * cohort, an instructor account that should not have been staff — and the rows the application
 * works from cannot answer it, because the act's whole effect was to change them.
 *
 * See the `AuditEvent` model in `schema.prisma` for why the table carries no foreign keys and
 * why every reference is stored beside a text snapshot of what it was called at the time.
 */

/**
 * Who an event is attributed to.
 *
 * Two identities rather than one, because a request made inside a test-student view has two
 * honest answers to "who did this" and reporting either alone is wrong. The admin did it; they
 * did it while the application was answering as somebody else.
 */
export type AuditActor = {
  /** The real signed-in person. */
  id: string | null;
  label: string | null;
  /** The test student they were being answered as, when they were. */
  actedAsId: string | null;
  actedAsLabel: string | null;
};

/** Enough of a person to name them. The columns `personNameSelect` fetches. */
type Nameable = {
  displayName: string | null;
  email: string | null;
  githubUsername: string | null;
};

/**
 * The actor for an event, taken from a procedure's context.
 *
 * **This function exists because `ctx.profile` is the wrong answer half the time, and looks like
 * the right one.** While an admin is in a test-student view, `createTRPCContext` substitutes the
 * test student's id onto `ctx.user`, and `profileProcedure` then loads *the test student's*
 * profile — so an event written from `ctx.profile` names a test student as the actor. That is not
 * a small inaccuracy: it attributes an admin's act to an identity that has no power to perform
 * it, and the events most worth recording are exactly the ones an admin performs.
 *
 * `ctx.viewingAs` is the only thing on the context that still knows who signed in, which is why
 * it is checked first here rather than treated as extra detail.
 */
export function auditActor(ctx: {
  profile: { id: string } & Nameable;
  viewingAs: ViewingAs | null;
}): AuditActor {
  if (ctx.viewingAs) return viewAsActor(ctx.viewingAs);

  return {
    id: ctx.profile.id,
    label: displayNameOf(ctx.profile, "somebody"),
    actedAsId: null,
    actedAsLabel: null,
  };
}

/**
 * The same actor, for the two route handlers that enter and leave a test-student view.
 *
 * They have a `ViewingAs` and no procedure context — entering *is* the act, so there is no
 * `ctx.profile` to have been substituted yet. Exported separately rather than making `profile`
 * optional above, because a caller who has a context should never be able to omit it by accident
 * and get an event with no actor.
 */
export function viewAsActor(viewingAs: ViewingAs): AuditActor {
  const { admin, testStudent } = viewingAs;

  return {
    id: admin.id,
    label: displayNameOf({ ...admin }, "an admin"),
    actedAsId: testStudent.id,
    // Not `displayNameOf`: a test student has no GitHub login, and its number is a better
    // fallback than its address because the number is what the interface calls it.
    actedAsLabel: testStudent.displayName ?? `Test Student ${testStudent.number}`,
  };
}

/** What was acted upon, or the cohort it happened in: an id, and what it was called at the time. */
export type AuditReference = {
  id?: string | null;
  label?: string | null;
};

/**
 * Records one event.
 *
 * **Takes a `Tx` rather than reaching for the module's own client**, for the reason
 * `resolveViewAs` and the scope loaders do: passed a caller's transaction, the event commits with
 * the change it describes, and fails with it. An event written outside the transaction that
 * changed something is a record of an act that may have been rolled back, and — worse in
 * practice — an act that succeeds while its record fails leaves nothing to find later.
 *
 * Returns nothing. There is no failure a caller can act on and nothing downstream reads the row,
 * so a caller that wanted the id would be a caller doing something this table does not support.
 */
/** What one event is, before anything decides how to write it. */
export type AuditEventInput = {
  action: AuditAction;
  actor: AuditActor;
  /** Who or what was acted upon. */
  subject?: AuditReference;
  /**
   * The program it happened in, where it happened in one — which is most acts, since
   * enrollment, the roster, cohorts, and attendance all belong to a program.
   */
  program?: AuditReference;
  /**
   * The course it happened in, for the acts that are about one: a released grade, an assignment
   * published, a course archived.
   *
   * **Both, rather than one replacing the other.** "Which program was this" and "which course
   * was this" are different questions, and a released grade is the only thing in this log that
   * answers the second. An event may name either, both, or neither.
   */
  course?: AuditReference;
  /**
   * Everything the action-specific reader wants: the roles either side of a change, the score
   * released, which of two refusals this was. Read by people rather than by queries, so it is
   * worth writing what a person would need in order to not have to look anything else up.
   */
  detail?: Prisma.InputJsonValue;
};

/**
 * The row, as columns.
 *
 * Separate from `recordEvent` for one caller: `approveDraft` collects its writes into an array and
 * hands the array to `$transaction`, so it needs the *unawaited* `create` rather than a function
 * that awaits one. Sharing this keeps the two forms from drifting into two mappings — which is
 * the failure this table would show as an event with the right shape and the wrong actor.
 */
export function auditEventData(event: AuditEventInput): Prisma.AuditEventUncheckedCreateInput {
  return {
    action: event.action,
    actorId: event.actor.id,
    actorLabel: event.actor.label,
    actedAsId: event.actor.actedAsId,
    actedAsLabel: event.actor.actedAsLabel,
    subjectId: event.subject?.id ?? null,
    subjectLabel: event.subject?.label ?? null,
    programId: event.program?.id ?? null,
    programLabel: event.program?.label ?? null,
    courseId: event.course?.id ?? null,
    courseLabel: event.course?.label ?? null,
    detail: event.detail,
  };
}

export async function recordEvent(db: Tx, event: AuditEventInput): Promise<void> {
  await db.auditEvent.create({ data: auditEventData(event), select: { id: true } });
}
