-- 会话级缓存续接：记录每个 (槽位, 会话) 最近一次成功的 response id，
-- 供「强制续接」在客户端没带 previous_response_id 时补上，让上游继续滚前缀缓存。
CREATE TABLE IF NOT EXISTS session_cache_state (
  vm_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  model TEXT,
  last_response_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (vm_id, session_key)
);
