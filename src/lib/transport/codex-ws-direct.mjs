/**
 * 出站 WebSocket transport（Codex Responses WS）。
 *
 * 为什么要有它：
 *   HTTP 每次新会话，前缀缓存几乎命中不了；WS 复用连接 + previous_response_id，
 *   实测第 3 发就能吃到 1024 token 缓存，TTFT 也从 2.58s 降到 2.17s。
 *
 * 协议要点（照真实客户端抓包还原，不要凭猜改）：
 *   1. 握手必须带 OpenAI-Beta: responses_websockets=2026-02-06
 *   2. 先发预热帧 { generate:false, input:[] }，服务端回 response.completed 给 response.id
 *   3. 再发真请求 { generate:true, previous_response_id }，正文走 response.output_text.delta
 *   4. 票在 codex.response.metadata.headers['x-codex-turn-state']（780 字符）
 *   5. 连接满 60 分钟会收到 websocket_connection_limit_reached，必须重连
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import wsPkg from 'ws'
import { SocksProxyAgent } from 'socks-proxy-agent'

const { WebSocket } = wsPkg

export const WS_BETA = 'responses_websockets=2026-02-06'
export const WS_PATH = '/backend-api/codex/responses'
export const WS_CLI_UA =
  'codex_exec/0.165.0 (Debian 12.0.0; x86_64) unknown (codex_exec; 0.165.0)'

/** 槽位是否走 WS：槽位字段优先，其次全局开关。默认关闭，避免未验证的链路影响业务。 */
export function wsTransportEnabled(vm, routing = null) {
  const slotFlag = vm?.transport?.upstream ?? vm?.codex?.transport?.upstream ?? null
  if (slotFlag === 'ws') return true
  if (slotFlag === 'http') return false
  return routing?.codex?.ticket?.ws_transport === true
}

function connect({ token, sessionId, timeoutMs = 15_000, agent = null }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://chatgpt.com${WS_PATH}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'OpenAI-Beta': WS_BETA,
        originator: 'codex_exec',
        version: '0.165.0',
        'User-Agent': WS_CLI_UA,
        'session-id': sessionId,
        'thread-id': sessionId,
        'x-codex-beta-features': 'remote_compaction_v2',
      },
      handshakeTimeout: timeoutMs,
      ...(agent ? { agent } : {}),
    })
    const timer = setTimeout(() => {
      try {
        ws.terminate()
      } catch {}
      reject(new Error('ws_handshake_timeout'))
    }, timeoutMs)
    ws.once('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function clientMetadata(sessionId, kind, model) {
  return {
    'x-codex-window-id': `${sessionId}:0`,
    session_id: sessionId,
    thread_id: sessionId,
    turn_id: kind === 'real' ? `${sessionId}` : '',
    ws_request_header_x_openai_internal_codex_responses_lite: 'true',
    'x-codex-turn-metadata': JSON.stringify({
      session_id: sessionId,
      thread_id: sessionId,
      window_id: `${sessionId}:0`,
      request_kind: kind,
      model,
    }),
  }
}

/**
 * 一次完整请求（内部自动预热）。返回：
 *   { events: AsyncIterable<{type, delta, turnState, responseId, usage}>, close() }
 * 调用方拿到 delta 就往下游写 SSE，拿到 response.completed 就收尾。
 */
export async function openWsTurn({ token, sessionId, model, timeoutMs = 180_000, agent = null }) {
  const ws = await connect({ token, sessionId, agent })
  const queued = []
  let notify = null
  let closed = false
  let error = null

  ws.on('message', (raw) => {
    let event = null
    try {
      event = JSON.parse(raw.toString())
    } catch {
      return
    }
    queued.push(event)
    notify?.()
  })
  ws.on('close', () => {
    closed = true
    notify?.()
  })
  ws.on('error', (err) => {
    error = err
    closed = true
    notify?.()
  })

  async function* drain(signal) {
    while (true) {
      if (signal?.aborted) return
      if (queued.length) {
        yield normalize(queued.shift())
        continue
      }
      if (error) throw error
      if (closed) return
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 500)
        notify = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      notify = null
    }
  }

  function normalize(event) {
    const turnState = event?.headers?.['x-codex-turn-state'] || null
    return {
      type: event?.type || 'unknown',
      delta: typeof event?.delta === 'string' ? event.delta : event?.delta?.text || null,
      turnState: turnState ? String(turnState) : null,
      responseId: event?.response?.id || event?.response_id || null,
      usage: event?.response?.usage || null,
      raw: event,
    }
  }

  function send(body) {
    ws.send(JSON.stringify(body))
  }

  // 预热：拿 response.id 建立会话上下文
  send({
    type: 'response.create',
    model,
    stream: true,
    input: [],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: 'low', context: 'all_turns' },
    store: false,
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: sessionId,
    text: { verbosity: 'low' },
    generate: false,
    client_metadata: clientMetadata(sessionId, 'prewarm', model),
  })

  let prewarmId = null
  const deadline = Date.now() + timeoutMs
  for await (const event of drain()) {
    if (event.responseId) prewarmId = event.responseId
    if (event.type === 'response.completed') break
    if (Date.now() > deadline) throw new Error('ws_prewarm_timeout')
  }

  return {
    prewarmId,
    /** 发真实请求，返回事件流。 */
    async *stream({ input, instructions, effort = 'medium', maxOutputTokens = null, signal = null }) {
      const body = {
        type: 'response.create',
        model,
        stream: true,
        previous_response_id: prewarmId,
        input,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        reasoning: { effort, context: 'all_turns' },
        store: false,
        include: ['reasoning.encrypted_content'],
        prompt_cache_key: sessionId,
        text: { verbosity: 'low' },
        generate: true,
        client_metadata: clientMetadata(sessionId, 'real', model),
      }
      if (instructions) body.instructions = instructions
      if (maxOutputTokens) body.max_output_tokens = maxOutputTokens
      send(body)
      for await (const event of drain(signal)) {
        yield event
        if (event.type === 'response.completed' || event.type === 'response.failed') return
        if (event.type === 'error') return
      }
    },
    close() {
      try {
        ws.close()
      } catch {}
    },
  }
}

/** 与 kernel 直连一致的凭证位置：<slot>/codex-credentials.json */
function credentialFile(exec) {
  const base = exec?.homeDir ? path.dirname(exec.homeDir) : null
  return base ? path.join(base, 'codex-credentials.json') : null
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

function socksAgent(exec) {
  const url = String(exec?.vm?.proxy?.url || exec?.vm?.proxy_url || '').trim()
  if (!url) return null
  try {
    return new SocksProxyAgent(url)
  } catch {
    return null
  }
}

/** 把客户端 Responses body 转成 WS 的 input 数组（WS 不接受字符串 input）。 */
function toWsInput(body) {
  const raw = body?.input
  if (Array.isArray(raw) && raw.length) return raw
  if (typeof raw === 'string' && raw.trim()) {
    return [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: raw }] }]
  }
  return []
}

/**
 * 与 streamCodexKernelDirect 同接口的 WS 版本：
 * 逐条把 WS 事件转成 SSE 行（`data: {...}`）喂给 onEvent，
 * 这样上层的解析、记账、终止判断都不用改。
 */
export async function streamCodexWsDirect(args = {}) {
  const exec = args.exec || {}
  const credential = readCredential(exec)
  if (!credential?.access) {
    return { ok: false, status: 401, headers: {}, body: { error: { code: 'no_access_token' } } }
  }
  const body = args.body || {}
  const model = String(body.model || exec?.vm?.policy?.models?.[0] || 'gpt-6-astra')
  const sessionId = String(args.envelope?.session?.session_id || exec?.vm?.id || crypto.randomUUID())
  const agent = socksAgent(exec)

  const turn = await openWsTurn({ token: credential.access, sessionId, model, agent })
  let status = 200
  let ticket = null
  let sawCompleted = false
  const usageHolder = { usage: null }

  try {
    for await (const event of turn.stream({
      input: toWsInput(body),
      instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
      effort: body?.reasoning?.effort || 'medium',
      maxOutputTokens: body?.max_output_tokens || null,
      signal: args.signal,
    })) {
      if (event.turnState) ticket = event.turnState
      if (event.usage) usageHolder.usage = event.usage
      if (event.type === 'response.completed') sawCompleted = true
      // 原样转成 SSE 行，上层按既有逻辑解析
      if (typeof args.onEvent === 'function') await args.onEvent(`data: ${JSON.stringify(event.raw)}\n`)
    }
  } catch (error) {
    status = 502
    return {
      ok: false,
      status,
      headers: ticket ? { 'x-codex-turn-state': ticket } : {},
      body: { error: { code: 'ws_transport_error', message: String(error?.message || error) } },
      transportError: true,
    }
  } finally {
    turn.close()
  }

  return {
    ok: sawCompleted,
    status,
    headers: ticket ? { 'x-codex-turn-state': ticket } : {},
    body: { usage: usageHolder.usage },
    usage: usageHolder.usage,
    missing_response_completed: !sawCompleted,
  }
}
