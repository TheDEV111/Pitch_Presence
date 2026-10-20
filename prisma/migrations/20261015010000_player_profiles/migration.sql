ALTER TABLE "User" ADD COLUMN "shirtNumber" INTEGER CHECK ("shirtNumber" BETWEEN 0 AND 99), ADD COLUMN "assignedPosition" TEXT;
CREATE TABLE "PlayerProfile" (
  "accountId" UUID PRIMARY KEY REFERENCES "Account"(id) ON DELETE CASCADE,
  "preferredFoot" TEXT CHECK ("preferredFoot" IN ('LEFT','RIGHT','BOTH')),
  "primaryPosition" TEXT,
  "secondaryPositions" TEXT[] NOT NULL DEFAULT '{}',
  photo BYTEA CHECK (octet_length(photo) <= 262144),
  "photoVersion" UUID
);
