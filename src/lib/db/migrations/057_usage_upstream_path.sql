-- 日志页要显示「请求端点」：入站路径 + 上游路径两行。
-- 入站已有 path，上游路径此前没有落库，导致面板只能猜。
ALTER TABLE usage_logs ADD COLUMN upstream_path TEXT;
