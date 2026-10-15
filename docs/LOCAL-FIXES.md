# 本地修复记录

本文件记录**未提交上游**的本地修复与运维处置，供后续复查、回滚或整理issue时参考。

- 修复日期：2026-10-15
- 部署实例：OVH VPS `40.160.37.212`（`/opt/vm2api`），域名 `vm2a.muxpay.xyz`
- 部署版本：`v1.3.171`（2026-10-15 由 1.3.133 升级）
- 本地仓库基线：`c45c620`（1.3.133）；本文件涉及的三个文件在 1.3.133 与 1.3.171 之间**内容完全一致**

---

## 一、已修复的代码缺陷（本地修改，未提 PR）

### 1. `docker-compose.yml` 硬编码 `HOST: 0.0.0.0`

| 项 | 内容 |
|---|---|
| 位置 | `docker-compose.yml:29` |
| 原代码 | `HOST: 0.0.0.0` |
| 问题 | 面板「入站」检测到公网可达 `8787` 后会建议「只监听 127.0.0.1 并走反代」，但该值写死在 compose 里，**`.env` 中的 `HOST=127.0.0.1` 被静默忽略**，用户按建议操作无效。 |
| 修复 | `HOST: ${HOST:-0.0.0.0}`（默认值不变，保持向后兼容） |
| 影响面 | 所有希望把控制面收到回环、经反代暴露的部署 |

### 2. `deploy/install.sh` 管理台密码逻辑忽略环境变量

| 项 | 内容 |
|---|---|
| 位置 | `deploy/install.sh` → `ensure_env()` |
| 原代码 | `env_set_if_empty VM2API_ADMIN_PASSWORD "$DEFAULT_ADMIN_PASSWORD"`（`DEFAULT_ADMIN_PASSWORD="123456"`） |
| 问题 | ① **不读取 `VM2API_ADMIN_PASSWORD` 环境变量**，外部传入的密码被丢弃；② 回落到 6 位的 `123456`，而面板 `panel-users` bootstrap 要求 **≥8 位**，于是日志只留一行 `bootstrap failed 密码至少 8 位`，**控制台没有任何可用管理员账号**。 |
| 修复 | 优先取 `VM2API_ADMIN_PASSWORD` → `KIN_ADMIN_PASSWORD` → 内置默认值；写入前校验长度 `<8` 直接报错退出；用环境变量写入时不再标记为「默认密码」。 |
| 影响面 | 所有用一键脚本安装、且通过环境变量传密码的用户（**按文档裸装即中招**） |

### 3. `scripts/docker-entrypoint.sh` 容器入口回落到 `123456`

| 项 | 内容 |
|---|---|
| 位置 | `scripts/docker-entrypoint.sh:127` |
| 原代码 | `VM2API_ADMIN_PASSWORD=123456` |
| 问题 | 与 #2 同源：`.env` 为空时入口写入 6 位默认密码，面板 bootstrap 直接失败。 |
| 修复 | 改为 `rand_hex()` 生成 64 位随机密码，并在启动日志里打印一次（提示登录后修改）。 |
| 影响面 | 手动 `docker run` 或 `.env` 缺密码的场景 |

**验证**：`bash -n` 语法检查通过；`git diff --stat` = 3 files changed, 32 insertions(+), 7 deletions(-)。

---

## 二、服务器运维处置（非代码修改）

### A. 控制面收口到回环 + 防火墙兜底

- `.env`：`HOST=127.0.0.1`
- `docker-compose.override.yml`（新增，升级不会被覆盖）覆盖 compose 的 `HOST`
- `iptables`：`-A INPUT ! -s 127.0.0.1/32 -p tcp --dport 8787 -j DROP`
- `systemd`：`vm2api-lockdown.service`（oneshot，开机自动补规则）
- 结果：公网 `40.160.37.212:8787` 不可达；HTTPS 经 Caddy（443）正常

### B. `refusal_guard` 设备永久封禁（导致 Agent「老断」）

- 现象：Claude Code / Agent 连续 `400 Request blocked by the refusal guard`，78 次后会话反复终止
- 根因：上游 Anthropic 对一次代码任务拒答（Usage Policy），`refusal_guard` 把该请求指纹固化，且 `device_block_enabled=true` **永久封禁 device_id**，此后所有请求在本地被拦
- 处置：
  - `DELETE /api/panel/refusal-device-blocks {device_id}` 解封
  - `DELETE /api/panel/refusal-guards/{fingerprint}` 删除指纹
  - `PUT /api/panel/refusal-guards {"device_block_enabled": false}` 关闭永久封禁
- 结果：`claude-opus-5-5` 实测 HTTP 200

### C. `proxy_cli_enabled` 漂移（上游 issue #332）

- 现象：槽位凭证/代理/容器全正常、`schedulable=true`，但池子恒返 `account_pool_exhausted eligible=0`
- 根因：`slotHasBoundProxy()` 要求 `vm.proxy_cli_enabled` 为真；旧版 `vm-package.mjs` 在导入包时把它重置为 `false`
- 处置：重新绑定代理（触发 `vm-registry.mjs` 置位为 true）+ 重开调度
- **上游已在 v1.3.138 修复并加入自愈逻辑**，升级后无需再手动处理

### D. 其他清理

- 删除卡死的 `vm-01`（容器网络 ID 失效导致 `ExitCode=128` + `cli-node-guard` 刷屏）
- `active_vm` 切到 `vm-claude-01`（`active` 槽位不允许直接删除）

---

## 三、待议项（未改代码）

| # | 问题 | 状态 |
|---|---|---|
| 1 | `refusal_guard` 的 `device_block_enabled` 默认开启且策略过于激进：上游**一次**拒答就永久封设备，无重试/退避 | 已在本实例关闭；**建议上游改成次数/时间窗限制或默认关闭** |
| 2 | 非流式 `/v1/chat/completions` 返回 Codex 原始 response 对象（无 `choices`），OpenAI 非流式客户端拿不到内容 | 未验证（GPT 槽当前无凭证）；若复现需修 `codex-convert` 非流式分支 |
| 3 | `eligibleCandidates` 中资格失败仅 `continue`，不记录原因，日志只见 `eligible=0` | 新版已增加 `candidates.rejections` 分类，但排除原因仍不完整 |
| 4 | 面板凭证状态显示 `cred=可用` 但 refresh 实际已被拒（假阳性） | 未修；判断只看 `has_access`/`has_refresh` 字段 |

---

## 四、当前部署状态（2026-10-15）

```
版本：v1.3.171        容器：vm2api / kin-claude-01 / kin-gpt-01 / kin-gpt-02
加固：HOST=127.0.0.1 + iptables + systemd（docker-compose.override.yml 常在）
集群：node-4c69995e（vps237 62.146.173.237）link=ready
守卫：device_block_enabled=false，指纹 0，设备封禁 0
实测：claude-opus-5-5 / claude-haiku-4-5 → HTTP 200
```

---

## 五、这些修改如何应用

代码修改目前只在本地仓库（工作区，未提交）。如需在服务器生效：

1. **compose / entrypoint**：`docker-compose.yml` 随升级会被上游覆盖，故服务器侧用
   `docker-compose.override.yml` 承载同类修复（已存在）。
2. **install.sh**：服务器上的 `deploy/install.sh` 为脚本运行时下载的副本，升级时会重新下载；
   若要让修复生效，需替换服务器上的副本或在本地重新执行修改后的脚本。
3. 上游修复跟进：**第一节的三个问题截至 v1.3.171 均未修复**（已逐条核对 `docker-compose.yml`、
   `deploy/install.sh`、`scripts/docker-entrypoint.sh` 源码）。上游在 v1.3.137–v1.3.140 修掉的是
   另外几个问题（`cli-node-guard` 刷屏、换代理不重建网络、`/cc#/login` 404 等），不要混淆。
