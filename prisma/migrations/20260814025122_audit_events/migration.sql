-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('ROLE_CHANGED', 'INVITE_CREATED', 'INVITE_REVOKED', 'INVITE_REDEEMED', 'ROSTER_ENTRY_ADDED', 'ROSTER_ENTRY_REMOVED', 'ENROLLMENT_JOINED', 'ENROLLMENT_REMOVED', 'ENROLLMENT_RESTORED', 'JOIN_TOKEN_REGENERATED', 'GRADE_APPROVED', 'VIEW_AS_ENTERED', 'TEST_STUDENT_CREATED', 'TEST_STUDENT_DELETED');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" "AuditAction" NOT NULL,
    "actor_id" UUID,
    "actor_label" TEXT,
    "acted_as_id" UUID,
    "acted_as_label" TEXT,
    "subject_id" UUID,
    "subject_label" TEXT,
    "course_id" UUID,
    "course_label" TEXT,
    "detail" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actor_id_occurred_at_idx" ON "audit_events"("actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_course_id_occurred_at_idx" ON "audit_events"("course_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_action_occurred_at_idx" ON "audit_events"("action", "occurred_at" DESC);


-- ---------------------------------------------------------------------------
-- Supabase integration (hand-written; not generated from schema.prisma)
-- ---------------------------------------------------------------------------

-- The standard privilege block. Redundant as of
-- 20260814024306_revoke_public_grants_project_wide, which took the browser roles
-- off future tables by default — kept because the default is a property of the
-- database and this is a property of the table, and the one that travels with the
-- table is the one a reader finds.
REVOKE ALL ON TABLE public."audit_events" FROM anon, authenticated;
ALTER TABLE public."audit_events" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------

-- **Enforced by a trigger, because nothing else can enforce it here.** Revoking
-- UPDATE and DELETE constrains the browser roles, which already have no access at
-- all; it does not constrain Prisma, which connects as the table owner and is how
-- every write in this application reaches Postgres. A log that the application can
-- quietly rewrite records what the application currently believes rather than what
-- happened, which is the one thing an audit log must not do.
--
-- TRUNCATE needs its own statement-level trigger: a row-level BEFORE trigger never
-- fires for it, so without this the table can still be emptied in one statement.
CREATE OR REPLACE FUNCTION public."audit_events_append_only"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_events is append-only; % is not permitted', TG_OP
    USING HINT = 'Correct a mistaken event by recording a new one that supersedes it.';
END;
$$;

CREATE TRIGGER "audit_events_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON public."audit_events"
  FOR EACH ROW EXECUTE FUNCTION public."audit_events_append_only"();

CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON public."audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION public."audit_events_append_only"();

-- Deleting a profile must not be blocked by this table, which is why `actor_id`,
-- `acted_as_id`, `subject_id`, and `course_id` carry no foreign key: there is no
-- cascade or SET NULL for the trigger above to refuse. See the comment on the
-- model in schema.prisma.
--
-- Pruning old events, if it is ever wanted, means dropping the triggers, deleting,
-- and recreating them — deliberately awkward, and a thing to do on purpose.
