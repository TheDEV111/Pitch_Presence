-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PLAYER', 'MANAGER');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('QR', 'MANUAL');

-- CreateEnum
CREATE TYPE "DuesStatus" AS ENUM ('NOT_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('VERIFY_EMAIL', 'PIN_RESET');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PLAYER',
    "pinHash" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "startedBy" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "locationAccuracy" DOUBLE PRECISION NOT NULL,
    "locationCapturedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionParticipant" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "playerName" TEXT NOT NULL,

    CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "checkedInAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "AttendanceMethod" NOT NULL,
    "recordedBy" UUID,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuesPeriod" (
    "month" TEXT NOT NULL,
    "minimumAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "frozenAt" TIMESTAMPTZ(3),
    "configuredBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DuesPeriod_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "MonthlyDues" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "status" "DuesStatus" NOT NULL DEFAULT 'NOT_PAID',
    "paidAt" TIMESTAMPTZ(3),
    "qualifyingPaymentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyDues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "monthlyDuesId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "minimumAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "provider" "PaymentProvider" NOT NULL,
    "providerReference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "checkoutUrl" TEXT,
    "markedBy" UUID,
    "externalReference" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "verifiedAt" TIMESTAMPTZ(3),
    "reversedAt" TIMESTAMPTZ(3),
    "reversedBy" UUID,
    "reversalReason" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "changes" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "leaseToken" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL,
    "playerId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "paymentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_purpose_createdAt_idx" ON "VerificationToken"("userId", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceSession_tokenHash_key" ON "DeviceSession"("tokenHash");

-- CreateIndex
CREATE INDEX "DeviceSession_userId_idx" ON "DeviceSession"("userId");

-- CreateIndex
CREATE INDEX "TrainingSession_startedAt_id_idx" ON "TrainingSession"("startedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_sessionId_playerId_key" ON "SessionParticipant"("sessionId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_participantId_key" ON "Attendance"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_sessionId_playerId_key" ON "Attendance"("sessionId", "playerId");

-- CreateIndex
CREATE INDEX "MonthlyDues_month_status_idx" ON "MonthlyDues"("month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyDues_playerId_month_key" ON "MonthlyDues"("playerId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerReference_key" ON "Payment"("providerReference");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_id_idx" ON "AuditEvent"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_deduplicationKey_key" ON "BackgroundJob"("deduplicationKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_availableAt_completedAt_failedAt_idx" ON "BackgroundJob"("availableAt", "completedAt", "failedAt");

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceSession" ADD CONSTRAINT "DeviceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "SessionParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyDues" ADD CONSTRAINT "MonthlyDues_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_monthlyDuesId_fkey" FOREIGN KEY ("monthlyDuesId") REFERENCES "MonthlyDues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Business invariants not expressible in Prisma's schema language.
CREATE UNIQUE INDEX one_open_session ON "TrainingSession" (status) WHERE status = 'OPEN';
CREATE UNIQUE INDEX one_pending_paystack_payment ON "Payment" ("monthlyDuesId") WHERE provider = 'PAYSTACK' AND status = 'PENDING';
ALTER TABLE "TrainingSession" ADD CONSTRAINT session_location_valid CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND "locationAccuracy" > 0 AND "locationAccuracy" <= 100);
ALTER TABLE "TrainingSession" ADD CONSTRAINT session_close_consistent CHECK ((status = 'OPEN' AND "closedAt" IS NULL) OR (status = 'CLOSED' AND "closedAt" IS NOT NULL));
ALTER TABLE "TrainingSession" ADD CONSTRAINT session_manager_fk FOREIGN KEY ("startedBy") REFERENCES "User" (id);
ALTER TABLE "Invitation" ADD CONSTRAINT invitation_manager_fk FOREIGN KEY ("createdBy") REFERENCES "User" (id);
ALTER TABLE "Attendance" ADD CONSTRAINT attendance_roster_fk FOREIGN KEY ("sessionId", "playerId") REFERENCES "SessionParticipant" ("sessionId", "playerId");
ALTER TABLE "Attendance" ADD CONSTRAINT attendance_actor_fk FOREIGN KEY ("recordedBy") REFERENCES "User" (id);
ALTER TABLE "Attendance" ADD CONSTRAINT attendance_method_consistent CHECK ((method = 'MANUAL' AND "recordedBy" IS NOT NULL) OR (method = 'QR' AND "recordedBy" IS NULL));
ALTER TABLE "DuesPeriod" ADD CONSTRAINT dues_minimum_positive CHECK ("minimumAmount" > 0 AND currency = 'NGN' AND month ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "DuesPeriod" ADD CONSTRAINT dues_period_manager_fk FOREIGN KEY ("configuredBy") REFERENCES "User" (id);
ALTER TABLE "MonthlyDues" ADD CONSTRAINT dues_month_valid CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "MonthlyDues" ADD CONSTRAINT dues_state_consistent CHECK ((status='NOT_PAID' AND "paidAt" IS NULL AND "qualifyingPaymentId" IS NULL) OR (status='PAID' AND "paidAt" IS NOT NULL AND "qualifyingPaymentId" IS NOT NULL));
ALTER TABLE "MonthlyDues" ADD CONSTRAINT dues_payment_fk FOREIGN KEY ("qualifyingPaymentId") REFERENCES "Payment" (id);
ALTER TABLE "Payment" ADD CONSTRAINT payment_amount_valid CHECK (amount >= "minimumAmount" AND "minimumAmount" > 0 AND currency = 'NGN');
ALTER TABLE "Payment" ADD CONSTRAINT payment_provider_consistent CHECK ((provider = 'PAYSTACK' AND "providerReference" IS NOT NULL AND "markedBy" IS NULL) OR (provider = 'EXTERNAL' AND "markedBy" IS NOT NULL AND "providerReference" IS NULL));
ALTER TABLE "Payment" ADD CONSTRAINT payment_reversal_consistent CHECK (("reversedAt" IS NULL AND "reversedBy" IS NULL AND "reversalReason" IS NULL) OR (provider = 'EXTERNAL' AND "reversedAt" IS NOT NULL AND "reversedBy" IS NOT NULL AND length("reversalReason") >= 5));
ALTER TABLE "Payment" ADD CONSTRAINT payment_actor_fk FOREIGN KEY ("markedBy") REFERENCES "User" (id);
ALTER TABLE "Payment" ADD CONSTRAINT reversal_actor_fk FOREIGN KEY ("reversedBy") REFERENCES "User" (id);
ALTER TABLE "AuditEvent" ADD CONSTRAINT audit_actor_fk FOREIGN KEY ("actorId") REFERENCES "User" (id);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit events are append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
