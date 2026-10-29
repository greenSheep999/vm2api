/**
 * 门票打票执行器（号池侧）。
 *
 * 打票 = 向该账号发一次最小请求，让上游铸出 `x-codex-turn-state`，把结果
 * （块数 / 长度 / 签发时间 / 出口）记进快照与事件流。**不保存票原文**：
 * 票是上游凭据，落库等于泄露（sub2api 的 ticket status 同样只给长度、不给 blob）。
 *
 * 取票路径复用网关自身：以 `x-kin-vm` 钉住槽位发一次 loopback 请求，然后从
 * usage_logs 里读该请求采到的 turn_state_* —— 这样不用另写一条上游链路，
 * 也不会绕开现有的鉴权、代理绑定与日志。
 */
import https from 'node:https'
import { getDb } from '../db/database.mjs'
import { getVm, listVms } from '../vm/vm-registry.mjs'
import { readCodexAccounts } from '../vm/codex-slot.mjs'
import { createSocksProxyAgent } from '../vm/proxy-agent.mjs'
import { judgeTurnState, expectedTurnStateBlocks } from '../protocol/turn-state.mjs'

const UPSTREAM_URL = 'https://chatgpt.com/backend-api/codex/responses'
const UPSTREAM_HOST = 'chatgpt.com'

const TINY_PROMPT = '只回复两个字符：OK'

/**
 * 糖果题（sub 的 candy）。只记录答案，不判定对错 —— 期望值需要按号池基线校准，
 * 写死 21 会把整层模型误判成降智（我们实测 gpt-6 系一致答 29）。
 */
const CANDY_PROMPT =
  '袋子里有三种口味糖果，每种有圆形和五角星两种形状（形状可摸出）。' +
  '圆形：苹果7 桃子9 西瓜8；五角星：苹果7 桃子6 西瓜4。' +
  '预先定好摸出个数，最少摸多少个才能保证同时拥有不同形状的苹果味和桃子味？只输出最终数字。'
const DEFAULT_MODEL = 'gpt-6-astra'

function nowIso() {
  return new Date().toISOString()
}

function db() {
  return getDb()
}

export function readAccountFlags() {
  const rows = db().prepare('SELECT vm_id, skip_harvest FROM ticket_account_flags').all()
  const map = new Map()
  for (const r of rows) map.set(r.vm_id, r.skip_harvest === 1)
  return map
}

export function setSkipHarvest(vmId, skip) {
  const at = nowIso()
  db()
    .prepare(
      `INSERT INTO ticket_account_flags (vm_id, skip_harvest, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(vm_id) DO UPDATE SET skip_harvest = excluded.skip_harvest, updated_at = excluded.updated_at`,
    )
    .run(String(vmId), skip ? 1 : 0, at)
  return { vm_id: vmId, skip_harvest: !!skip, updated_at: at }
}

export function readSnapshots() {
  const rows = db()
    .prepare('SELECT * FROM ticket_snapshots ORDER BY vm_id, model')
    .all()
  const map = new Map()
  for (const r of rows) map.set(`${r.vm_id}\u0000${r.model}`, r)
  return map
}

export function readEvents(limit = 100) {
  return db()
    .prepare('SELECT * FROM ticket_events ORDER BY id DESC LIMIT ?')
    .all(Math.max(1, Math.min(500, Number(limit) || 100)))
}

export function recordEvent(event) {
  const at = event.at || nowIso()
  const info = db()
    .prepare(
      `INSERT INTO ticket_events (at, kind, vm_id, model, http_status, result, reason, detail, proxy, edge_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      at,
      String(event.kind || 'ticket'),
      event.vm_id || null,
      event.model || null,
      event.http_status ?? null,
      event.result || null,
      event.reason || null,
      event.detail || null,
      event.proxy || null,
      event.edge_ip || null,
    )
  return { id: Number(info.lastInsertRowid), at, ...event }
}

function recordSnapshot({
  vmId,
  model,
  verdict,
  blocks,
  len,
  issuedAt,
  expiresAt,
  proxy,
  httpStatus,
  edgeIp,
}) {
  const checkedAt = nowIso()
  db()
    .prepare(
      `INSERT INTO ticket_snapshots
         (vm_id, model, verdict, blocks, len, issued_at, expires_at, proxy, checked_at, http_status, edge_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(vm_id, model) DO UPDATE SET
         verdict = excluded.verdict,
         blocks = excluded.blocks,
         len = excluded.len,
         issued_at = excluded.issued_at,
         expires_at = excluded.expires_at,
         proxy = excluded.proxy,
         checked_at = excluded.checked_at,
         http_status = excluded.http_status,
         edge_ip = excluded.edge_ip`,
    )
    .run(
      vmId,
      model,
      verdict,
      blocks ?? null,
      len ?? null,
      issuedAt || null,
      expiresAt || null,
      proxy || null,
      checkedAt,
      httpStatus ?? null,
      edgeIp || null,
    )
  return checkedAt
}

/** 面板用快照：账号 + 开关 + 每模型票状态。 */
export function harvestOverview(projectRoot) {
  const flags = readAccountFlags()
  const snaps = readSnapshots()
  const vms = listVms(projectRoot) || []
  const accounts = vms
    .filter((vm) => vm?.id && String(vm.id).startsWith('vm-gpt-'))
    .map((vm) => {
      const models = []
      for (const [key, snap] of snaps) {
        const [vmId, model] = key.split('\u0000')
        if (vmId !== vm.id) continue
        models.push({
          model,
          verdict: snap.verdict,
          blocks: snap.blocks,
          len: snap.len,
          issued_at: snap.issued_at,
          expires_at: snap.expires_at,
          proxy: snap.proxy,
          checked_at: snap.checked_at,
          http_status: snap.http_status,
          edge_ip: snap.edge_ip || null,
        })
      }
      if (models.length === 0) {
        models.push({ model: DEFAULT_MODEL, verdict: null, blocks: null, len: null })
      }
      models.sort((a, b) => String(a.model).localeCompare(String(b.model)))
      return {
        id: vm.id,
        name: vm.name || vm.id,
        status: vm.status || 'unknown',
        schedulable: vm.schedulable !== false,
        plan_type: vm?.codex?.plan_type || null,
        skip_harvest: flags.get(vm.id) === true,
        expected_blocks: expectedTurnStateBlocks(vm?.codex?.plan_type || null),
        proxy: vm?.proxy?.url || null,
        models,
      }
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return { accounts, events: readEvents(120) }
}

/** 读回一次 loopback 请求刚落库的门票。 */
function latestTicketRow(vmId, model, sinceIso) {
  return db()
    .prepare(
      `SELECT turn_state_verdict, turn_state_blocks, turn_state_len, turn_state_issued_at, status
       FROM usage_logs
       WHERE vm_id = ? AND model = ?
         AND datetime(replace(created_at,'T',' ')) >= datetime(replace(?,'T',' '))
         AND turn_state_verdict IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(vmId, model, sinceIso)
}

/**
 * 发一发上游请求并返回状态码与门票头。
 *
 * 身份头必须齐全（originator/version/OpenAI-Beta）——实测缺任意一个上游都不铸票，
 * 这也正是 worker 白名单那个 bug 的影响面。
 */
function mintShot({ edgeIp, proxyUrl, token, model, sessionId, state, prompt = null }) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model,
      instructions: 'Reply with exactly OK. Do not call tools.',
      stream: true,
      store: false,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt || 'Reply OK' }] }],
      parallel_tool_calls: false,
    })
    const agent = proxyUrl ? createSocksProxyAgent(proxyUrl) : undefined
    const headers = {
      Host: UPSTREAM_HOST,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Accept-Encoding': 'identity',
      'User-Agent': 'codex_cli_rs/0.160.0 (linux x86_64)',
      originator: 'codex_cli_rs',
      version: '0.160.0',
      'OpenAI-Beta': 'responses=experimental',
      'session-id': sessionId,
      session_id: sessionId,
    }
    if (state) headers['x-codex-turn-state'] = state
    const req = https.request(
      {
        host: edgeIp || UPSTREAM_HOST,
        port: 443,
        method: 'POST',
        path: '/backend-api/codex/responses',
        servername: UPSTREAM_HOST,
        agent,
        headers,
        timeout: 60_000,
      },
      (res) => {
        const next = res.headers['x-codex-turn-state'] || ''
        let peek = ''
        res.on('data', (chunk) => {
          if (peek.length < 4000) peek += chunk.toString('utf8')
        })
        res.on('end', () => {
          const modelEcho = /"model"\s*:\s*"([^"]+)"/.exec(peek)?.[1] || null
          resolve({ status: res.statusCode, state: next, model: modelEcho, preview: peek })
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('probe_timeout')))
    req.on('error', (error) => resolve({ status: 0, state: '', error: String(error?.message || error) }))
    req.end(payload)
  })
}

/**
 * 两发探针：先裸打铸票，再带票续接，看上游是否又发一张新票。
 *
 * 判据（对齐 sub2api 的 probe）：
 *   第一发无票            → no_ticket（上游根本不铸）
 *   第二发没有新票        → healthy（票延续正常 = 满血）
 *   第二发给了不同的新票  → degraded（票被拒后重铸 = 降智）
 *   第二发给了同一张票    → healthy_same
 */
export async function runTicketProbe({ projectRoot, vmId, model, edgeIp = null, policy: rawPolicy = null }) {
  const vm = getVm(projectRoot, vmId)
  if (!vm) return { ok: false, reason: 'vm_not_found' }
  const proxyUrl = vm?.proxy?.url || null
  const accounts = readCodexAccounts(projectRoot, vmId)
  const token = accounts.find((a) => a?.access_token)?.access_token
  if (!token) return { ok: false, reason: 'no_access_token' }
  const useModel = String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL
  const sessionId = `probe-${vmId}-${Date.now().toString(36)}`

  const shot1 = await mintShot({ edgeIp, proxyUrl, token, model: useModel, sessionId })
  const shot2 = shot1.state
    ? await mintShot({ edgeIp, proxyUrl, token, model: useModel, sessionId, state: shot1.state })
    : null

  let verdict
  if (!shot1.state) verdict = 'no_ticket'
  else if (!shot2 || !shot2.state) verdict = 'healthy'
  else if (shot2.state !== shot1.state) verdict = 'degraded'
  else verdict = 'healthy_same'

  recordEvent({
    kind: 'probe',
    vm_id: vmId,
    model: useModel,
    http_status: shot1.status || null,
    result: verdict === 'healthy' || verdict === 'healthy_same' ? 'ok' : 'fail',
    reason: verdict,
    detail: `shot1=${shot1.status}/${shot1.state.length} shot2=${shot2?.status ?? '-'}/${shot2?.state.length ?? '-'}`,
    proxy: proxyUrl,
    edge_ip: edgeIp,
  })
  if (shot1.state) {
    const judged = judgeTurnState(shot1.state, vm?.codex?.plan_type || null)
    recordSnapshot({
      vmId,
      model: useModel,
      verdict: judged.verdict,
      blocks: judged.blocks,
      len: judged.len,
      issuedAt: judged.issued_at,
      expiresAt: judged.issued_at
        ? new Date(Date.parse(judged.issued_at) + 3600_000).toISOString()
        : null,
      proxy: proxyUrl,
      httpStatus: shot1.status ?? null,
      edgeIp,
    })
  }

  let candy = null
  if ((shot1.state || shot2?.state) && rawPolicy?.candy_observation) {
    const shot = await mintShot({ edgeIp, proxyUrl, token, model: useModel, sessionId: `${sessionId}-candy`, prompt: CANDY_PROMPT })
    const answer = /\b(\d{1,4})\b/.exec(shot.preview || '')?.[1] ?? null
    candy = { http: shot.status, answer }
    recordEvent({
      kind: 'candy',
      vm_id: vmId,
      model: useModel,
      http_status: shot.status || null,
      result: 'ok',
      reason: answer ? `answer_${answer}` : 'no_number',
      detail: (shot.preview || '').slice(-160),
      proxy: proxyUrl,
      edge_ip: edgeIp,
    })
  }

  return {
    ok: verdict === 'healthy' || verdict === 'healthy_same',
    verdict,
    candy,
    shot1: { http: shot1.status, ticket_len: shot1.state.length, model: shot1.model },
    shot2: shot2 ? { http: shot2.status, new_ticket: !!shot2.state, ticket_len: shot2.state.length, model: shot2.model } : null,
    edge_ip: edgeIp,
  }
}

/**
 * 直连打票：指定目标边缘 IP，SNI 保持 chatgpt.com，出口仍用槽位自己的代理。
 *
 * 这正是 sub2api 的 `edge_ip` 思路 —— 换路由（连哪个 CF 边缘）而不换身份
 * （账号、token、出口 IP 全部不变）。经网关做不到这一点，因为目标 IP 由 DNS 决定。
 */
function mintViaEdge({ edgeIp, proxyUrl, token, model, sessionId }) {
  return new Promise((resolve) => {
    let payload
    try {
      payload = JSON.stringify({
        model,
        instructions: 'Reply with exactly OK. Do not call tools.',
        stream: true,
        store: false,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Reply OK' }] }],
        parallel_tool_calls: false,
      })
    } catch (error) {
      resolve({ ok: false, reason: String(error?.message || error) })
      return
    }
    const agent = proxyUrl ? createSocksProxyAgent(proxyUrl) : undefined
    const req = https.request(
      {
        host: edgeIp,
        port: 443,
        method: 'POST',
        path: '/backend-api/codex/responses',
        servername: UPSTREAM_HOST,
        agent,
        headers: {
          Host: UPSTREAM_HOST,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Accept-Encoding': 'identity',
          'session-id': sessionId,
          session_id: sessionId,
        },
        timeout: 60_000,
      },
      (res) => {
        const state = res.headers['x-codex-turn-state'] || null
        // 响应体只读到结束即可，票在 header 里。
        res.resume()
        res.on('end', () => {
          resolve({
            ok: res.statusCode === 200,
            status: res.statusCode,
            state,
            edge: edgeIp,
            proxy: proxyUrl || null,
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error('harvest_timeout'))
    })
    req.on('error', (error) => resolve({ ok: false, reason: String(error?.message || error), edge: edgeIp }))
    req.end(payload)
  })
}

/**
 * 手动打票：给一个账号一个模型铸一张票。
 * 返回 { ok, verdict, blocks, http_status, reason }。
 */
export async function runHarvest({ cfg, projectRoot, vmId, model, policy = null }) {
  const vm = getVm(projectRoot, vmId)
  if (!vm) {
    recordEvent({ kind: 'ticket', vm_id: vmId, model, result: 'fail', reason: 'vm_not_found' })
    return { ok: false, reason: 'vm_not_found' }
  }
  if (!String(vmId).startsWith('vm-gpt-')) {
    return { ok: false, reason: 'not_a_codex_slot' }
  }
  const useModel = String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL
  const startedAt = new Date(Date.now() - 5000).toISOString()
  const proxy = vm?.proxy?.url || null
  const planType = vm?.codex?.plan_type || null

  // ---- 直连模式：指定目标边缘 IP，SNI 保持 chatgpt.com，出口仍是槽位代理 ----
  const edgeIps = Array.isArray(policy?.edge_ips) ? policy.edge_ips : []
  if (policy?.edge_direct && edgeIps.length) {
    const accounts = readCodexAccounts(projectRoot, vmId)
    const token = accounts.find((a) => a?.access_token || a?.accessToken)?.access_token
      || accounts.find((a) => a?.accessToken)?.accessToken
    if (!token) {
      recordEvent({ kind: 'ticket', vm_id: vmId, model: useModel, result: 'fail', reason: 'no_access_token', proxy })
      return { ok: false, reason: 'no_access_token' }
    }
    const sessionId = `harvest-${Date.now().toString(36)}`
    let last = null
    for (const edgeIp of edgeIps) {
      const minted = await mintViaEdge({ edgeIp, proxyUrl: proxy, token, model: useModel, sessionId })
      last = minted
      const judged = minted.state ? judgeTurnState(minted.state, planType) : null
      const verdict = judged?.verdict || 'absent'
      const ttl = Number(policy?.ttl_seconds) || 3600
      const expiresAt = judged?.issued_at
        ? new Date(Date.parse(judged.issued_at) + ttl * 1000).toISOString()
        : null
      recordSnapshot({
        vmId,
        model: useModel,
        verdict,
        blocks: judged?.blocks ?? null,
        len: judged?.len ?? null,
        issuedAt: judged?.issued_at ?? null,
        expiresAt,
        proxy,
        httpStatus: minted.status ?? null,
        edgeIp,
      })
      recordEvent({
        kind: 'ticket',
        vm_id: vmId,
        model: useModel,
        http_status: minted.status ?? null,
        result: verdict === 'ok' ? 'ok' : 'fail',
        reason: verdict,
        detail: minted.reason || judged?.reason || null,
        proxy,
        edge_ip: edgeIp,
      })
      if (verdict === 'ok') {
        return {
          ok: true,
          mode: 'edge',
          edge_ip: edgeIp,
          http_status: minted.status ?? null,
          verdict,
          blocks: judged?.blocks ?? null,
          len: judged?.len ?? null,
          issued_at: judged?.issued_at ?? null,
        }
      }
    }
    return {
      ok: false,
      mode: 'edge',
      edge_ip: last?.edge ?? null,
      http_status: last?.status ?? null,
      verdict: 'absent',
      reason: last?.reason || 'no_ticket_from_any_edge',
      tried: edgeIps.length,
    }
  }

  let status = 0
  let detail = ''
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.api_key}`,
        'x-kin-vm': vmId,
      },
      body: JSON.stringify({
        model: useModel,
        input: TINY_PROMPT,
        stream: false,
        max_output_tokens: 16,
        reasoning: { effort: 'low' },
      }),
      signal: AbortSignal.timeout(90_000),
    })
    status = res.status
    const text = await res.text()
    detail = text.slice(0, 200)
  } catch (error) {
    const reason = String(error?.message || error).slice(0, 160)
    recordEvent({
      kind: 'probe',
      vm_id: vmId,
      model: useModel,
      result: 'fail',
      reason,
      proxy,
    })
    return { ok: false, reason }
  }

  // 打票请求本身走的是网关，票由网关侧采集；这里读回落库结果。
  const row = latestTicketRow(vmId, useModel, startedAt)
  const verdict = row?.turn_state_verdict || 'absent'
  const blocks = row?.turn_state_blocks ?? null
  const len = row?.turn_state_len ?? null
  const issuedAt = row?.turn_state_issued_at || null
  const judged = judgeTurnState(null, vm?.codex?.plan_type || null)
  const ttl = 3600
  const expiresAt = issuedAt ? new Date(Date.parse(issuedAt) + ttl * 1000).toISOString() : null

  recordSnapshot({
    vmId,
    model: useModel,
    verdict,
    blocks,
    len,
    issuedAt,
    expiresAt,
    proxy,
    httpStatus: status,
    edgeIp: null,
  })
  recordEvent({
    kind: 'ticket',
    vm_id: vmId,
    model: useModel,
    http_status: status,
    result: verdict === 'ok' ? 'ok' : 'fail',
    reason: verdict,
    detail: judged?.reason || null,
    proxy,
  })

  return {
    ok: status === 200 && verdict === 'ok',
    http_status: status,
    verdict,
    blocks,
    len,
    issued_at: issuedAt,
    detail,
  }
}
