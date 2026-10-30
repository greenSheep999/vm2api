-- 缓存配比闭环控制：按 key 记录「主动打散比例」与最近实测命中率。
CREATE TABLE IF NOT EXISTS cache_control_state (
  key_id TEXT PRIMARY KEY,
  bust_permille INTEGER NOT NULL DEFAULT 0,
  measured_ratio REAL,
  samples INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
