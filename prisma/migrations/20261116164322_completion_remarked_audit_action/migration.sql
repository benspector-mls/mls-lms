-- Changing an assignment's completion threshold re-marks the submissions already graded against
-- the old one, and each verdict that flips is recorded as one audit event about that fellow.
--
-- One enum value and nothing else. No existing row changes, and code that does not write the value
-- runs unchanged against it.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COMPLETION_REMARKED';
