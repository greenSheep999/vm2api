-- 探针结论要独立于「有没有票」保存：
-- 有票只说明上游铸了票，是否满血看第二发有没有被重铸。
ALTER TABLE ticket_snapshots ADD COLUMN probe_verdict TEXT;
ALTER TABLE ticket_snapshots ADD COLUMN probe_at TEXT;
ALTER TABLE ticket_snapshots ADD COLUMN probe_detail TEXT;
