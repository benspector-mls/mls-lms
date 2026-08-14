-- Two more audited actions, for the operations that cost money.
--
-- A model call and a sandbox run are the only things this application does that spend anything
-- per use, and until now nothing recorded that they happened. Recording them serves two purposes
-- at once, which is the reason they are here rather than in a counter table of their own:
-- "who generated forty drafts overnight" is a question worth being able to answer, and counting
-- an actor's recent events is what `lib/audit/rate-limit.ts` uses to decide whether to allow the
-- next one. The index on (actor_id, occurred_at DESC) already exists for the first purpose and
-- is exactly the index the second one needs.
--
-- `ALTER TYPE ... ADD VALUE` runs inside the transaction Prisma wraps this file in, which
-- Postgres permits as long as the new values are not *used* in the same transaction. Nothing here
-- writes a row, so this is safe; a later migration inserting one of these would not be.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DRAFT_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TESTS_RUN';
