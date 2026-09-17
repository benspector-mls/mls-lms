-- A session can now exist before check-in opens, so an instructor can write the code on a
-- whiteboard before class without starting the clock. That phase is both window columns being
-- null: the row holds a secret and therefore a code, the lateness clock has not started, and no
-- fellow can check in against it.

-- ---------------------------------------------------------------------------
-- The audit value for making a code without opening check-in
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_SESSION_PREPARED';

-- ---------------------------------------------------------------------------
-- The window becomes optional
-- ---------------------------------------------------------------------------

ALTER TABLE public."attendance_sessions"
  ALTER COLUMN "started_at" DROP NOT NULL,
  ALTER COLUMN "ends_at" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- The invariants that keep "prepared" one phase rather than a set of half-states
-- ---------------------------------------------------------------------------

-- A session has a whole window or none of it. The two columns are one fact told in two places —
-- when check-in opened and when its code dies — and a row holding one without the other is not a
-- phase this design has a name for, or a screen that can word it.
--
-- The existing `_window_is_forward` CHECK needs no change: `ends_at > started_at` evaluates to
-- NULL on a prepared row, and a CHECK that evaluates to NULL passes.
ALTER TABLE public."attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_pending_is_paired"
  CHECK (("started_at" IS NULL) = ("ends_at" IS NULL));

-- A day whose check-in never opened cannot have been ended. Deleting it is the only exit, which is
-- what the sweep and `deleteSession` both do.
--
-- Worth asserting here rather than only in the procedures, because the failure is silent. Ending a
-- session writes an ABSENT row for every active enrollment, and `sessionStateOf` reads a null start
-- as "pending" whatever `ended_at` says — so a future write path that reached a prepared session
-- would leave a morning nobody could attend recorded as a morning everybody missed, in a report
-- nobody thinks to question.
ALTER TABLE public."attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_pending_never_ended"
  CHECK ("started_at" IS NOT NULL OR "ended_at" IS NULL);
