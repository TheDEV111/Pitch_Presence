-- CreateEnum
CREATE TYPE "PaymentSetupStatus" AS ENUM ('PENDING', 'READY', 'REVIEW');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'PASSWORD_RESET';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "pendingInvitationId" UUID,
ADD COLUMN     "teamId" UUID,
ALTER COLUMN "pinHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "acceptedAt" TIMESTAMPTZ(3),
ADD COLUMN     "acceptedBy" UUID,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "kind" "Role" NOT NULL DEFAULT 'PLAYER',
ADD COLUMN     "teamId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "TrainingSession" ADD COLUMN     "teamId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "SessionParticipant" ADD COLUMN     "teamId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "teamId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "DuesPeriod" DROP CONSTRAINT "DuesPeriod_pkey",
ADD COLUMN     "id" UUID NOT NULL,
ADD COLUMN     "teamId" UUID NOT NULL,
ADD CONSTRAINT "DuesPeriod_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "MonthlyDues" ADD COLUMN     "teamId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paymentProfileId" UUID,
ADD COLUMN     "subaccountCode" TEXT,
ADD COLUMN     "teamId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "teamId" UUID;

-- AlterTable
ALTER TABLE "BackgroundJob" ADD COLUMN     "teamId" UUID;

-- AlterTable
ALTER TABLE "IdempotencyRecord" ADD COLUMN     "teamId" UUID NOT NULL;

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "paymentProfileId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamPaymentProfile" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "subaccountCode" TEXT,
    "status" "PaymentSetupStatus" NOT NULL DEFAULT 'PENDING',
    "configuredBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamPaymentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_paymentProfileId_key" ON "Team"("paymentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamPaymentProfile_subaccountCode_key" ON "TeamPaymentProfile"("subaccountCode");

-- CreateIndex
CREATE UNIQUE INDEX "TeamPaymentProfile_teamId_id_key" ON "TeamPaymentProfile"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_teamId_id_key" ON "User"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSession_teamId_id_key" ON "TrainingSession"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_teamId_id_key" ON "SessionParticipant"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DuesPeriod_teamId_month_key" ON "DuesPeriod"("teamId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyDues_teamId_id_key" ON "MonthlyDues"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_teamId_id_key" ON "Payment"("teamId", "id");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The pre-launch database must be empty; apply after an explicit development reset.
DROP INDEX one_open_session;
CREATE UNIQUE INDEX one_open_session ON "TrainingSession" ("teamId") WHERE status = 'OPEN';
ALTER TABLE "User" ADD CONSTRAINT user_credentials_match_role CHECK (
 (role = 'PLAYER' AND "pinHash" IS NOT NULL AND "passwordHash" IS NULL AND "teamId" IS NOT NULL) OR
 (role = 'MANAGER' AND "passwordHash" IS NOT NULL AND "pinHash" IS NULL)
);
ALTER TABLE "User" ADD CONSTRAINT pending_invitation_fk FOREIGN KEY ("pendingInvitationId") REFERENCES "Invitation" (id);
ALTER TABLE "Team" ADD CONSTRAINT team_creator_fk FOREIGN KEY ("createdBy") REFERENCES "User" (id);
ALTER TABLE "TeamPaymentProfile" ADD CONSTRAINT profile_team_fk FOREIGN KEY ("teamId") REFERENCES "Team" (id);
ALTER TABLE "TeamPaymentProfile" ADD CONSTRAINT profile_actor_fk FOREIGN KEY ("teamId","configuredBy") REFERENCES "User" ("teamId",id);
ALTER TABLE "Team" ADD CONSTRAINT team_profile_fk FOREIGN KEY (id,"paymentProfileId") REFERENCES "TeamPaymentProfile" ("teamId",id);
ALTER TABLE "Invitation" ADD CONSTRAINT invitation_team_fk FOREIGN KEY ("teamId") REFERENCES "Team" (id);
ALTER TABLE "Invitation" ADD CONSTRAINT invitation_actor_fk FOREIGN KEY ("teamId","createdBy") REFERENCES "User" ("teamId",id);
ALTER TABLE "Invitation" ADD CONSTRAINT staff_invitation_fields CHECK (kind='PLAYER' OR email IS NOT NULL);
ALTER TABLE "TrainingSession" ADD CONSTRAINT session_actor_team_fk FOREIGN KEY ("teamId","startedBy") REFERENCES "User" ("teamId",id);
ALTER TABLE "SessionParticipant" ADD CONSTRAINT participant_session_team_fk FOREIGN KEY ("teamId","sessionId") REFERENCES "TrainingSession" ("teamId",id);
ALTER TABLE "SessionParticipant" ADD CONSTRAINT participant_player_team_fk FOREIGN KEY ("teamId","playerId") REFERENCES "User" ("teamId",id);
ALTER TABLE "Attendance" ADD CONSTRAINT attendance_participant_team_fk FOREIGN KEY ("teamId","participantId") REFERENCES "SessionParticipant" ("teamId",id);
ALTER TABLE "Attendance" ADD CONSTRAINT attendance_actor_team_fk FOREIGN KEY ("teamId","recordedBy") REFERENCES "User" ("teamId",id);
ALTER TABLE "DuesPeriod" ADD CONSTRAINT period_team_actor_fk FOREIGN KEY ("teamId","configuredBy") REFERENCES "User" ("teamId",id);
ALTER TABLE "MonthlyDues" ADD CONSTRAINT dues_player_team_fk FOREIGN KEY ("teamId","playerId") REFERENCES "User" ("teamId",id);
ALTER TABLE "Payment" ADD CONSTRAINT payment_dues_team_fk FOREIGN KEY ("teamId","monthlyDuesId") REFERENCES "MonthlyDues" ("teamId",id);
ALTER TABLE "Payment" ADD CONSTRAINT payment_player_team_fk FOREIGN KEY ("teamId","playerId") REFERENCES "User" ("teamId",id);
ALTER TABLE "Payment" ADD CONSTRAINT payment_profile_team_fk FOREIGN KEY ("teamId","paymentProfileId") REFERENCES "TeamPaymentProfile" ("teamId",id);
ALTER TABLE "Payment" ADD CONSTRAINT payment_destination_present CHECK (provider='EXTERNAL' OR ("paymentProfileId" IS NOT NULL AND "subaccountCode" IS NOT NULL));
ALTER TABLE "AuditEvent" ADD CONSTRAINT audit_team_fk FOREIGN KEY ("teamId") REFERENCES "Team" (id);
ALTER TABLE "BackgroundJob" ADD CONSTRAINT job_team_fk FOREIGN KEY ("teamId") REFERENCES "Team" (id);
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT idempotency_payment_team_fk FOREIGN KEY ("teamId","paymentId") REFERENCES "Payment" ("teamId",id);
ALTER TABLE "Payment" ADD CONSTRAINT payment_actor_team_fk FOREIGN KEY ("teamId","markedBy") REFERENCES "User" ("teamId",id);
ALTER TABLE "Payment" ADD CONSTRAINT payment_reversal_team_fk FOREIGN KEY ("teamId","reversedBy") REFERENCES "User" ("teamId",id);
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT idempotency_player_team_fk FOREIGN KEY ("teamId","playerId") REFERENCES "User" ("teamId",id);
ALTER TABLE "Invitation" ADD CONSTRAINT invitation_accepted_team_fk FOREIGN KEY ("teamId","acceptedBy") REFERENCES "User" ("teamId",id);
ALTER TABLE "MonthlyDues" ADD CONSTRAINT dues_qualifying_team_fk FOREIGN KEY ("teamId","qualifyingPaymentId") REFERENCES "Payment" ("teamId",id);
CREATE INDEX team_training_chronology ON "TrainingSession" ("teamId","startedAt" DESC,id DESC);
CREATE INDEX team_audit_chronology ON "AuditEvent" ("teamId","createdAt",id);
CREATE INDEX team_payment_status ON "Payment" ("teamId",status);
CREATE FUNCTION preserve_team_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD."teamId" IS NOT NULL AND NEW."teamId" IS DISTINCT FROM OLD."teamId" THEN RAISE EXCEPTION 'Team membership cannot be transferred'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER user_team_immutable BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION preserve_team_membership();
CREATE FUNCTION preserve_payment_destination() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(OLD."teamId",OLD."paymentProfileId",OLD."subaccountCode",OLD."playerId",OLD."monthlyDuesId",OLD.amount,OLD."minimumAmount",OLD.currency,OLD."providerReference") IS DISTINCT FROM ROW(NEW."teamId",NEW."paymentProfileId",NEW."subaccountCode",NEW."playerId",NEW."monthlyDuesId",NEW.amount,NEW."minimumAmount",NEW.currency,NEW."providerReference") THEN RAISE EXCEPTION 'Payment snapshot is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER payment_snapshot_immutable BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION preserve_payment_destination();
CREATE FUNCTION preserve_ready_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='READY' AND ROW(OLD."teamId",OLD."bankCode",OLD."accountName",OLD."accountLast4",OLD."subaccountCode",OLD.status) IS DISTINCT FROM ROW(NEW."teamId",NEW."bankCode",NEW."accountName",NEW."accountLast4",NEW."subaccountCode",NEW.status) THEN RAISE EXCEPTION 'Ready bank profiles are immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER ready_profile_immutable BEFORE UPDATE ON "TeamPaymentProfile" FOR EACH ROW EXECUTE FUNCTION preserve_ready_profile();
ALTER TABLE "AuditEvent" ADD CONSTRAINT audit_actor_team_fk FOREIGN KEY ("teamId","actorId") REFERENCES "User" ("teamId",id);
CREATE UNIQUE INDEX profile_destination_key ON "TeamPaymentProfile" ("teamId",id,"subaccountCode");
ALTER TABLE "Payment" ADD CONSTRAINT payment_profile_destination_fk FOREIGN KEY ("teamId","paymentProfileId","subaccountCode") REFERENCES "TeamPaymentProfile" ("teamId",id,"subaccountCode");
CREATE UNIQUE INDEX participant_identity_key ON "SessionParticipant" ("teamId",id,"sessionId","playerId");
ALTER TABLE "Attendance" ADD CONSTRAINT attendance_identity_fk FOREIGN KEY ("teamId","participantId","sessionId","playerId") REFERENCES "SessionParticipant" ("teamId",id,"sessionId","playerId");
CREATE UNIQUE INDEX qualifying_payment_key ON "Payment" ("teamId","monthlyDuesId",id);
ALTER TABLE "MonthlyDues" ADD CONSTRAINT qualifying_payment_dues_fk FOREIGN KEY ("teamId",id,"qualifyingPaymentId") REFERENCES "Payment" ("teamId","monthlyDuesId",id);
