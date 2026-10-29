/**
 * Codex 直连 hop —— `kin-codex-kernel` 的 drop-in 替代实现。
 *
 * 为什么要有它：kernel 是预编译二进制，配置项只有 upstream_transport /
 * user_agent / client_features / analytics，**不能追加自定义请求头**；
 * 而实测上游必须看到 originator / version / OpenAI-Beta 才铸
 * x-codex-turn-state（缺了就不铸票、请求被降档，表现为「降智商」）。
 *
 * 所以这里自己发上游：同一份 args、同一个返回结构，只是把身份头、token、
 * 出口代理和 SSE 解析全握在自己手里。默认关闭，用 KIN_CODEX_DIRECT=1 打开。
 */
import https from 'node:https'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import path from 'node:path'
import { createSocksProxyAgent } from '../vm/proxy-agent.mjs'
import { refreshCodexAccessToken } from '../protocol/codex-models.mjs'
import { pickTicket } from '../admin/ticket-borrow.mjs'

const UPSTREAM_HOST = 'chatgpt.com'
const UPSTREAM_PATH = '/backend-api/codex/responses'
// 上游看到的是「槽位（Debian 12 / Linux 6.x）发起连接」，所以身份必须是 Linux CLI。
// 把客户端的 Desktop(Mac) 原样透传，等于告诉上游「Mac 桌面端从机房 IP 发请求」，
// 指纹自相矛盾；实测透传 Desktop 也不可行。
const LINUX_OS = 'Linux 6.12.111+deb13-amd64'
const CLI_VERSION = '0.165.0'
const CLI_ORIGINATOR = 'codex_exec'
const DEFAULT_UA = `${CLI_ORIGINATOR}/${CLI_VERSION} (${LINUX_OS}; x86_64)`
const IDENTITY = {
  originator: CLI_ORIGINATOR,
  version: CLI_VERSION,
  'openai-beta': 'responses=experimental',
}

/** 这些头从网关侧透传（客户端发什么就用什么）。 */
const FORWARD = [
  'originator',
  'version',
  'openai-beta',
  'session-id',
  'session_id',
  'thread-id',
  'x-client-request-id',
  'x-codex-beta-features',
  'x-codex-installation-id',
  'x-codex-parent-thread-id',
  'x-codex-turn-metadata',
  'x-codex-turn-state',
  'x-codex-window-id',
  'x-openai-internal-codex-responses-lite',
  'x-openai-memgen-request',
  'x-openai-subagent',
  'chatgpt-account-id',
  'accept-language',
]

function credentialFile(exec) {
  const base = exec?.homeDir ? path.dirname(exec.homeDir) : null
  return base ? path.join(base, 'codex-credentials.json') : null
}

/**
 * 刷新后的 token 回写凭证文件。
 * kernel 以前替我们做这件事；不回写的话每个请求都会再刷新一次，等于自造 401 风暴。
 */
function persistAccessToken(exec, accessToken) {
  const file = credentialFile(exec)
  if (!file || !accessToken) return
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const accounts = Array.isArray(raw?.accounts) ? raw.accounts : []
    if (!accounts.length) return
    accounts[0].access_token = accessToken
    accounts[0].expires_at = null
    fs.writeFileSync(file, JSON.stringify({ ...raw, accounts }, null, 2), { mode: 0o600 })
  } catch {}
}

/**
 * 把上游错误归一成网关认识的形状：
 *   FastAPI 的 {detail:"..."}  → { error: { type, code, message } }
 * 否则 isCodexFailoverError 拿不到 code，换槽逻辑会失效。
 */
function normalizeErrorBody(status, parsed) {
  if (parsed?.error?.message) return parsed
  const detail = parsed?.detail || parsed?.message || ''
  const message = typeof detail === 'string' ? detail : JSON.stringify(detail)
  const code =
    /store must be set to false/i.test(message)
      ? 'invalid_request_error'
      : status === 401 || status === 403
        ? 'upstream_auth'
        : status === 429
          ? 'usage_limit_reached'
          : status >= 500
            ? 'server_error'
            : 'upstream_status'
  return { ...parsed, error: { type: 'upstream_error', code, message } }
}

function readCredential(exec) {
  const file = credentialFile(exec)
  if (!file) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const account = Array.isArray(raw?.accounts) ? raw.accounts[0] : null
    if (!account) return null
    return {
      access: String(account.access_token || account.accessToken || ''),
      refresh: String(account.refresh_token || account.refreshToken || ''),
      plan: String(account.plan_type || ''),
    }
  } catch {
    return null
  }
}

/**
 * 只取 IPv4：住宅代理基本不支持 IPv6，而 chatgpt.com 的 AAAA 会优先被解析，
 * 走 SOCKS 时会直接 HostUnreachable。这里自己解析 A 记录并缓存 5 分钟。
 */
let cachedEdge = { at: 0, ip: '' }
async function resolveIPv4() {
  if (cachedEdge.ip && Date.now() - cachedEdge.at < 300_000) return cachedEdge.ip
  const list = await dns.resolve4(UPSTREAM_HOST)
  const ip = Array.isArray(list) ? list[0] : ''
  if (ip) cachedEdge = { at: Date.now(), ip }
  return ip
}

function proxyUrlOf(exec) {
  const vm = exec?.vm || {}
  return String(vm?.proxy?.url || vm?.proxy_url || '').trim()
}

/**
 * 业务请求注入门票：只有票库里「已验证」的票才会被注入，
 * 未验证/过期的票一律不注入（宁可不带，也不带坏票）。
 */
function ticketFor(args) {
  const vmId = args?.exec?.vmId || args?.exec?.vm?.id
  const model = args?.body?.model
  if (!vmId || !model) return null
  if (args?.routing?.codex?.ticket?.inject !== true) return null
  try {
    return pickTicket({ vmId, model })
  } catch {
    return null
  }
}

function buildHeaders(args, token) {
  const envelopeHeaders = args?.envelope?.headers || {}
  const headers = {}
  for (const name of FORWARD) {
    const value = envelopeHeaders[name]
    if (typeof value === 'string' && value.trim()) headers[name] = value
  }
  const sessionId = args?.envelope?.session?.session_id
  if (typeof sessionId === 'string' && sessionId) headers['session-id'] = sessionId
  // 身份三件套一律归一到 Linux CLI 档案（客户端值只在没有默认档案时兜底）。
  headers.originator = CLI_ORIGINATOR
  headers.version = CLI_VERSION
  for (const [name, value] of Object.entries(IDENTITY)) {
    if (!headers[name]) headers[name] = value
  }
  const ticket = ticketFor(args)
  if (ticket?.state && !headers['x-codex-turn-state']) {
    headers['x-codex-turn-state'] = ticket.state
    if (ticket.cookies?.length) headers.Cookie = ticket.cookies.join('; ')
  }
  // UA 与 version 必须来自客户端本体：originator 说是 Desktop/Mac，UA 却写
  // codex_cli_rs/linux 会被上游当成伪造客户端。缺 UA 时才用默认值。
  const ua = String(args?.envelope?.options?.user_agent || '').trim() || DEFAULT_UA
  // 我们改写 session-id 时，window-id 与 turn-metadata 里的会话字段必须一起换，
  // 否则上游会看到「session-id 是 A，thread/window/metadata 还是 B」的两套会话。
  const sid = headers['session-id']
  if (sid && typeof headers['x-codex-window-id'] === 'string') {
    const suffix = headers['x-codex-window-id'].includes(':')
      ? headers['x-codex-window-id'].slice(headers['x-codex-window-id'].lastIndexOf(':'))
      : ''
    headers['x-codex-window-id'] = `${sid}${suffix}`
  }
  if (sid && typeof headers['x-codex-turn-metadata'] === 'string') {
    try {
      const meta = JSON.parse(headers['x-codex-turn-metadata'])
      const suffix = String(meta.window_id || '').includes(':')
        ? String(meta.window_id).slice(String(meta.window_id).lastIndexOf(':'))
        : ''
      if (meta.session_id) meta.session_id = sid
      if (meta.thread_id) meta.thread_id = sid
      if (meta.window_id) meta.window_id = `${sid}${suffix}`
      // 槽位是 Linux，元数据里的平台信息不能残留 mac/desktop 字样。
      for (const key of ['os', 'platform', 'terminal', 'client', 'app']) {
        if (typeof meta[key] === 'string' && /mac|darwin|desktop|windows/i.test(meta[key])) delete meta[key]
      }
      headers['x-codex-turn-metadata'] = JSON.stringify(meta)
    } catch {}
  }
  return {
    Host: UPSTREAM_HOST,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'Accept-Encoding': 'identity',
    'User-Agent': ua,
    ...headers,
  }
}

/** 发一次上游请求，按 SSE 逐行回调。 */
async function sendUpstream({ body, headers, proxyUrl, timeoutMs, idleTimeoutMs, onLine, signal }) {
  const dialIp = await resolveIPv4().catch(() => '')
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const agent = proxyUrl ? createSocksProxyAgent(proxyUrl) : undefined
    const startedAt = Date.now()
    let firstByteMs = null
    let ttftMs = null
    let sawCompleted = false
    let sawData = false
    let settled = false
    let lastDataAt = Date.now()
    let heartbeat = null

    const finish = (result) => {
      if (settled) return
      settled = true
      if (heartbeat) clearInterval(heartbeat)
      resolve({
        ...result,
        firstByteMs,
        ttftMs,
        generationMs: Date.now() - (startedAt + (ttftMs ?? 0)),
        saw_completed: sawCompleted,
      })
    }

    const req = https.request(
      {
        host: dialIp || UPSTREAM_HOST,
        servername: UPSTREAM_HOST,
        port: 443,
        method: 'POST',
        path: UPSTREAM_PATH,
        agent,
        headers,
        timeout: timeoutMs || 600_000,
      },
      (res) => {
        const responseHeaders = { ...res.headers }
        if (res.statusCode !== 200) {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            let parsed = {}
            try {
              parsed = JSON.parse(text)
            } catch {
              parsed = { detail: text.slice(0, 500) }
            }
            finish({
              ok: false,
              status: res.statusCode,
              headers: responseHeaders,
              body: normalizeErrorBody(res.statusCode, parsed),
              committed: false,
            })
          })
          res.on('error', () =>
            finish({ ok: false, status: 0, headers: responseHeaders, body: {}, transportError: true }),
          )
          return
        }

        let buffer = ''
        res.setEncoding('utf8')
        if (firstByteMs == null) firstByteMs = Date.now() - startedAt

        // 思考期上游可能长时间不发数据：给客户端打 SSE 注释心跳，别让客户端读超时。
        heartbeat = setInterval(() => {
          if (settled || Date.now() - lastDataAt < 15_000) return
          try {
            onLine(': keepalive')
          } catch {}
        }, 15_000)

        res.on('data', (chunk) => {
          lastDataAt = Date.now()
          if (firstByteMs == null) firstByteMs = Date.now() - startedAt
          buffer += chunk
          let idx
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).replace(/\r$/, '')
            buffer = buffer.slice(idx + 1)
            if (!sawData && /"type"\s*:\s*"response\.(output_text|reasoning|output_item)\./.test(line)) {
              sawData = true
              ttftMs = Date.now() - startedAt
            }
            if (line.includes('response.completed')) sawCompleted = true
            try {
              onLine(line)
            } catch {}
          }
        })

        // 上游被重置/中断：必须结束 Promise，否则网关会挂到超时才断流。
        res.on('aborted', () =>
          finish({
            ok: false,
            status: 0,
            headers: responseHeaders,
            body: {},
            committed: sawData,
            terminalState: 'incomplete',
            transportError: !sawData,
            error: 'upstream_aborted',
          }),
        )
        res.on('error', (error) =>
          finish({
            ok: false,
            status: 0,
            headers: responseHeaders,
            body: {},
            committed: sawData,
            terminalState: 'incomplete',
            transportError: !sawData,
            error: String(error?.message || error),
          }),
        )
        res.on('end', () => {
          if (buffer) {
            if (buffer.includes('response.completed')) sawCompleted = true
            try {
              onLine(buffer)
            } catch {}
          }
          if (!sawCompleted) {
            // 没有终止事件 = 流被截断，不能当成功返回（客户端会报 stream closed）。
            finish({
              ok: false,
              status: 200,
              headers: responseHeaders,
              body: {},
              committed: sawData,
              terminalState: 'incomplete',
              transportError: false,
              error: 'missing_response_completed',
            })
            return
          }
          finish({
            ok: true,
            status: 200,
            headers: responseHeaders,
            body: {},
            committed: true,
            terminalState: 'completed',
          })
        })
      },
    )

    // 直连不做短空闲掐断：上游思考期静默是正常的，靠整体超时兜底。
    const cap = Math.max(Number(timeoutMs) || 600_000, 60_000)
    req.setTimeout(cap, () => req.destroy(new Error('codex_direct_timeout')))
    if (signal) {
      signal.addEventListener('abort', () => req.destroy(new Error('client_cancelled')), { once: true })
    }
    req.on('error', (error) =>
      finish({
        ok: false,
        status: 0,
        headers: {},
        body: {},
        transportError: true,
        error: String(error?.message || error),
      }),
    )
    req.end(payload)
  })
}

/**
 * 与 streamCodexKernel 同签名：接收 handle-codex 组装的 args，返回同一个结构。
 */
export async function streamCodexKernelDirect(args = {}) {
  const exec = args.exec || {}
  // 上游强制要求 store=false（否则 400 "Store must be set to false"）；
  // stream 必须是 true 才走 SSE。kernel 以前替我们补这两项。
  const body = { ...(args.body || {}), store: false, stream: true }
  const credential = readCredential(exec)
  if (!credential?.access) {
    return { ok: false, status: 401, headers: {}, body: { error: { code: 'no_access_token', message: 'no codex credentials' } } }
  }
  const proxyUrl = proxyUrlOf(exec)
  const lines = []
  const onLine = async (line) => {
    lines.push(line)
    if (typeof args.onEvent === 'function') await args.onEvent(line)
  }

  let result = await sendUpstream({
    body,
    headers: buildHeaders(args, credential.access),
    proxyUrl,
    timeoutMs: args.timeoutMs,
    idleTimeoutMs: args.idleTimeoutMs,
    onLine,
    signal: args.signal,
  })

  // 401 时用 refresh_token 换一次，再重试一发。
  if (!result.ok && result.status === 401 && credential.refresh) {
    const refreshed = await refreshCodexAccessToken({ refreshToken: credential.refresh, proxyUrl }).catch(() => null)
    const nextAccess = refreshed?.access_token || refreshed?.accessToken || ''
    if (nextAccess) {
      persistAccessToken(exec, nextAccess)
      result = await sendUpstream({
        body,
        headers: buildHeaders(args, nextAccess),
        proxyUrl,
        timeoutMs: args.timeoutMs,
        idleTimeoutMs: args.idleTimeoutMs,
        onLine,
        signal: args.signal,
      })
    }
  }

  return {
    ...result,
    via: 'codex-direct',
    injected_ticket: Boolean(args?.routing?.codex?.ticket?.inject === true && ticketFor(args)?.state),
    // 门票就在响应头里，原样带出给上层采集与判定。
    headers: result.headers || {},
  }
}

export async function codexDirectHealth() {
  return { ok: true, source: 'codex-direct' }
}
