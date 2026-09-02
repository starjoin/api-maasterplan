-- CreateTable
CREATE TABLE "DatasetMeta" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "lastImport" DATETIME,
    "rfuVersion" TEXT,
    "rfuUpdatedAt" TEXT,
    "stats" TEXT
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "triggeredBy" TEXT NOT NULL DEFAULT 'manual',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    "stats" TEXT,
    "logs" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "timezone" TEXT,
    "lang" TEXT,
    "phone" TEXT,
    "email" TEXT
);

-- CreateTable
CREATE TABLE "Stop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stopId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "desc" TEXT,
    "lat" REAL,
    "lon" REAL,
    "zoneId" TEXT,
    "url" TEXT,
    "locationType" INTEGER,
    "parentStation" TEXT,
    "wheelchairBoarding" INTEGER
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "agencyId" TEXT,
    "shortName" TEXT,
    "longName" TEXT,
    "desc" TEXT,
    "type" INTEGER NOT NULL,
    "url" TEXT,
    "color" TEXT,
    "textColor" TEXT,
    "sortOrder" INTEGER
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "headsign" TEXT,
    "shortName" TEXT,
    "directionId" INTEGER,
    "blockId" TEXT,
    "shapeId" TEXT,
    "wheelchairAccessible" INTEGER,
    "bikesAllowed" INTEGER
);

-- CreateTable
CREATE TABLE "StopTime" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "arrivalTime" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "stopSequence" INTEGER NOT NULL,
    "headsign" TEXT,
    "pickupType" INTEGER,
    "dropOffType" INTEGER,
    "shapeDistTraveled" REAL,
    "timepoint" INTEGER
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "monday" BOOLEAN NOT NULL,
    "tuesday" BOOLEAN NOT NULL,
    "wednesday" BOOLEAN NOT NULL,
    "thursday" BOOLEAN NOT NULL,
    "friday" BOOLEAN NOT NULL,
    "saturday" BOOLEAN NOT NULL,
    "sunday" BOOLEAN NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "CalendarDate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "exceptionType" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Shape" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shapeId" TEXT NOT NULL,
    "ptLat" REAL NOT NULL,
    "ptLon" REAL NOT NULL,
    "ptSequence" INTEGER NOT NULL,
    "distTraveled" REAL
);

-- CreateTable
CREATE TABLE "ApiEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "responseSchema" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ApiParam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpointId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'string',
    "location" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "defaultValue" TEXT,
    CONSTRAINT "ApiParam_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ApiEndpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_agencyId_key" ON "Agency"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "Stop_stopId_key" ON "Stop"("stopId");

-- CreateIndex
CREATE INDEX "Stop_name_idx" ON "Stop"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Route_routeId_key" ON "Route"("routeId");

-- CreateIndex
CREATE INDEX "Route_shortName_idx" ON "Route"("shortName");

-- CreateIndex
CREATE INDEX "Route_type_idx" ON "Route"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_tripId_key" ON "Trip"("tripId");

-- CreateIndex
CREATE INDEX "Trip_routeId_idx" ON "Trip"("routeId");

-- CreateIndex
CREATE INDEX "Trip_serviceId_idx" ON "Trip"("serviceId");

-- CreateIndex
CREATE INDEX "StopTime_tripId_idx" ON "StopTime"("tripId");

-- CreateIndex
CREATE INDEX "StopTime_stopId_idx" ON "StopTime"("stopId");

-- CreateIndex
CREATE UNIQUE INDEX "Calendar_serviceId_key" ON "Calendar"("serviceId");

-- CreateIndex
CREATE INDEX "CalendarDate_serviceId_date_idx" ON "CalendarDate"("serviceId", "date");

-- CreateIndex
CREATE INDEX "Shape_shapeId_idx" ON "Shape"("shapeId");

-- CreateIndex
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

-- CreateIndex
CREATE INDEX "ImportJob_createdAt_idx" ON "ImportJob"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiEndpoint_path_method_key" ON "ApiEndpoint"("path", "method");
