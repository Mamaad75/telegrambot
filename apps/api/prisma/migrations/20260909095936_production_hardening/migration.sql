-- CreateEnum
CREATE TYPE "DataQuality" AS ENUM ('FACT', 'AGGREGATE', 'ESTIMATED', 'IMPORTED', 'AI_INSIGHT', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProviderState" ADD VALUE 'HEALTHY';
ALTER TYPE "ProviderState" ADD VALUE 'DEGRADED';

-- AlterTable
ALTER TABLE "AIAnalysis" ADD COLUMN     "promptVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "usedFallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "validationError" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "lastCrawledAt" TIMESTAMP(3),
ADD COLUMN     "websiteMatchConfidence" INTEGER,
ADD COLUMN     "websiteMatchReasons" JSONB,
ADD COLUMN     "websiteMatchedBy" TEXT;

-- AlterTable
ALTER TABLE "MarketSignal" ADD COLUMN     "origin" "DataOrigin" NOT NULL DEFAULT 'AGGREGATE_SEARCH_SIGNAL',
ADD COLUMN     "periodLabel" TEXT,
ADD COLUMN     "quality" "DataQuality" NOT NULL DEFAULT 'AGGREGATE',
ADD COLUMN     "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCheckAt" TIMESTAMP(3),
ADD COLUMN     "lastCheckMessage" TEXT,
ADD COLUMN     "lastCheckOk" BOOLEAN,
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WebsiteAudit" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "engineVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'HTTP';

-- CreateTable
CREATE TABLE "BrowserAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "unavailableReason" TEXT,
    "lcpMs" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "inpMs" DOUBLE PRECISION,
    "fcpMs" DOUBLE PRECISION,
    "ttfbMs" DOUBLE PRECISION,
    "domContentLoadedMs" DOUBLE PRECISION,
    "loadEventMs" DOUBLE PRECISION,
    "viewportWidth" INTEGER,
    "viewportHeight" INTEGER,
    "fitsMobileViewport" BOOLEAN,
    "horizontalOverflowPx" INTEGER,
    "smallestFontPx" DOUBLE PRECISION,
    "smallTapTargets" INTEGER,
    "consoleErrors" JSONB,
    "failedRequests" JSONB,
    "requestCount" INTEGER,
    "transferredBytes" INTEGER,
    "screenshotPath" TEXT,
    "browserName" TEXT,
    "browserVersion" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowserAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrowserAudit_auditId_key" ON "BrowserAudit"("auditId");

-- CreateIndex
CREATE INDEX "BrowserAudit_leadId_idx" ON "BrowserAudit"("leadId");

-- CreateIndex
CREATE INDEX "BrowserAudit_createdAt_idx" ON "BrowserAudit"("createdAt");

-- CreateIndex
CREATE INDEX "AIAnalysis_leadId_inputHash_promptVersion_model_idx" ON "AIAnalysis"("leadId", "inputHash", "promptVersion", "model");

-- CreateIndex
CREATE INDEX "FollowUp_userId_completedAt_dueAt_idx" ON "FollowUp"("userId", "completedAt", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_completedAt_dueAt_idx" ON "FollowUp"("completedAt", "dueAt");

-- CreateIndex
CREATE INDEX "JobLog_jobName_startedAt_idx" ON "JobLog"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "KeywordSignal_keywordId_city_date_idx" ON "KeywordSignal"("keywordId", "city", "date");

-- CreateIndex
CREATE INDEX "KeywordSignal_isDemo_date_idx" ON "KeywordSignal"("isDemo", "date");

-- CreateIndex
CREATE INDEX "Lead_originalPhone_idx" ON "Lead"("originalPhone");

-- CreateIndex
CREATE INDEX "Lead_isArchived_isDemo_leadScore_idx" ON "Lead"("isArchived", "isDemo", "leadScore" DESC);

-- CreateIndex
CREATE INDEX "Lead_isArchived_isDemo_leadTemperature_leadScore_idx" ON "Lead"("isArchived", "isDemo", "leadTemperature", "leadScore" DESC);

-- CreateIndex
CREATE INDEX "Lead_isArchived_isDemo_assignedToId_contactStatus_idx" ON "Lead"("isArchived", "isDemo", "assignedToId", "contactStatus");

-- CreateIndex
CREATE INDEX "Lead_isArchived_isDemo_nextFollowUpAt_idx" ON "Lead"("isArchived", "isDemo", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "Lead_isArchived_isDemo_city_recommendedService_idx" ON "Lead"("isArchived", "isDemo", "city", "recommendedService");

-- CreateIndex
CREATE INDEX "Lead_isArchived_isDemo_createdAt_idx" ON "Lead"("isArchived", "isDemo", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_campaignId_leadTemperature_idx" ON "Lead"("campaignId", "leadTemperature");

-- CreateIndex
CREATE INDEX "Opportunity_serviceKey_score_idx" ON "Opportunity"("serviceKey", "score" DESC);

-- CreateIndex
CREATE INDEX "SalesActivity_leadId_createdAt_idx" ON "SalesActivity"("leadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SalesActivity_userId_type_createdAt_idx" ON "SalesActivity"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "SearchTerm_serviceKey_city_date_idx" ON "SearchTerm"("serviceKey", "city", "date");

-- CreateIndex
CREATE INDEX "SearchTerm_isDemo_date_idx" ON "SearchTerm"("isDemo", "date");

-- CreateIndex
CREATE INDEX "Task_assignedToId_status_dueAt_idx" ON "Task"("assignedToId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "WebsiteAudit_leadId_createdAt_idx" ON "WebsiteAudit"("leadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WebsiteAudit_contentHash_idx" ON "WebsiteAudit"("contentHash");

-- AddForeignKey
ALTER TABLE "BrowserAudit" ADD CONSTRAINT "BrowserAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
