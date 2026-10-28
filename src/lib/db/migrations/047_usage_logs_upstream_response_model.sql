-- 上游实际回包的模型（Responses SSE 的 response.model）。
--
-- upstream_model 是「我们发给上游的模型」，通常与 requested_model 相同；
-- 上游自己把 astra 降级成 luna 回包时，只有这一列能看出来。
-- NULL = 该请求没有可解析到 response.model 的帧（历史行、纯 JSON 响应缺 model 等）。
ALTER TABLE usage_logs ADD COLUMN upstream_response_model TEXT;
