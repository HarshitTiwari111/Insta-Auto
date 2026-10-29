-- CreateTable
CREATE TABLE "DmFlow" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT[],
    "steps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DmFlow_accountId_enabled_idx" ON "DmFlow"("accountId", "enabled");

-- AddForeignKey
ALTER TABLE "DmFlow" ADD CONSTRAINT "DmFlow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "IgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
