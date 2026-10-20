ALTER TABLE "DeviceSession" ADD COLUMN "deviceLabel" VARCHAR(80);
CREATE INDEX "DeviceSession_expiresAt_idx" ON "DeviceSession" ("expiresAt");
