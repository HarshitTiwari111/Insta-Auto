-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "deleteComment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quickReplies" TEXT[];

-- AlterTable
ALTER TABLE "IgAccount" ADD COLUMN     "hourlyActionLimit" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN     "workEndHour" INTEGER,
ADD COLUMN     "workStartHour" INTEGER;

-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "firstComment" TEXT;

-- CreateTable
CREATE TABLE "HashtagSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HashtagSet_pkey" PRIMARY KEY ("id")
);
