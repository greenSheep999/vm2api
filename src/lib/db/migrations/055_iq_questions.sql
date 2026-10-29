-- 题库：每道题自带判定规则，只有给了期望值的题才参与自动分档。
CREATE TABLE IF NOT EXISTS iq_questions (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL,          -- numeric | image | text
  prompt        TEXT NOT NULL,
  judge_rule    TEXT NOT NULL,          -- numeric_pass | record_only | structure
  expected      TEXT,                   -- numeric_pass 时的期望值
  auto_support  INTEGER NOT NULL DEFAULT 0, -- 是否参与自动分档
  builtin       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- 任务支持绑定题目与范围
ALTER TABLE iq_tasks ADD COLUMN question_id TEXT;
ALTER TABLE iq_tasks ADD COLUMN scope_type TEXT;      -- slot | key
ALTER TABLE iq_tasks ADD COLUMN scope_ids TEXT;       -- JSON 数组
ALTER TABLE iq_tasks ADD COLUMN effort TEXT;

-- 运行记录补来源与题目信息
ALTER TABLE iq_task_runs ADD COLUMN source TEXT;      -- single | task
ALTER TABLE iq_task_runs ADD COLUMN question_id TEXT;
ALTER TABLE iq_task_runs ADD COLUMN effort TEXT;
ALTER TABLE iq_task_runs ADD COLUMN tokens INTEGER;
