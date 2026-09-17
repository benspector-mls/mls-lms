-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "extended_due_at" TIMESTAMPTZ(6),
ADD COLUMN     "extension_granted_at" TIMESTAMPTZ(6),
ADD COLUMN     "extension_granted_by" UUID;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_extension_granted_by_fkey" FOREIGN KEY ("extension_granted_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ===========================================================================
-- Hand-written from here down. `migrate diff` cannot see any of it, so it
-- survives rather than being proposed for removal on the next migration.
--
-- The foreign key above is deliberately not down here: a foreign key is
-- something `migrate diff` can see, so it is declared in schema.prisma.
--
-- No privilege block. That is what a new table needs; `submissions` already
-- has its grants revoked and row level security enabled, and neither is
-- affected by adding a column.
-- ===========================================================================

-- The three columns are null together or set together. An extension nobody
-- granted, or one granted at no time, is not a state worth admitting — and a
-- half-written grant would make `lateness` read "Extended" with nothing to show
-- the fellow about who agreed to it or when.
--
-- A CHECK rather than three NOT NULLs, because the columns are genuinely
-- optional: most submissions have no extension and never will.
ALTER TABLE public."submissions"
  ADD CONSTRAINT "submissions_extension_is_whole"
  CHECK (
    ("extended_due_at" IS NULL
      AND "extension_granted_by" IS NULL
      AND "extension_granted_at" IS NULL)
    OR
    ("extended_due_at" IS NOT NULL
      AND "extension_granted_by" IS NOT NULL
      AND "extension_granted_at" IS NOT NULL)
  );
