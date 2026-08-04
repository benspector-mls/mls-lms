-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('REPO', 'GOOGLE_DOC', 'FILE_UPLOAD');

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "kind" "AssignmentKind" NOT NULL DEFAULT 'REPO',
ALTER COLUMN "template_repo" DROP NOT NULL,
ALTER COLUMN "assignment_repo_name" DROP NOT NULL,
ALTER COLUMN "github_org" DROP NOT NULL;

