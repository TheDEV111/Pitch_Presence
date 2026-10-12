BEGIN;
-- User IDs remain membership IDs: historical foreign keys and team boundaries are unchanged.
CREATE TABLE "Account" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE,
 "passwordHash" TEXT, "pinHash" TEXT, "isVerified" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
INSERT INTO "Account" (id,email,"passwordHash","pinHash","isVerified","createdAt")
 SELECT id,email,"passwordHash","pinHash","isVerified","createdAt" FROM "User";
ALTER TABLE "User" ADD COLUMN "accountId" UUID;
UPDATE "User" SET "accountId"=id;
ALTER TABLE "User" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT user_account_fk FOREIGN KEY ("accountId") REFERENCES "Account" (id);
DROP INDEX "User_email_key";
CREATE INDEX "User_email_idx" ON "User" (email);
CREATE UNIQUE INDEX "User_accountId_teamId_key" ON "User" ("accountId","teamId");
CREATE UNIQUE INDEX one_pending_membership ON "User" ("accountId") WHERE "teamId" IS NULL;
ALTER TABLE "DeviceSession" ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'PIN';
UPDATE "DeviceSession" s SET "authMethod"='PASSWORD' FROM "User" u WHERE u.id=s."userId" AND u.role='MANAGER';
ALTER TABLE "DeviceSession" ADD CONSTRAINT session_auth_method CHECK ("authMethod" IN ('PIN','PASSWORD'));
-- Compatibility for existing creation paths/fixtures; identity is still unique, memberships are not.
-- Mirrored role-specific hashes keep old service interfaces usable during the transition.
CREATE FUNCTION bind_membership_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_id UUID;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."accountId" IS NULL THEN
   INSERT INTO "Account" (email,"passwordHash","pinHash","isVerified")
    VALUES (NEW.email,NEW."passwordHash",NEW."pinHash",NEW."isVerified")
    ON CONFLICT (email) DO NOTHING;
   SELECT id INTO identity_id FROM "Account" WHERE email=NEW.email;
   NEW."accountId" := identity_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Account" WHERE id=NEW."accountId" AND email=NEW.email) THEN
   RAISE EXCEPTION 'Membership identity mismatch' USING ERRCODE='23514';
  END IF;
  UPDATE "Account" SET "passwordHash"=COALESCE("passwordHash",NEW."passwordHash"),
   "pinHash"=COALESCE("pinHash",NEW."pinHash"), "isVerified"=("isVerified" OR NEW."isVerified")
   WHERE id=NEW."accountId";
 ELSE
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId" OR NEW.email IS DISTINCT FROM OLD.email THEN
   RAISE EXCEPTION 'Membership identity cannot be reassigned' USING ERRCODE='23514';
  END IF;
  IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" AND NEW."passwordHash" IS NOT NULL THEN
   UPDATE "Account" SET "passwordHash"=NEW."passwordHash" WHERE id=NEW."accountId";
  END IF;
  IF NEW."pinHash" IS DISTINCT FROM OLD."pinHash" AND NEW."pinHash" IS NOT NULL THEN
   UPDATE "Account" SET "pinHash"=NEW."pinHash" WHERE id=NEW."accountId";
  END IF;
  IF NEW."isVerified" IS DISTINCT FROM OLD."isVerified" THEN
   UPDATE "Account" SET "isVerified"=NEW."isVerified" WHERE id=NEW."accountId";
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bind_membership_identity BEFORE INSERT OR UPDATE ON "User"
 FOR EACH ROW EXECUTE FUNCTION bind_membership_identity();

COMMIT;
