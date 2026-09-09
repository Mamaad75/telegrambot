-- AlterEnum
ALTER TYPE "RunStatus" ADD VALUE 'COMPLETED_WITH_ERRORS';

-- AlterTable
ALTER TABLE "CampaignRun" ADD COLUMN     "duplicates" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "providerResults" JSONB;

-- AlterTable
ALTER TABLE "SearchTerm" ADD COLUMN     "sourceUrl" TEXT;
