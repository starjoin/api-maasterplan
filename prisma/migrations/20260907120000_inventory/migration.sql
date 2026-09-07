CREATE TABLE "SourceRecord" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "file" TEXT NOT NULL, "kind" TEXT NOT NULL, "entityId" TEXT, "data" TEXT NOT NULL);
CREATE INDEX "SourceRecord_kind_id_idx" ON "SourceRecord"("kind", "id");
CREATE INDEX "SourceRecord_kind_entityId_idx" ON "SourceRecord"("kind", "entityId");
CREATE TABLE "SourceFile" ("name" TEXT NOT NULL PRIMARY KEY, "bytes" BIGINT NOT NULL, "sha256" TEXT NOT NULL, "records" INTEGER NOT NULL, "fields" TEXT NOT NULL);
CREATE TABLE "SourceKind" ("kind" TEXT NOT NULL PRIMARY KEY, "count" INTEGER NOT NULL, "fields" TEXT NOT NULL);
CREATE TABLE "NetexReference" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL);
CREATE INDEX "StopTime_tripId_stopSequence_idx" ON "StopTime"("tripId", "stopSequence");
CREATE INDEX "StopTime_stopId_tripId_idx" ON "StopTime"("stopId", "tripId");
CREATE INDEX "Shape_shapeId_ptSequence_idx" ON "Shape"("shapeId", "ptSequence");

ALTER TABLE "Stop" ADD COLUMN "isPoi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Stop" ADD COLUMN "classification" TEXT;
UPDATE "Stop" SET "isPoi" = true, "classification" = "desc" WHERE "extras" LIKE '%"netex_type":"PointOfInterest"%';
CREATE INDEX "Stop_isPoi_classification_idx" ON "Stop"("isPoi", "classification");
CREATE TABLE "LineSummary" ("routeId" TEXT NOT NULL PRIMARY KEY, "openingTime" TEXT, "closingTime" TEXT, "representatives" TEXT NOT NULL);
