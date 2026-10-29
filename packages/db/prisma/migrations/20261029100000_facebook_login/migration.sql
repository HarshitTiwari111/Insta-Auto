-- CreateEnum
CREATE TYPE "AuthType" AS ENUM ('INSTAGRAM', 'FACEBOOK');

-- AlterTable
ALTER TABLE "IgAccount" ADD COLUMN     "authType" "AuthType" NOT NULL DEFAULT 'INSTAGRAM',
ADD COLUMN     "pageId" TEXT;
