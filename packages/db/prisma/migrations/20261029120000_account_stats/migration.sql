-- CreateTable
CREATE TABLE "AccountStat" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "followers" INTEGER NOT NULL,
    "follows" INTEGER,
    "mediaCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountStat_accountId_day_key" ON "AccountStat"("accountId", "day");

-- AddForeignKey
ALTER TABLE "AccountStat" ADD CONSTRAINT "AccountStat_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "IgAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
