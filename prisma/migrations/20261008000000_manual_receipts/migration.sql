CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "Team" ADD COLUMN "transferAccountId" UUID;
CREATE UNIQUE INDEX "Team_transferAccountId_key" ON "Team"("transferAccountId");
CREATE TABLE "TeamTransferAccount" (
  id UUID PRIMARY KEY, "teamId" UUID NOT NULL, "bankName" TEXT NOT NULL,
  "accountName" TEXT NOT NULL, "encryptedNumber" TEXT NOT NULL, "accountLast4" TEXT NOT NULL,
  "configuredBy" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("teamId", id),
  FOREIGN KEY ("teamId") REFERENCES "Team"(id),
  FOREIGN KEY ("teamId", "configuredBy") REFERENCES "User"("teamId", id),
  CHECK ("accountLast4" ~ '^[0-9]{4}$')
);
ALTER TABLE "Team" ADD CONSTRAINT team_transfer_account_fk FOREIGN KEY (id,"transferAccountId") REFERENCES "TeamTransferAccount"("teamId",id);
CREATE TABLE "BankAccountChange" (
  id UUID PRIMARY KEY, "teamId" UUID NOT NULL, "requestedBy" UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('SET','REMOVE')), "previousAccountId" UUID,
  "bankName" TEXT, "accountName" TEXT, "accountLast4" TEXT, "encryptedNumber" TEXT,
  "otpHash" TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL, "consumedAt" TIMESTAMPTZ(3), "appliedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("teamId") REFERENCES "Team"(id),
  FOREIGN KEY ("teamId","requestedBy") REFERENCES "User"("teamId",id),
  FOREIGN KEY ("teamId","previousAccountId") REFERENCES "TeamTransferAccount"("teamId",id),
  CHECK (action='REMOVE' OR ("bankName" IS NOT NULL AND "accountName" IS NOT NULL AND "accountLast4" IS NOT NULL AND "encryptedNumber" IS NOT NULL)),
  CHECK (attempts BETWEEN 0 AND 5)
);
CREATE INDEX "BankAccountChange_teamId_createdAt_idx" ON "BankAccountChange"("teamId","createdAt");
CREATE UNIQUE INDEX one_pending_bank_change ON "BankAccountChange"("teamId") WHERE "consumedAt" IS NULL;
CREATE TABLE "PaymentReceipt" (
  id UUID PRIMARY KEY, "teamId" UUID NOT NULL, "playerId" UUID NOT NULL,
  "monthlyDuesId" UUID NOT NULL, "accountId" UUID NOT NULL, "paymentId" UUID NOT NULL UNIQUE,
  "fileName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, size INTEGER NOT NULL,
  content BYTEA, sha256 TEXT NOT NULL, status "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
  reason TEXT, "reviewedBy" UUID, "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("teamId") REFERENCES "Team"(id),
  FOREIGN KEY ("teamId","playerId") REFERENCES "User"("teamId",id),
  FOREIGN KEY ("teamId","monthlyDuesId","paymentId") REFERENCES "Payment"("teamId","monthlyDuesId",id),
  FOREIGN KEY ("teamId","accountId") REFERENCES "TeamTransferAccount"("teamId",id),
  FOREIGN KEY ("teamId","reviewedBy") REFERENCES "User"("teamId",id),
  CHECK (size > 0 AND size <= 2097152),
  CHECK (content IS NULL OR octet_length(content)=size),
  CHECK ("mimeType" IN ('application/pdf','image/png')),
  CHECK ((status='PENDING' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL) OR (status!='PENDING' AND "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL)),
  CHECK (status!='REJECTED' OR length(reason)>=5)
);
CREATE INDEX "PaymentReceipt_teamId_playerId_idx" ON "PaymentReceipt"("teamId","playerId");
CREATE INDEX "PaymentReceipt_monthlyDuesId_status_idx" ON "PaymentReceipt"("monthlyDuesId",status);
CREATE UNIQUE INDEX "PaymentReceipt_teamId_sha256_key" ON "PaymentReceipt"("teamId",sha256);
CREATE UNIQUE INDEX one_pending_receipt_per_month ON "PaymentReceipt"("monthlyDuesId") WHERE status='PENDING';
CREATE FUNCTION preserve_transfer_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Bank account versions are immutable'; END $$;
CREATE TRIGGER transfer_account_immutable BEFORE UPDATE ON "TeamTransferAccount" FOR EACH ROW EXECUTE FUNCTION preserve_transfer_account();
CREATE FUNCTION preserve_receipt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(OLD."teamId",OLD."playerId",OLD."monthlyDuesId",OLD."accountId",OLD."paymentId",OLD."fileName",OLD."mimeType",OLD.size,OLD.sha256,OLD."createdAt") IS DISTINCT FROM ROW(NEW."teamId",NEW."playerId",NEW."monthlyDuesId",NEW."accountId",NEW."paymentId",NEW."fileName",NEW."mimeType",NEW.size,NEW.sha256,NEW."createdAt") OR (NEW.content IS NOT NULL AND NEW.content IS DISTINCT FROM OLD.content) THEN RAISE EXCEPTION 'Receipt snapshot is immutable'; END IF;
 IF OLD.status!='PENDING' AND ROW(OLD.status,OLD.reason,OLD."reviewedBy",OLD."reviewedAt") IS DISTINCT FROM ROW(NEW.status,NEW.reason,NEW."reviewedBy",NEW."reviewedAt") THEN RAISE EXCEPTION 'Receipt review is final'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER receipt_snapshot_immutable BEFORE UPDATE ON "PaymentReceipt" FOR EACH ROW EXECUTE FUNCTION preserve_receipt_snapshot();
-- Submitted proofs are external payments awaiting a staff decision.
ALTER TABLE "Payment" DROP CONSTRAINT payment_provider_consistent;
ALTER TABLE "Payment" ADD CONSTRAINT payment_provider_consistent CHECK (
 (provider='PAYSTACK' AND "providerReference" IS NOT NULL AND "markedBy" IS NULL) OR
 (provider='EXTERNAL' AND "providerReference" IS NULL AND
   ((status='PENDING' AND "markedBy" IS NULL) OR (status IN ('SUCCESS','FAILED') AND "markedBy" IS NOT NULL)))
);
CREATE UNIQUE INDEX payment_player_identity ON "Payment"("teamId","playerId",id);
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT receipt_payment_player_fk FOREIGN KEY ("teamId","playerId","paymentId") REFERENCES "Payment"("teamId","playerId",id);
