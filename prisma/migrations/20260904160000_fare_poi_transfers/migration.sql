-- CreateTable
CREATE TABLE "FareZone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zoneId" TEXT NOT NULL,
    "name" TEXT,
    "extras" TEXT
);

-- CreateTable
CREATE TABLE "FareAttribute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fareId" TEXT NOT NULL,
    "price" REAL,
    "currencyType" TEXT,
    "paymentMethod" INTEGER,
    "transfers" INTEGER,
    "transferDuration" INTEGER,
    "extras" TEXT
);

-- CreateTable
CREATE TABLE "FareRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fareId" TEXT NOT NULL,
    "routeId" TEXT,
    "originId" TEXT,
    "destinationId" TEXT,
    "containsId" TEXT
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromStopId" TEXT NOT NULL,
    "toStopId" TEXT NOT NULL,
    "transferType" INTEGER NOT NULL,
    "minTransferTime" INTEGER
);

-- CreateIndex
CREATE UNIQUE INDEX "FareZone_zoneId_key" ON "FareZone"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "FareAttribute_fareId_key" ON "FareAttribute"("fareId");

-- CreateIndex
CREATE INDEX "FareRule_fareId_idx" ON "FareRule"("fareId");

-- CreateIndex
CREATE INDEX "FareRule_routeId_idx" ON "FareRule"("routeId");

-- CreateIndex
CREATE INDEX "Transfer_fromStopId_idx" ON "Transfer"("fromStopId");

-- CreateIndex
CREATE INDEX "Transfer_toStopId_idx" ON "Transfer"("toStopId");
