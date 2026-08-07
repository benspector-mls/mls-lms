-- Not part of this feature, and not removable.
--
-- `migrate diff` reports the enrollments -> profiles foreign key as changed, because the
-- migration that made `student_id` NOT NULL recreated it without spelling out ON UPDATE.
-- Dropping these two statements leaves `migrate diff` reporting drift forever, so they stay:
-- the constraint is dropped and re-added with identical behaviour, inside one migration.
-- DropForeignKey
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_student_id_fkey";

-- CreateTable
CREATE TABLE "instructor_invites" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "redeemed_at" TIMESTAMPTZ(6),
    "redeemed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructor_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instructor_invites_token_key" ON "instructor_invites"("token");

-- CreateIndex
CREATE INDEX "instructor_invites_created_by_id_idx" ON "instructor_invites"("created_by_id");

-- AddForeignKey
ALTER TABLE "instructor_invites" ADD CONSTRAINT "instructor_invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_invites" ADD CONSTRAINT "instructor_invites_redeemed_by_id_fkey" FOREIGN KEY ("redeemed_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deny all browser access to instructor invitations, for the same reason as every other
-- table: Supabase's default privileges grant every permission on new tables in the
-- `public` schema to `anon` and `authenticated`, and this table is never read directly by
-- supabase-js. All access goes through tRPC, which uses Prisma, which connects as the
-- table owner and is therefore not restricted by row level security.
--
-- REVOKE removes the table privileges; enabling row level security with zero policies
-- denies access by default even if a privilege is granted later.
--
-- This table earns the block more than most. A row is a credential that grants staff
-- access to every course and every student's grades, and `token` is the whole of it —
-- readable from the browser it would be a self-service promotion.
REVOKE ALL ON TABLE public."instructor_invites" FROM anon, authenticated;
ALTER TABLE public."instructor_invites" ENABLE ROW LEVEL SECURITY;
