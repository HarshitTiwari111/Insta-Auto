-- A rule can target several posts/reels instead of one
ALTER TABLE "AutomationRule" ADD COLUMN "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "AutomationRule" SET "mediaIds" = ARRAY["mediaId"] WHERE "mediaId" IS NOT NULL;
ALTER TABLE "AutomationRule" DROP COLUMN "mediaId";
