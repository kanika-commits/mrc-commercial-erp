ALTER TABLE user_session_activity
  ADD COLUMN IF NOT EXISTS active_since_at timestamptz;

UPDATE user_session_activity
SET active_since_at = login_at
WHERE active_since_at IS NULL;
