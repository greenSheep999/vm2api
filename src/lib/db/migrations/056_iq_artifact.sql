-- 结果页要直接渲染作品（鹈鹕的 SVG/HTML），所以必须保存完整产物，
-- 只存 300 字摘要是不够的。artifact 存原始输出（上限由写入端截断）。
ALTER TABLE iq_task_runs ADD COLUMN artifact TEXT;
