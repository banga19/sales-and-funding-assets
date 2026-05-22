-- 009_add_received_at_message_history.sql
-- Add received_at column to message_history for inbound-message timestamp tracking.
-- Existing inbound rows are back-filled from sent_at (which was the closest available value).
-- Created: 2026-05-21

ALTER TABLE message_history ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

-- Back-fill: inbound messages had no separate received_at — use sent_at as the best approximation
UPDATE message_history
   SET received_at = sent_at
 WHERE direction = 'inbound'
   AND received_at IS NULL
   AND sent_at IS NOT NULL;

-- The remaining NULL received_at rows (outbound messages / sent_at NULL) are left as-is;
-- COALESCE(sent_at, received_at) in queries will continue to fall back to sent_at.

-- Made with Bob
