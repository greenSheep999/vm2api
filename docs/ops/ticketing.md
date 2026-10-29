# 门票（打票）模块

## 是什么

Codex 上游在响应头铸造 `x-codex-turn-state`（一个不透明 blob），客户端在同一回合的
后续请求中原样回带。sub2api 称之为「门票」，把「检测门票」和「解决门票」分成两件事。

## 信封结构（对齐 sub2api `parseOpenAICodexTicketShape`）

```
base64url 解码后：
  raw[0]              === 0x80
  raw[1..9]           = 签发时间戳（大端 uint64，秒）
  (len - 57) % 16     === 0
  blocks              = (len - 57) / 16

个人版        10 块 → 290 字符（带填充 292）
Team/Business 12 块 → 332 字符
```

## 判定

| verdict | 含义 |
|---|---|
| `ok` | 块数**恰好**等于该套餐期望 |
| `short` | 块数不足，降级/限流信号 |
| `tall` | 块数超出，套餐或信封格式与假设不符 |
| `malformed` | 有票但信封不合法 |
| `absent` | 上游没给票（裸打） |

判据收紧后只有 `ok` 是健康；`short`/`tall`/`absent` 都需要关注。

## 现状（2026-10-29）

- 检测：`src/lib/protocol/turn-state.mjs`，成功 hop 时采集，写入 `usage_logs.turn_state_*`
- 前端：请求详情「结果与转发」展示门票状态与签发时间；列表异常时打标
- **实测结论：46/46 条请求全部 `absent`** —— 上游不给我们铸票
- 我们还没有注入能力（不改写、不铸票）

## 待办

1. 判定 `absent` 是「上游不铸」还是「transport 丢头」：配额头（`x-codex-*-used-percent`）
   能到达我们，若唯独 turn-state 不到，则是前者
2. 复用注入：把真实流量里铸出的票按 `(vm_id, model)` 缓存，同账号下次回带（成本零）
3. 后台铸票：需要 cookie 刷新 + 出口调度 + `fail_closed`，属于重活，单独一轮
4. 出口必须固定为该槽绑定的代理，不做动态 IP 轮换（同一身份多地铸票是风控特征）
