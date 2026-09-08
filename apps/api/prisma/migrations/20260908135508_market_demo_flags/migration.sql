-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "KeywordSignal" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MarketSignal" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SearchTerm" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;
