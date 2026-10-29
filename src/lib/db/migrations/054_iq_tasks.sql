-- 降智检测任务：把「探针/糖果/鹈鹕」变成有状态、可调度、可追溯的任务。
CREATE TABLE IF NOT EXISTS iq_tasks (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,              -- probe | candy | pelican
  interval_sec INTEGER NOT NULL,
  model        TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  only_healthy INTEGER NOT NULL DEFAULT 0, -- 只对探针 healthy 的号跑（糖果/鹈鹕用）
  last_run_at  TEXT,
  next_run_at  TEXT,
  last_verdict TEXT,
  run_count    INTEGER NOT NULL DEFAULT 0,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS iq_task_runs (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  vm_id       TEXT NOT NULL,
  model       TEXT,
  verdict     TEXT,
  answer      INTEGER,
  expected    INTEGER,
  detail      TEXT,
  ok          INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_iq_task_runs_task ON iq_task_runs(task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_task_runs_vm ON iq_task_runs(vm_id, started_at DESC);
