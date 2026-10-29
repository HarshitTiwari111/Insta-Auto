-- AlterTable
ALTER TABLE "IgAccount" ADD COLUMN     "blocklist" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "blocklistHide" BOOLEAN NOT NULL DEFAULT false;
