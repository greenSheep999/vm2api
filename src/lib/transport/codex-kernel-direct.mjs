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

const UPSTREAM_HOST = 'chatgpt.com'
const UPSTREAM_PATH = '/backend-api/codex/responses'
const DEFAULT_UA = 'codex_cli_rs/0.160.0 (linux x86_64)'
const IDENTITY = {
  originator: 'codex_cli_rs',
  version: '0.160.0',
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
]

function readCredential(exec) {
  const base = exec?.homeDir ? path.dirname(exec.homeDir) : null
  const file = base ? path.join(base, 'codex-credentials.json') : null
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

function buildHeaders(args, token) {
  const envelopeHeaders = args?.envelope?.headers || {}
  const headers = {}
  for (const name of FORWARD) {
    const value = envelopeHeaders[name]
    if (typeof value === 'string' && value.trim()) headers[name] = value
  }
  const sessionId = args?.envelope?.session?.session_id
  if (typeof sessionId === 'string' && sessionId) headers['session-id'] = sessionId
  for (const [name, value] of Object.entries(IDENTITY)) {
    if (!headers[name]) headers[name] = value
  }
  const ua = String(args?.envelope?.options?.user_agent || '').trim() || DEFAULT_UA
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
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve({ ...result, firstByteMs, ttftMs, generationMs: Date.now() - (startedAt + (ttftMs ?? 0)) })
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
              parsed = { error: { message: text.slice(0, 500) } }
            }
            finish({ ok: false, status: res.statusCode, headers: responseHeaders, body: parsed, committed: false })
          })
          return
        }
        let buffer = ''
        let sawContent = false
        res.setEncoding('utf8')
        if (firstByteMs == null) firstByteMs = Date.now() - startedAt
        res.on('data', (chunk) => {
          if (firstByteMs == null) firstByteMs = Date.now() - startedAt
          buffer += chunk
          let idx
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).replace(/\r$/, '')
            buffer = buffer.slice(idx + 1)
            if (!sawContent && /"type"\s*:\s*"response\.(output_text|reasoning|output_item)\./.test(line)) {
              sawContent = true
              ttftMs = Date.now() - startedAt
            }
            try {
              onLine(line)
            } catch {}
          }
        })
        res.on('end', () => {
          if (buffer) {
            try {
              onLine(buffer)
            } catch {}
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
    const idle = Number(idleTimeoutMs) || 0
    if (idle > 0) {
      req.setTimeout(idle, () => req.destroy(new Error('codex_direct_idle_timeout')))
    }
    if (signal) {
      signal.addEventListener('abort', () => req.destroy(new Error('client_cancelled')), { once: true })
    }
    req.on('error', (error) => finish({ ok: false, status: 0, headers: {}, body: {}, transportError: true, error: String(error?.message || error) }))
    req.end(payload)
  })
}

/**
 * 与 streamCodexKernel 同签名：接收 handle-codex 组装的 args，返回同一个结构。
 */
export async function streamCodexKernelDirect(args = {}) {
  const exec = args.exec || {}
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
    body: args.body,
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
      result = await sendUpstream({
        body: args.body,
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
    // 门票就在响应头里，原样带出给上层采集与判定。
    headers: result.headers || {},
  }
}

export async function codexDirectHealth() {
  return { ok: true, source: 'codex-direct' }
}
