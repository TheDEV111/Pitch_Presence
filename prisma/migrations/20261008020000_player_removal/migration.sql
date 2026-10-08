-- Keep the former team ID for historical payment/attendance foreign keys.
-- A removal is a terminal membership state, separate from temporary deactivation.
ALTER TABLE "User" ADD COLUMN "removedAt" timestamptz(3);
ALTER TABLE "User" ADD CONSTRAINT "User_removed_player_inactive" CHECK (
  "removedAt" IS NULL OR (role = 'PLAYER' AND active = false)
);
