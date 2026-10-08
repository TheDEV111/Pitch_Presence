-- Subscriptions belong to a verified staff session and its team.
CREATE UNIQUE INDEX "DeviceSession_id_userId_key" ON "DeviceSession" ("id", "userId");
CREATE TABLE "PushSubscription" (
  "id" uuid NOT NULL PRIMARY KEY,
  "teamId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "sessionId" uuid NOT NULL,
  "endpointHash" text NOT NULL,
  "encryptedSubscription" text NOT NULL,
  "vapidPublicKey" text NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_user_fkey" FOREIGN KEY ("teamId", "userId") REFERENCES "User" ("teamId", "id") ON DELETE CASCADE,
  CONSTRAINT "PushSubscription_session_fkey" FOREIGN KEY ("sessionId", "userId") REFERENCES "DeviceSession" ("id", "userId") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_sessionId_key" ON "PushSubscription" ("sessionId");
CREATE UNIQUE INDEX "PushSubscription_sessionId_userId_key" ON "PushSubscription" ("sessionId", "userId");
CREATE UNIQUE INDEX "PushSubscription_endpointHash_key" ON "PushSubscription" ("endpointHash");
CREATE INDEX "PushSubscription_teamId_idx" ON "PushSubscription" ("teamId");
