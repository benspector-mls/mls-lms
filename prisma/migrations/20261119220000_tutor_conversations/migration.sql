-- CreateEnum
CREATE TYPE "TutorRole" AS ENUM ('USER', 'TUTOR');

-- CreateTable
CREATE TABLE "tutor_messages" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "assignment_id" UUID,
    "role" "TutorRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "model_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tutor_messages_profile_id_course_id_assignment_id_created_a_idx" ON "tutor_messages"("profile_id", "course_id", "assignment_id", "created_at");

-- AddForeignKey
ALTER TABLE "tutor_messages" ADD CONSTRAINT "tutor_messages_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_messages" ADD CONSTRAINT "tutor_messages_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_messages" ADD CONSTRAINT "tutor_messages_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written from here down. `migrate diff` cannot see any of it.

-- Reached only through the application's own connection; Supabase's client roles have no business
-- here, same as every other table.
REVOKE ALL ON TABLE public."tutor_messages" FROM anon, authenticated;
ALTER TABLE public."tutor_messages" ENABLE ROW LEVEL SECURITY;
