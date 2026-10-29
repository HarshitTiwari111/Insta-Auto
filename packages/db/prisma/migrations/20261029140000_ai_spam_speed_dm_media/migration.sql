-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "replyMediaUrl" TEXT;

-- AlterTable
ALTER TABLE "IgAccount" ADD COLUMN     "aiSpamFilter" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replySpeed" TEXT NOT NULL DEFAULT 'fast';
