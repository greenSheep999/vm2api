-- 统一门票库：存放「已验证可用」的门票，供降智/偶发铸票失败的账号借用。
-- 只有通过两发续接验证的票才允许入库（verdict = verified）。
CREATE TABLE IF NOT EXISTS ticket_pool (
  vm_id       TEXT NOT NULL,
  model       TEXT NOT NULL,
  state       TEXT NOT NULL,
  cookies     TEXT,
  source      TEXT,
  verdict     TEXT NOT NULL,
  blocks      INTEGER,
  len         INTEGER,
  issued_at   TEXT,
  expires_at  TEXT,
  verified_at TEXT,
  updated_at  TEXT,
  PRIMARY KEY (vm_id, model)
);
CREATE INDEX IF NOT EXISTS idx_ticket_pool_expires ON ticket_pool(expires_at);
