-- 门票打票：账号级开关、票快照、事件流。
--
-- 只存判定所需的事实（块数/长度/签发/出口），不存票原文：
-- 票是上游发的凭据，落库等于泄露，和 sub2api 的做法一致（它们的
-- OpenAICodexTicketStatus 明确「不含 state blob」）。

CREATE TABLE IF NOT EXISTS ticket_account_flags (
  vm_id        TEXT PRIMARY KEY,
  skip_harvest INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS ticket_snapshots (
  vm_id      TEXT NOT NULL,
  model      TEXT NOT NULL,
  verdict    TEXT,
  blocks     INTEGER,
  len        INTEGER,
  issued_at  TEXT,
  expires_at TEXT,
  proxy      TEXT,
  checked_at TEXT,
  http_status INTEGER,
  edge_ip     TEXT,
  PRIMARY KEY (vm_id, model)
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  vm_id       TEXT,
  model       TEXT,
  http_status INTEGER,
  result      TEXT,
  reason      TEXT,
  detail      TEXT,
  proxy       TEXT,
  edge_ip     TEXT
);

CREATE INDEX IF NOT EXISTS idx_ticket_events_at ON ticket_events(at DESC);
