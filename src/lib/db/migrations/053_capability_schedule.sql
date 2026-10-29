-- 能力题（糖果/鹈鹕）独立节律：各自记录最近一次执行时间与结论，
-- 这样探针可以 3 分钟一跑，糖果 15 分钟、鹈鹕 30 分钟，互不干扰。
ALTER TABLE ticket_snapshots ADD COLUMN candy_at TEXT;
ALTER TABLE ticket_snapshots ADD COLUMN candy_verdict TEXT;
ALTER TABLE ticket_snapshots ADD COLUMN candy_answer INTEGER;
ALTER TABLE ticket_snapshots ADD COLUMN pelican_at TEXT;
ALTER TABLE ticket_snapshots ADD COLUMN pelican_verdict TEXT;
