# 缓存模块

## 现状

- 采集：`cache_read_tokens` / `cache_creation_tokens` / `cache_creation_5m` / `1h`
- 实测（近 6h，613 条）：有缓存读取 496 条，**有缓存写入 0 条**
- 原因：Codex/ChatGPT 是**隐式缓存**，上游只回「命中读取」，不单独上报写入量

因此「5m / 1h 写入」对我们恒为 0，面板已改为写入为 0 时不显示该段。

## 判据

| 指标 | 含义 | 阈值 |
|---|---|---|
| 命中率 | cache_read / input | < 30% 值得关注 |
| 全价输入 | 未命中部分 | 越低越好 |
| 写入量 | 仅 Anthropic 直连链路有 | 隐式缓存恒 0，不算异常 |

## 待办

1. 面板加「缓存」tab：命中率趋势、按槽位对比
2. 命中率骤降时联动提示（可能是 prompt 结构变化或粘性失效）

## 直连上游实测（2026-10-30，vm-gpt-03）

用槽位 token 直连 `chatgpt.com/backend-api/codex/responses`，同一段 60k 字符前缀连打两发：

| 条件 | 第 2 发 cached | 结论 |
|---|---|---|
| 不带 `session_id` / `x-codex-window-id` / `x-codex-turn-metadata`（间隔 1s） | 0 | **缓存命中的必要条件**：会话身份头 |
| 带上上面三个头（间隔 1s） | 13,184 | 命中 |
| 同上，间隔 180s | 13,184 | 仍命中 |
| 同上，间隔 420s | 13,184 | 仍命中（≥7 分钟） |
| 带 `prompt_cache_retention: "24h"` | — | **400 Unsupported parameter**，必须丢掉 |

因此：

1. `prompt_cache_retention` 在这条链路上**不存在**，24 小时档位是 Anthropic 的概念（sub2api 的
   `enable_anthropic_cache_ttl_1h_injection` 也只作用于 Anthropic 链路），Codex/GPT 端不认。
2. 缓存键 = **会话身份头 + 前缀内容**；只设 `prompt_cache_key` 而会话头缺失时不命中。
3. `store` 必须为 `false`，否则上游 400 `Store must be set to false`。

## 控制项（全部按 Key 配置）

| 控制 | 作用 |
|---|---|
| 允许换号 | 关 = 会话绑死槽位，换号即丢前缀缓存 |
| 粘性时长 | 空闲超过 N 分钟才允许迁移 |
| 强制续接 | 客户端没带 `previous_response_id` 时由网关补上，保持滚动链 |

指纹收敛（off/device/session/full）都会写稳定的会话身份头，**不会**打散缓存；
但「off」依赖客户端自己带，客户端不带头时缓存直接失效。
