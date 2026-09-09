-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "matchKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];
