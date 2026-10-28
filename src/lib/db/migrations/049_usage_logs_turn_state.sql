ALTER TABLE usage_logs ADD COLUMN turn_state_verdict TEXT;
ALTER TABLE usage_logs ADD COLUMN turn_state_blocks INTEGER;
ALTER TABLE usage_logs ADD COLUMN turn_state_len INTEGER;
ALTER TABLE usage_logs ADD COLUMN turn_state_issued_at TEXT;
