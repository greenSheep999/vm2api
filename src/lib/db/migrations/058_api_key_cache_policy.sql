-- 缓存策略改成按 key 配置：不同客户/分组可以有不同目标（Pro 高缓存、Plus 低缓存）。
ALTER TABLE api_keys ADD COLUMN cache_policy TEXT;
