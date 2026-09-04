-- AlterTable
ALTER TABLE "DatasetMeta" ADD COLUMN "format" TEXT;

-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'gtfs';

-- CreateIndex
CREATE INDEX "ImportJob_source_idx" ON "ImportJob"("source");

-- AlterTable
ALTER TABLE "Stop" ADD COLUMN "extras" TEXT;

-- AlterTable
ALTER TABLE "Route" ADD COLUMN "extras" TEXT;
