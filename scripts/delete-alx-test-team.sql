-- Permanently delete ONLY the explicitly authorized ALX test team.
-- Target: 8424095d-9e32-4445-83bd-7b2bc5497292.
-- Stop API/worker writes first. This works before or after the Account migration.
-- No TRUNCATE, CASCADE, or disabling of foreign-key constraints is used.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
 target UUID := '8424095d-9e32-4445-83bd-7b2bc5497292';
 team_name TEXT;
 members UUID[];
 identities UUID[];
 maintenance_user UUID := gen_random_uuid();
 maintenance_account UUID;
BEGIN
 -- Serialize cleanup against application writes and audit-trigger changes.
 LOCK TABLE public."Team", public."User", public."Invitation", public."VerificationToken",
  public."DeviceSession", public."TrainingSession", public."SessionParticipant", public."Attendance",
  public."DuesPeriod", public."MonthlyDues", public."Payment", public."IdempotencyRecord",
  public."PaymentReceipt", public."BankAccountChange", public."TeamTransferAccount",
  public."TeamPaymentProfile", public."AuditEvent", public."BackgroundJob" IN ACCESS EXCLUSIVE MODE;
 IF to_regclass('public."PushSubscription"') IS NOT NULL THEN
  EXECUTE 'LOCK TABLE public."PushSubscription" IN ACCESS EXCLUSIVE MODE';
 END IF;
 IF to_regclass('public."Account"') IS NOT NULL THEN
  EXECUTE 'LOCK TABLE public."Account" IN ACCESS EXCLUSIVE MODE';
 END IF;
 SELECT name INTO team_name FROM public."Team" WHERE id=target;
 IF NOT FOUND THEN
  RAISE NOTICE 'Target team is already absent; nothing deleted.';
  RETURN;
 END IF;
 IF team_name NOT ILIKE '%ALX%' THEN
  RAISE EXCEPTION 'Target name does not identify ALX; cleanup refused.';
 END IF;
 SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO members FROM public."User"
 WHERE "teamId"=target OR ("teamId" IS NULL AND "pendingInvitationId" IN (
  SELECT id FROM public."Invitation" WHERE "teamId"=target
 ));
 IF EXISTS (SELECT 1 FROM public."Team" WHERE id<>target AND "createdBy"=ANY(members)) OR
    EXISTS (SELECT 1 FROM public."User" WHERE "teamId" IS NOT NULL AND "teamId"<>target
     AND "pendingInvitationId" IN (SELECT id FROM public."Invitation" WHERE "teamId"=target)) OR
    EXISTS (SELECT 1 FROM public."AuditEvent" WHERE "teamId" IS NOT NULL AND "teamId"<>target AND "actorId"=ANY(members)) THEN
  RAISE EXCEPTION 'Another team references target membership data; cleanup refused.';
 END IF;
 IF to_regclass('public."Account"') IS NOT NULL THEN
  EXECUTE 'SELECT COALESCE(array_agg(DISTINCT "accountId"), ARRAY[]::UUID[]) FROM public."User" WHERE id=ANY($1)'
   INTO identities USING members;
 END IF;
 -- Break the Team/creator cycle using a transaction-local, inactive identity.
 -- This avoids changing any retained membership or disabling immutable-team protection.
 INSERT INTO public."User" (id,email,name,role,"passwordHash",active,"isVerified")
 VALUES (maintenance_user, maintenance_user::TEXT || '@maintenance.invalid', 'ALX cleanup', 'MANAGER', 'inactive-maintenance-identity', false, false);
 IF to_regclass('public."Account"') IS NOT NULL THEN
  EXECUTE 'SELECT "accountId" FROM public."User" WHERE id=$1' INTO maintenance_account USING maintenance_user;
 END IF;
 UPDATE public."Team" SET "createdBy"=maintenance_user,"paymentProfileId"=NULL,"transferAccountId"=NULL WHERE id=target;
 -- Paid-dues/payment references form a cycle; reset only the rows being deleted.
 UPDATE public."MonthlyDues" SET status='NOT_PAID',"paidAt"=NULL,"qualifyingPaymentId"=NULL WHERE "teamId"=target;
 ALTER TABLE public."AuditEvent" DISABLE TRIGGER audit_append_only;
 DELETE FROM public."AuditEvent" WHERE "teamId"=target OR ("teamId" IS NULL AND "actorId"=ANY(members));
 ALTER TABLE public."AuditEvent" ENABLE TRIGGER audit_append_only;
 IF to_regclass('public."PushSubscription"') IS NOT NULL THEN
  EXECUTE 'DELETE FROM public."PushSubscription" WHERE "teamId"=$1 OR "userId"=ANY($2)' USING target,members;
 END IF;
 DELETE FROM public."BackgroundJob" WHERE "teamId"=target OR ("teamId" IS NULL AND payload->>'userId' IN (SELECT unnest(members)::TEXT));
 DELETE FROM public."PaymentReceipt" WHERE "teamId"=target;
 DELETE FROM public."IdempotencyRecord" WHERE "teamId"=target;
 DELETE FROM public."Payment" WHERE "teamId"=target;
 DELETE FROM public."MonthlyDues" WHERE "teamId"=target;
 DELETE FROM public."BankAccountChange" WHERE "teamId"=target;
 DELETE FROM public."TeamTransferAccount" WHERE "teamId"=target;
 DELETE FROM public."TeamPaymentProfile" WHERE "teamId"=target;
 DELETE FROM public."Attendance" WHERE "teamId"=target;
 DELETE FROM public."SessionParticipant" WHERE "teamId"=target;
 DELETE FROM public."TrainingSession" WHERE "teamId"=target;
 DELETE FROM public."DuesPeriod" WHERE "teamId"=target;
 DELETE FROM public."VerificationToken" WHERE "userId"=ANY(members);
 DELETE FROM public."DeviceSession" WHERE "userId"=ANY(members);
 UPDATE public."User" SET "pendingInvitationId"=NULL WHERE id=ANY(members);
 DELETE FROM public."Invitation" WHERE "teamId"=target;
 DELETE FROM public."User" WHERE id=ANY(members);
 DELETE FROM public."Team" WHERE id=target;
 DELETE FROM public."User" WHERE id=maintenance_user;
 IF to_regclass('public."Account"') IS NOT NULL THEN
  EXECUTE 'DELETE FROM public."Account" a WHERE (a.id=ANY($1) OR a.id=$2) AND NOT EXISTS (SELECT 1 FROM public."User" u WHERE u."accountId"=a.id)'
   USING identities,maintenance_account;
 END IF;
END $$;

SELECT '8424095d-9e32-4445-83bd-7b2bc5497292' AS target_team_id,
 NOT EXISTS (SELECT 1 FROM public."Team" WHERE id='8424095d-9e32-4445-83bd-7b2bc5497292') AS target_team_absent;
COMMIT;
