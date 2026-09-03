-- CreateIndex
CREATE INDEX IF NOT EXISTS "Stop_lat_lon_idx" ON "Stop"("lat", "lon");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Stop_locationType_idx" ON "Stop"("locationType");
