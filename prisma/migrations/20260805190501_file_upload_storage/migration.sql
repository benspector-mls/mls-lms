-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "accepted_file_types" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "upload_content_type" TEXT,
ADD COLUMN     "upload_filename" TEXT,
ADD COLUMN     "upload_path" TEXT,
ADD COLUMN     "upload_size_bytes" INTEGER;

