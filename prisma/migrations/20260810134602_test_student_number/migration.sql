-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "test_student_number" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "profiles_test_student_number_key" ON "profiles"("test_student_number");

