-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "RuleTrigger" AS ENUM ('COMMENT', 'DM');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('ANY', 'KEYWORD');

-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('IMAGE', 'REELS', 'STORY', 'CAROUSEL');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgAccount" (
    "id" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "accountType" TEXT,
    "profilePictureUrl" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "tokenRefreshedAt" TIMESTAMP(3) NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "dailyActionLimit" INTEGER NOT NULL DEFAULT 500,
    "webhooksSubscribed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "RuleTrigger" NOT NULL,
    "matchType" "MatchType" NOT NULL DEFAULT 'KEYWORD',
    "keywords" TEXT[],
    "mediaId" TEXT,
    "replyTemplates" TEXT[],
    "privateReplyTemplates" TEXT[],
    "hideComment" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledPost" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "PostType" NOT NULL,
    "mediaUrls" TEXT[],
    "caption" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'PENDING',
    "igMediaId" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "text" TEXT,
    "mid" TEXT,
    "ruleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "IgAccount_igUserId_key" ON "IgAccount"("igUserId");

-- CreateIndex
CREATE INDEX "AutomationRule_accountId_trigger_enabled_idx" ON "AutomationRule"("accountId", "trigger", "enabled");

-- CreateIndex
CREATE INDEX "ScheduledPost_status_scheduledAt_idx" ON "ScheduledPost"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ScheduledPost_accountId_scheduledAt_idx" ON "ScheduledPost"("accountId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "DmMessage_mid_key" ON "DmMessage"("mid");

-- CreateIndex
CREATE INDEX "DmMessage_accountId_igsid_createdAt_idx" ON "DmMessage"("accountId", "igsid", "createdAt");

-- CreateIndex
CREATE INDEX "DmMessage_accountId_createdAt_idx" ON "DmMessage"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_accountId_createdAt_idx" ON "ActivityLog"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_dedupeKey_key" ON "WebhookEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "IgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "IgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmMessage" ADD CONSTRAINT "DmMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "IgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "IgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
