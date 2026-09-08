-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SALES_MANAGER', 'SALESPERSON');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('UNKNOWN', 'NO_WEBSITE', 'NOT_VERIFIED', 'ACTIVE', 'PARKED', 'BROKEN', 'SOCIAL_ONLY');

-- CreateEnum
CREATE TYPE "LeadTemperature" AS ENUM ('LOW', 'MEDIUM', 'WARM', 'HOT');

-- CreateEnum
CREATE TYPE "BusinessValueTier" AS ENUM ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'RESEARCHED', 'READY_TO_CALL', 'CONTACTED', 'NO_ANSWER', 'CALLBACK', 'INTERESTED', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('LEAD_SOURCE', 'SEARCH', 'BUSINESS_DATA', 'WEBSITE', 'AI', 'KEYWORD_INSIGHT', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "ProviderState" AS ENUM ('CONFIGURED', 'NOT_CONFIGURED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "WebsiteFilter" AS ENUM ('ANY', 'NO_WEBSITE', 'HAS_WEBSITE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'NOTE', 'STATUS_CHANGE', 'ASSIGNMENT', 'EMAIL', 'MEETING', 'PROPOSAL_SENT', 'FOLLOW_UP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('ANSWERED', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'CALLBACK_REQUESTED', 'NOT_INTERESTED', 'INTERESTED', 'MEETING_SET');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('HOT_LEAD', 'LEAD_ASSIGNED', 'FOLLOW_UP_DUE', 'CAMPAIGN_COMPLETED', 'AI_ANALYSIS_COMPLETED', 'PROVIDER_FAILURE', 'DAILY_SUMMARY');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'TELEGRAM', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MarketSignalStrength" AS ENUM ('INSUFFICIENT_DATA', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "KeywordSource" AS ENUM ('GOOGLE_ADS', 'SEARCH_CONSOLE', 'MANUAL_IMPORT', 'SITE_ANALYTICS', 'PROVIDER');

-- CreateEnum
CREATE TYPE "DataOrigin" AS ENUM ('PUBLIC_BUSINESS_RESEARCH', 'FIRST_PARTY_BAIMAR', 'ADVERTISING_CAMPAIGN', 'AGGREGATE_SEARCH_SIGNAL', 'AI_INFERENCE', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('FACT', 'CALCULATED', 'ESTIMATED', 'AI_INSIGHT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SALESPERSON',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "telegramChatId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'fa',
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "lastLoginAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "normalizedBusinessName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "businessType" TEXT,
    "category" TEXT,
    "subcategory" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IR',
    "province" TEXT,
    "city" TEXT,
    "area" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "originalPhone" TEXT,
    "normalizedPhone" TEXT,
    "mobile" TEXT,
    "extraPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email" TEXT,
    "website" TEXT,
    "websiteStatus" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN',
    "websiteDomain" TEXT,
    "websiteCheckedAt" TIMESTAMP(3),
    "googleMapsUrl" TEXT,
    "instagramUrl" TEXT,
    "telegramUrl" TEXT,
    "linkedinUrl" TEXT,
    "whatsappUrl" TEXT,
    "facebookUrl" TEXT,
    "aparatUrl" TEXT,
    "description" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openingHours" JSONB,
    "reviewCount" INTEGER,
    "reviewRating" DOUBLE PRECISION,
    "businessSizeEstimate" TEXT,
    "businessValueScore" INTEGER,
    "businessValueTier" "BusinessValueTier" NOT NULL DEFAULT 'UNKNOWN',
    "businessValueReasons" JSONB,
    "leadScore" INTEGER,
    "leadTemperature" "LeadTemperature",
    "scoreBreakdown" JSONB,
    "scoredAt" TIMESTAMP(3),
    "recommendedService" TEXT,
    "secondaryServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salesAngle" TEXT,
    "painPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opportunities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decisionMakerName" TEXT,
    "decisionMakerRole" TEXT,
    "contactStatus" "ContactStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "createdById" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "campaignId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSourceReference" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "leadSourceId" TEXT,
    "providerKey" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceUrl" TEXT,
    "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origin" "DataOrigin" NOT NULL DEFAULT 'PUBLIC_BUSINESS_RESEARCH',
    "confidence" "Confidence" NOT NULL DEFAULT 'FACT',
    "raw" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "country" TEXT NOT NULL DEFAULT 'IR',
    "province" TEXT,
    "city" TEXT,
    "area" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "providers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "websiteFilter" "WebsiteFilter" NOT NULL DEFAULT 'ANY',
    "minLeadScore" INTEGER,
    "maxResults" INTEGER NOT NULL DEFAULT 200,
    "enableAi" BOOLEAN NOT NULL DEFAULT true,
    "aiMinScore" INTEGER NOT NULL DEFAULT 65,
    "createdById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "collected" INTEGER NOT NULL DEFAULT 0,
    "unique" INTEGER NOT NULL DEFAULT 0,
    "merged" INTEGER NOT NULL DEFAULT 0,
    "qualified" INTEGER NOT NULL DEFAULT 0,
    "hot" INTEGER NOT NULL DEFAULT 0,
    "warm" INTEGER NOT NULL DEFAULT 0,
    "medium" INTEGER NOT NULL DEFAULT 0,
    "low" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "log" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteAudit" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "reachable" BOOLEAN NOT NULL DEFAULT false,
    "httpStatus" INTEGER,
    "redirectChain" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raw" JSONB NOT NULL,
    "seoScore" INTEGER,
    "mobileScore" INTEGER,
    "performanceScore" INTEGER,
    "uxScore" INTEGER,
    "conversionScore" INTEGER,
    "technicalScore" INTEGER,
    "accessibilityScore" INTEGER,
    "overallScore" INTEGER,
    "unavailable" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "findings" JSONB,
    "technologies" JSONB,
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" INTEGER,
    "responseMs" INTEGER,
    "hasSsl" BOOLEAN,
    "hasViewport" BOOLEAN,
    "hasContactForm" BOOLEAN,
    "hasContactPage" BOOLEAN,
    "hasAboutPage" BOOLEAN,
    "hasBlog" BOOLEAN,
    "hasEcommerce" BOOLEAN,
    "hasBooking" BOOLEAN,
    "hasAnalytics" BOOLEAN,
    "hasFavicon" BOOLEAN,
    "hasLogo" BOOLEAN,
    "hasSitemap" BOOLEAN,
    "hasRobots" BOOLEAN,
    "hasStructuredData" BOOLEAN,
    "socialLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discoveredPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discoveredEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsitePage" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "title" TEXT,
    "metaDescription" TEXT,
    "h1" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "h2" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canonical" TEXT,
    "wordCount" INTEGER,
    "bytes" INTEGER,
    "responseMs" INTEGER,
    "hasForm" BOOLEAN NOT NULL DEFAULT false,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "imagesWithoutAlt" INTEGER NOT NULL DEFAULT 0,
    "internalLinks" INTEGER NOT NULL DEFAULT 0,
    "externalLinks" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsitePage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialSignal" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT,
    "url" TEXT NOT NULL,
    "followers" INTEGER,
    "postCount" INTEGER,
    "lastPostAt" TIMESTAMP(3),
    "isActive" BOOLEAN,
    "confidence" "Confidence" NOT NULL DEFAULT 'FACT',
    "source" TEXT,
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSignal" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" BOOLEAN NOT NULL,
    "weightHint" INTEGER,
    "evidence" TEXT,
    "confidence" "Confidence" NOT NULL DEFAULT 'CALCULATED',
    "origin" "DataOrigin" NOT NULL DEFAULT 'PUBLIC_BUSINESS_RESEARCH',
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScore" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "temperature" "LeadTemperature" NOT NULL,
    "breakdown" JSONB NOT NULL,
    "configHash" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAnalysis" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "businessSummary" TEXT,
    "likelyCustomerProfile" TEXT,
    "mainDigitalProblems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "businessOpportunities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedService" TEXT,
    "secondaryServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salesAngle" TEXT,
    "whyContact" TEXT,
    "recommendedOpening" TEXT,
    "recommendedQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "likelyObjections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objectionStrategy" TEXT,
    "recommendedNextStep" TEXT,
    "inputSnapshot" JSONB,
    "rawOutput" JSONB,
    "inputHash" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesBrief" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL DEFAULT 'RULES',
    "content" JSONB NOT NULL,
    "aiAnalysisId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "descriptionFa" TEXT,
    "basePriority" INTEGER NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rules" JSONB NOT NULL,
    "salesAngles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commonObjections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objectionResponses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discoveryQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "marketBoost" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "phone" TEXT,
    "outcome" "CallOutcome" NOT NULL,
    "durationSeconds" INTEGER,
    "notes" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "normalizedKeyword" TEXT NOT NULL,
    "language" TEXT DEFAULT 'fa',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordSignal" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "source" "KeywordSource" NOT NULL,
    "sourceUrl" TEXT,
    "origin" "DataOrigin" NOT NULL DEFAULT 'AGGREGATE_SEARCH_SIGNAL',
    "confidence" "Confidence" NOT NULL DEFAULT 'FACT',
    "city" TEXT,
    "province" TEXT,
    "country" TEXT DEFAULT 'IR',
    "searchVolume" INTEGER,
    "competition" TEXT,
    "competitionIndex" INTEGER,
    "trend" TEXT,
    "clicks" INTEGER,
    "impressions" INTEGER,
    "conversions" DOUBLE PRECISION,
    "costMicros" BIGINT,
    "ctr" DOUBLE PRECISION,
    "averagePosition" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordTrend" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "direction" TEXT,
    "source" "KeywordSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordTrend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordLocation" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IR',

    CONSTRAINT "KeywordLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordService" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "KeywordService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchTerm" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "normalizedTerm" TEXT NOT NULL,
    "source" "KeywordSource" NOT NULL,
    "origin" "DataOrigin" NOT NULL DEFAULT 'ADVERTISING_CAMPAIGN',
    "campaignName" TEXT,
    "adGroupName" TEXT,
    "matchType" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT DEFAULT 'IR',
    "clicks" INTEGER,
    "impressions" INTEGER,
    "conversions" DOUBLE PRECISION,
    "costMicros" BIGINT,
    "ctr" DOUBLE PRECISION,
    "averagePosition" DOUBLE PRECISION,
    "averageCpcMicros" BIGINT,
    "date" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "serviceKey" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSignal" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT,
    "serviceKey" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IR',
    "strength" "MarketSignalStrength" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "score" DOUBLE PRECISION,
    "basis" TEXT NOT NULL,
    "confidence" "Confidence" NOT NULL DEFAULT 'CALCULATED',
    "sources" "KeywordSource"[] DEFAULT ARRAY[]::"KeywordSource"[],
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "totalClicks" INTEGER,
    "totalImpressions" INTEGER,
    "totalConversions" DOUBLE PRECISION,
    "totalCostMicros" BIGINT,
    "averageVolume" DOUBLE PRECISION,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "state" "ProviderState" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "config" JSONB,
    "secrets" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "rateLimitPerMinute" INTEGER,
    "rateLimitPerHour" INTEGER,
    "rateLimitPerDay" INTEGER,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderUsage" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "providerKey" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bytesFetched" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "leadId" TEXT,
    "event" "NotificationEvent" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "mergedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "columnMapping" JSONB,
    "errors" JSONB,
    "createdById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLog" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobId" TEXT,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Lead_normalizedPhone_idx" ON "Lead"("normalizedPhone");

-- CreateIndex
CREATE INDEX "Lead_websiteDomain_idx" ON "Lead"("websiteDomain");

-- CreateIndex
CREATE INDEX "Lead_nameKey_idx" ON "Lead"("nameKey");

-- CreateIndex
CREATE INDEX "Lead_city_idx" ON "Lead"("city");

-- CreateIndex
CREATE INDEX "Lead_province_idx" ON "Lead"("province");

-- CreateIndex
CREATE INDEX "Lead_category_idx" ON "Lead"("category");

-- CreateIndex
CREATE INDEX "Lead_leadScore_idx" ON "Lead"("leadScore");

-- CreateIndex
CREATE INDEX "Lead_leadTemperature_idx" ON "Lead"("leadTemperature");

-- CreateIndex
CREATE INDEX "Lead_contactStatus_idx" ON "Lead"("contactStatus");

-- CreateIndex
CREATE INDEX "Lead_assignedToId_idx" ON "Lead"("assignedToId");

-- CreateIndex
CREATE INDEX "Lead_campaignId_idx" ON "Lead"("campaignId");

-- CreateIndex
CREATE INDEX "Lead_nextFollowUpAt_idx" ON "Lead"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "Lead_websiteStatus_idx" ON "Lead"("websiteStatus");

-- CreateIndex
CREATE INDEX "Lead_isDemo_idx" ON "Lead"("isDemo");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_key_key" ON "LeadSource"("key");

-- CreateIndex
CREATE INDEX "LeadSourceReference_leadId_idx" ON "LeadSourceReference"("leadId");

-- CreateIndex
CREATE INDEX "LeadSourceReference_providerKey_idx" ON "LeadSourceReference"("providerKey");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceReference_providerKey_externalId_leadId_key" ON "LeadSourceReference"("providerKey", "externalId", "leadId");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_createdById_idx" ON "Campaign"("createdById");

-- CreateIndex
CREATE INDEX "CampaignRun_campaignId_idx" ON "CampaignRun"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignRun_status_idx" ON "CampaignRun"("status");

-- CreateIndex
CREATE INDEX "WebsiteAudit_leadId_idx" ON "WebsiteAudit"("leadId");

-- CreateIndex
CREATE INDEX "WebsiteAudit_createdAt_idx" ON "WebsiteAudit"("createdAt");

-- CreateIndex
CREATE INDEX "WebsitePage_auditId_idx" ON "WebsitePage"("auditId");

-- CreateIndex
CREATE INDEX "SocialSignal_leadId_idx" ON "SocialSignal"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialSignal_leadId_platform_url_key" ON "SocialSignal"("leadId", "platform", "url");

-- CreateIndex
CREATE INDEX "BusinessSignal_leadId_idx" ON "BusinessSignal"("leadId");

-- CreateIndex
CREATE INDEX "BusinessSignal_key_idx" ON "BusinessSignal"("key");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSignal_leadId_key_key" ON "BusinessSignal"("leadId", "key");

-- CreateIndex
CREATE INDEX "LeadScore_leadId_idx" ON "LeadScore"("leadId");

-- CreateIndex
CREATE INDEX "LeadScore_createdAt_idx" ON "LeadScore"("createdAt");

-- CreateIndex
CREATE INDEX "AIAnalysis_leadId_idx" ON "AIAnalysis"("leadId");

-- CreateIndex
CREATE INDEX "AIAnalysis_inputHash_idx" ON "AIAnalysis"("inputHash");

-- CreateIndex
CREATE INDEX "AIAnalysis_createdAt_idx" ON "AIAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "SalesBrief_leadId_idx" ON "SalesBrief"("leadId");

-- CreateIndex
CREATE INDEX "SalesBrief_isCurrent_idx" ON "SalesBrief"("isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "Service_key_key" ON "Service"("key");

-- CreateIndex
CREATE INDEX "Opportunity_leadId_idx" ON "Opportunity"("leadId");

-- CreateIndex
CREATE INDEX "Opportunity_serviceKey_idx" ON "Opportunity"("serviceKey");

-- CreateIndex
CREATE INDEX "Opportunity_score_idx" ON "Opportunity"("score");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_leadId_serviceId_key" ON "Opportunity"("leadId", "serviceId");

-- CreateIndex
CREATE INDEX "SalesActivity_leadId_idx" ON "SalesActivity"("leadId");

-- CreateIndex
CREATE INDEX "SalesActivity_userId_idx" ON "SalesActivity"("userId");

-- CreateIndex
CREATE INDEX "SalesActivity_createdAt_idx" ON "SalesActivity"("createdAt");

-- CreateIndex
CREATE INDEX "Call_leadId_idx" ON "Call"("leadId");

-- CreateIndex
CREATE INDEX "Call_createdAt_idx" ON "Call"("createdAt");

-- CreateIndex
CREATE INDEX "Note_leadId_idx" ON "Note"("leadId");

-- CreateIndex
CREATE INDEX "Task_leadId_idx" ON "Task"("leadId");

-- CreateIndex
CREATE INDEX "Task_assignedToId_idx" ON "Task"("assignedToId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_leadId_idx" ON "FollowUp"("leadId");

-- CreateIndex
CREATE INDEX "FollowUp_dueAt_idx" ON "FollowUp"("dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_completedAt_idx" ON "FollowUp"("completedAt");

-- CreateIndex
CREATE INDEX "Keyword_normalizedKeyword_idx" ON "Keyword"("normalizedKeyword");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_normalizedKeyword_language_key" ON "Keyword"("normalizedKeyword", "language");

-- CreateIndex
CREATE INDEX "KeywordSignal_keywordId_idx" ON "KeywordSignal"("keywordId");

-- CreateIndex
CREATE INDEX "KeywordSignal_source_idx" ON "KeywordSignal"("source");

-- CreateIndex
CREATE INDEX "KeywordSignal_city_idx" ON "KeywordSignal"("city");

-- CreateIndex
CREATE INDEX "KeywordSignal_date_idx" ON "KeywordSignal"("date");

-- CreateIndex
CREATE INDEX "KeywordTrend_keywordId_idx" ON "KeywordTrend"("keywordId");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordTrend_keywordId_period_source_key" ON "KeywordTrend"("keywordId", "period", "source");

-- CreateIndex
CREATE INDEX "KeywordLocation_city_idx" ON "KeywordLocation"("city");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordLocation_keywordId_city_province_country_key" ON "KeywordLocation"("keywordId", "city", "province", "country");

-- CreateIndex
CREATE INDEX "KeywordService_serviceKey_idx" ON "KeywordService"("serviceKey");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordService_keywordId_serviceId_key" ON "KeywordService"("keywordId", "serviceId");

-- CreateIndex
CREATE INDEX "SearchTerm_normalizedTerm_idx" ON "SearchTerm"("normalizedTerm");

-- CreateIndex
CREATE INDEX "SearchTerm_source_idx" ON "SearchTerm"("source");

-- CreateIndex
CREATE INDEX "SearchTerm_date_idx" ON "SearchTerm"("date");

-- CreateIndex
CREATE INDEX "SearchTerm_serviceKey_idx" ON "SearchTerm"("serviceKey");

-- CreateIndex
CREATE INDEX "SearchTerm_city_idx" ON "SearchTerm"("city");

-- CreateIndex
CREATE INDEX "MarketSignal_serviceKey_idx" ON "MarketSignal"("serviceKey");

-- CreateIndex
CREATE INDEX "MarketSignal_city_idx" ON "MarketSignal"("city");

-- CreateIndex
CREATE INDEX "MarketSignal_strength_idx" ON "MarketSignal"("strength");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSignal_serviceKey_city_periodStart_periodEnd_key" ON "MarketSignal"("serviceKey", "city", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_key_key" ON "Provider"("key");

-- CreateIndex
CREATE INDEX "Provider_kind_idx" ON "Provider"("kind");

-- CreateIndex
CREATE INDEX "Provider_enabled_idx" ON "Provider"("enabled");

-- CreateIndex
CREATE INDEX "ProviderUsage_day_idx" ON "ProviderUsage"("day");

-- CreateIndex
CREATE INDEX "ProviderUsage_kind_idx" ON "ProviderUsage"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderUsage_providerKey_day_key" ON "ProviderUsage"("providerKey", "day");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE INDEX "Notification_event_idx" ON "Notification"("event");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_createdById_idx" ON "ImportBatch"("createdById");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "JobLog_jobName_idx" ON "JobLog"("jobName");

-- CreateIndex
CREATE INDEX "JobLog_status_idx" ON "JobLog"("status");

-- CreateIndex
CREATE INDEX "JobLog_startedAt_idx" ON "JobLog"("startedAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceReference" ADD CONSTRAINT "LeadSourceReference_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceReference" ADD CONSTRAINT "LeadSourceReference_leadSourceId_fkey" FOREIGN KEY ("leadSourceId") REFERENCES "LeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRun" ADD CONSTRAINT "CampaignRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAudit" ADD CONSTRAINT "WebsiteAudit_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsitePage" ADD CONSTRAINT "WebsitePage_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialSignal" ADD CONSTRAINT "SocialSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSignal" ADD CONSTRAINT "BusinessSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesBrief" ADD CONSTRAINT "SalesBrief_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordSignal" ADD CONSTRAINT "KeywordSignal_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordTrend" ADD CONSTRAINT "KeywordTrend_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordLocation" ADD CONSTRAINT "KeywordLocation_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordService" ADD CONSTRAINT "KeywordService_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordService" ADD CONSTRAINT "KeywordService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsage" ADD CONSTRAINT "ProviderUsage_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
