-- 跨套餐溢出改为按 Key 管理：默认关闭，只有该 Key 明确打开才允许借其它套餐的槽位。
ALTER TABLE api_keys ADD COLUMN allow_overflow INTEGER NOT NULL DEFAULT 0;
