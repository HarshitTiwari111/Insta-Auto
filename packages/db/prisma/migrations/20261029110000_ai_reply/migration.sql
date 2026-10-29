-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "aiInstructions" TEXT,
ADD COLUMN     "aiReply" BOOLEAN NOT NULL DEFAULT false;
