-- Drop the hard-coded status check so tenant-configured custom statuses are allowed.
-- Validation is now enforced at the application layer via tenant config.
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
