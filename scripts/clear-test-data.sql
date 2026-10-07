-- Clear all disposable PitchPresence test data in the public schema.
-- Stop the API and worker first. This preserves migrations, tables, and triggers.
-- The explicit table list intentionally avoids CASCADE into unrelated tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

TRUNCATE TABLE
  public."Attendance",
  public."SessionParticipant",
  public."TrainingSession",
  public."IdempotencyRecord",
  public."Payment",
  public."MonthlyDues",
  public."DuesPeriod",
  public."TeamPaymentProfile",
  public."AuditEvent",
  public."BackgroundJob",
  public."VerificationToken",
  public."DeviceSession",
  public."Invitation",
  public."User",
  public."Team",
  public."RateLimitBucket";

SELECT
  (SELECT count(*) FROM public."User") AS accounts,
  (SELECT count(*) FROM public."Team") AS teams,
  (SELECT count(*) FROM public."TrainingSession") AS training_sessions,
  (SELECT count(*) FROM public."BackgroundJob") AS queued_jobs;
COMMIT;
