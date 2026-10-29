# 客户端持续重连（Reconnecting /5）

- **发现日期**：2026-10-29
- **症状**：Codex 客户端每几次请求就出现 `Reconnecting 1/5`，伴随
  `stream disconnected before completion: stream closed before response.completed`，基本无法连续作业。
- **影响范围**：所有经 new-api（vps22）转发到 vm2api 的 Codex 请求。

## 结论（一句话）

不是 vm2api 的流断了，而是 **new-api 的 Responses 转发把「流里没有 `[DONE]`」判成 EOF**，
当成截断处理后关闭连接，客户端于是重连。vm2api 侧补上终止标记即可消除大部分。

## 证据链

| 观测点 | 数据 | 判定 |
|---|---|---|
| vm2api → 上游 | 156/156 流完整，含 `response.completed` | 正常 |
| vm2api 的 SSE 响应头 | `x-accel-buffering: no`、`no-cache, no-transform`、`tcpNodelay` | 正常 |
| vm2api `stream_incomplete` | 0 / 223 | 正常 |
| vps22 Caddy | `flush_interval -1`、`read_timeout 10m` | 不缓冲 |
| new-api 容器 | `STREAMING_TIMEOUT=300`、`RELAY_RESPONSE_HEADER_TIMEOUT=180` | 不是超时 |
| **new-api 日志（修复前）** | `stream ended: reason=eof` 54 次 / `reason=done` 3 次 | **判定失败** |
| **new-api 日志（修复后）** | `reason=done` 51 次 / `eof` 5 次 / `client_gone` 1 次 | 修复 |

new-api 的 `eof` 来自「没收到 `[DONE]`」。官方 Responses API 的 SSE **本来就不发 `[DONE]`**，
只发 `event: response.completed`，所以这一跳必然被误判。

上游同类问题：new-api 社区有对应修复（`fix(responses): fix streaming EOF, missing [DONE]`）
与 issue「missing terminal event / client_gone」。

## 修复

1. **gs.23**：直连 hop 补心跳、监听 `aborted`/`error`、检测 `response.completed` 缺失并返回
   `terminalState=incomplete`；直连不再做 180s 空闲掐断。
2. **gs.30**：流正常结束时补 `data: [DONE]`（`KIN_CODEX_SSE_DONE=0` 可关闭）。
3. **gs.25 / gs.27**：出站身份归一为 Linux CLI（`codex_exec/0.165.0 (Linux …; x86_64)`），
   与 `originator`、`version`、`turn-metadata` 自洽——槽位是 Debian，不能伪装成 Mac 桌面端。

## 残留

- 异常收尾路径（上游中断、客户端主动断开）**没有机会写 `[DONE]`**，new-api 仍会记
  `eof` / `client_gone`（每 10 分钟约 5～6 次），属于真实中断，不是误判。
- new-api 镜像版本偏旧（`tokensheep-newapi:20261022-ddb1e1fd6`），
  **建议升级**：升级后 `eof` 应归零，vm2api 侧的 `[DONE]` 可作为兼容保险保留。

## 回滚

```bash
# 关闭 [DONE] 终止标记
KIN_CODEX_SSE_DONE=0
docker compose up -d
```

## 排查手册（下次再遇到）

```bash
# 1. 我们这侧是否有截断
ssh ovh-vps "sudo -n python3 -c \"
import sqlite3;c=sqlite3.connect('file:/opt/vm2api/data/kin.db?mode=ro',uri=True)
print(c.execute('SELECT SUM(error_code=\\\"stream_incomplete\\\"), COUNT(*) FROM usage_logs WHERE datetime(replace(created_at,\\\"T\\\",\\\" \\\")) > datetime(\\\"now\\\",\\\"-30 minutes\\\")').fetchone())\""

# 2. new-api 侧如何判定结束
ssh vps22 'docker logs --since 10m new-api-green 2>&1 | grep -oE "stream ended: reason=[a-z_]+" | sort | uniq -c'

# 3. 走公网入口的流是否被缓冲（看事件间隔）
#    平均间隔应 < 0.1s；若出现秒级空档且成组到达，说明中间层在缓冲
```
