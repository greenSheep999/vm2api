/**
 * Codex hop routing. Claude traffic never reads this object.
 */
import { isCodexVm } from '../vm/vm-kind.mjs'
import { normalizeOpenAIQuotaPolicy } from '../pool/openai-quota-policy.mjs'
import { normalizeCodexModelMappings, validateCodexModelMappingsPatch } from './codex-model-mapping.mjs'

export { isCodexVm, normalizeVmKind } from '../vm/vm-kind.mjs'

export const DEFAULT_CODEX_USER_AGENT = 'codex_cli_rs/0.160.0 (linux x86_64)'
export const CODEX_UPSTREAM_TRANSPORTS = Object.freeze(['prefer_websocket', 'http'])

export const DEFAULT_INFERENCE_WEBSOCKET = Object.freeze({ enabled: true })

/**
 * 门票（打票）策略。字段对齐 sub2api 的 OpenAICodexTicketConfig，
 * 但我们先只做「检测 + 策略登记」，harvest 执行器后续接。
 */
export const DEFAULT_CODEX_TICKET = Object.freeze({
  enabled: false,
  models: Object.freeze([]),
  /** 0 = 按套餐自动（个人 10 块 / Team 12 块）。 */
  target_blocks: 0,
  ttl_seconds: 3600,
  refresh_before_seconds: 300,
  fail_closed: false,
  harvest_interval_seconds: 3600,
  harvest_cooldown_seconds: 600,
  max_probes_per_round: 3,
  /** 打票用的备用出口（socks5:// / http://）。空 = 只用槽位绑定的代理。 */
  harvest_proxies: Object.freeze([]),
  /**
   * 直连模式：指定目标 Cloudflare 边缘 IP 打票（SNI 仍是 chatgpt.com、出口仍用槽位代理）。
   * 这是打票最有效的杠杆 —— 换路由但不换身份。
   */
  edge_direct: false,
  /** 候选边缘节点；空 = 由 DNS 决定（等价于现状）。 */
  edge_ips: Object.freeze([]),
  /** 票被真实请求用过之后，异步补一发糖果题，只记录能力值，不参与判定。 */
  candy_observation: false,
  /** 无有效票时把账号移出调度（sub 的「无票时暂停目标模型」）。 */
  gate_scheduling: false,
  /** 定时探针间隔（秒）；0 = 关闭自动探针。 */
  probe_interval_seconds: 0,
  /** 探针判定 degraded 时自动降权（默认关闭，先观察）。 */
  auto_park: false,
  /** 业务请求注入票库中「已验证」的门票（默认关闭）。 */
  inject: false,
})

export function normalizeCodexTicketPolicy(raw = {}) {
  const src = asObject(raw) || {}
  const models = Array.isArray(src.models)
    ? Array.from(
        new Set(
          src.models
            .map((m) => String(m || '').trim())
            .filter((m) => m && m.length <= 100),
        ),
      ).slice(0, 16)
    : []
  const int = (value, fallback, min, max) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, Math.floor(n)))
  }
  return {
    enabled: src.enabled === true,
    models,
    target_blocks: int(src.target_blocks, 0, 0, 64),
    ttl_seconds: int(src.ttl_seconds, DEFAULT_CODEX_TICKET.ttl_seconds, 60, 86_400),
    refresh_before_seconds: int(
      src.refresh_before_seconds,
      DEFAULT_CODEX_TICKET.refresh_before_seconds,
      0,
      3600,
    ),
    fail_closed: src.fail_closed === true,
    harvest_interval_seconds: int(
      src.harvest_interval_seconds,
      DEFAULT_CODEX_TICKET.harvest_interval_seconds,
      60,
      86_400,
    ),
    harvest_cooldown_seconds: int(
      src.harvest_cooldown_seconds,
      DEFAULT_CODEX_TICKET.harvest_cooldown_seconds,
      0,
      86_400,
    ),
    max_probes_per_round: int(
      src.max_probes_per_round,
      DEFAULT_CODEX_TICKET.max_probes_per_round,
      1,
      32,
    ),
    edge_direct: src.edge_direct === true,
    candy_observation: src.candy_observation === true,
    gate_scheduling: src.gate_scheduling === true,
    probe_interval_seconds: int(src.probe_interval_seconds, 0, 0, 86_400),
    auto_park: src.auto_park === true,
    inject: src.inject === true,
    edge_ips: Array.isArray(src.edge_ips)
      ? src.edge_ips
          .map((ip) => String(ip || '').trim())
          .filter((ip) => /^[0-9a-fA-F:.]+$/.test(ip) && ip.length <= 45)
          .slice(0, 24)
      : [],
    harvest_proxies: Array.isArray(src.harvest_proxies)
      ? src.harvest_proxies
          .map((url) => String(url || '').trim())
          .filter((url) => /^(socks5h?|https?):\/\//i.test(url) && url.length <= 300)
          .slice(0, 20)
      : [],
  }
}

export const DEFAULT_CODEX_ROUTING = Object.freeze({
  enabled: true,
  // `auto` resolves the official Codex catalog client version at sync time,
  // falling back to 0.160.0 when the registry is unavailable.
  catalog_client_version: 'auto',
  user_agent: DEFAULT_CODEX_USER_AGENT,
  /**
   * 直连模式：绕过预编译 codex kernel，由 Node 直接发上游。
   * 只有直连才能带全身份头（originator/version/OpenAI-Beta），
   * 上游才会铸 x-codex-turn-state —— 这是拿回「满血档位」的前提。
   */
  direct: false,
  ticket: DEFAULT_CODEX_TICKET,
  upstream_transport: 'prefer_websocket',
  websocket: { enabled: true },
  client_features: { enabled: false },
  analytics: { enabled: false },
  protocols: {
    'openai.responses': { mode: 'native', enabled: true },
    'openai.chat': { mode: 'convert', enabled: true },
    'openai.completions': { mode: 'convert', enabled: true },
    'anthropic.messages': { mode: 'reject', enabled: false },
  },
  convert: {
    chat_to_codex: true,
    completions_to_codex: true,
    anthropic_to_codex: false,
  },
  clients: {
    official_codex: 'allow',
    openai_compatible: 'allow',
    claude_code: 'reject',
    unknown: 'allow',
  },
  quota: normalizeOpenAIQuotaPolicy(),
})

function typedError(message, code) {
  const error = new TypeError(message)
  error.code = code
  return error
}

function asObject(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
}

function normalizeEnabledToggle(raw, defaultEnabled) {
  const src = asObject(raw) || {}
  return { enabled: defaultEnabled ? src.enabled !== false : src.enabled === true }
}

export function normalizeInferenceWebsocket(raw = {}) {
  return normalizeEnabledToggle(raw, true)
}

function normalizeUserAgent(raw) {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_CODEX_USER_AGENT
}

function normalizeUpstreamTransport(raw) {
  return CODEX_UPSTREAM_TRANSPORTS.includes(raw) ? raw : 'prefer_websocket'
}

function validateEnabledToggle(raw, path, code) {
  if (!asObject(raw)) throw typedError(`${path} 必须是对象`, code)
  if (Object.prototype.hasOwnProperty.call(raw, 'enabled') && typeof raw.enabled !== 'boolean') {
    throw typedError(`${path}.enabled 必须是布尔`, code)
  }
}

/** PUT /api/panel/routing strict checks. Loaded files still go through normalize. */
export function validateInferenceWebsocketPatch(body = {}) {
  if (!asObject(body)) return
  if (Object.prototype.hasOwnProperty.call(body, 'websocket')) {
    validateEnabledToggle(body.websocket, 'websocket', 'invalid_websocket')
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'codex')) return
  if (!asObject(body.codex)) throw typedError('codex 必须是对象', 'invalid_codex_websocket')
  const codex = body.codex
  if (Object.prototype.hasOwnProperty.call(codex, 'websocket')) {
    validateEnabledToggle(codex.websocket, 'codex.websocket', 'invalid_codex_websocket')
  }
  if (Object.prototype.hasOwnProperty.call(codex, 'upstream_transport')) {
    if (!CODEX_UPSTREAM_TRANSPORTS.includes(codex.upstream_transport)) {
      throw typedError('codex.upstream_transport 必须是 prefer_websocket 或 http', 'invalid_upstream_transport')
    }
  }
  if (Object.prototype.hasOwnProperty.call(codex, 'user_agent')) {
    if (typeof codex.user_agent !== 'string' || !codex.user_agent.trim()) {
      throw typedError('codex.user_agent 必须是非空字符串', 'invalid_user_agent')
    }
  }
  if (Object.prototype.hasOwnProperty.call(codex, 'client_features')) {
    validateEnabledToggle(codex.client_features, 'codex.client_features', 'invalid_client_features')
  }
  if (Object.prototype.hasOwnProperty.call(codex, 'analytics')) {
    validateEnabledToggle(codex.analytics, 'codex.analytics', 'invalid_codex_analytics')
  }
  if (Object.prototype.hasOwnProperty.call(codex, 'model_mappings')) {
    validateCodexModelMappingsPatch(codex.model_mappings)
  }
}

export function inferenceWebsocketEnabled(routing = {}) {
  return asObject(routing.websocket)?.enabled !== false && asObject(routing.codex?.websocket)?.enabled !== false
}

export function computedUpstreamTransport(routing = {}) {
  return inferenceWebsocketEnabled(routing) ? normalizeUpstreamTransport(routing.codex?.upstream_transport) : 'http'
}

export function normalizeCodexRouting(raw = {}) {
  const src = asObject(raw) || {}
  const protocols = { ...DEFAULT_CODEX_ROUTING.protocols, ...(src.protocols || {}) }
  for (const key of Object.keys(protocols)) {
    const item = protocols[key] || {}
    const mode = ['native', 'convert', 'reject'].includes(item.mode) ? item.mode : 'reject'
    protocols[key] = { mode, enabled: item.enabled !== false && mode !== 'reject' }
  }
  const clients = { ...DEFAULT_CODEX_ROUTING.clients, ...(src.clients || {}) }
  for (const [key, value] of Object.entries(clients)) {
    clients[key] = value === 'allow' ? 'allow' : 'reject'
  }
  return {
    enabled: src.enabled !== false,
    catalog_client_version:
      typeof src.catalog_client_version === 'string' && src.catalog_client_version.trim()
        ? src.catalog_client_version.trim()
        : 'auto',
    user_agent: normalizeUserAgent(src.user_agent),
    direct: src.direct === true,
    upstream_transport: normalizeUpstreamTransport(src.upstream_transport),
    websocket: normalizeEnabledToggle(src.websocket, true),
    client_features: normalizeEnabledToggle(src.client_features, false),
    analytics: normalizeEnabledToggle(src.analytics, false),
    protocols,
    convert: {
      chat_to_codex: src.convert?.chat_to_codex !== false,
      completions_to_codex: src.convert?.completions_to_codex !== false,
      anthropic_to_codex: src.convert?.anthropic_to_codex === true,
    },
    clients,
    quota: normalizeOpenAIQuotaPolicy(src.quota),
    ticket: normalizeCodexTicketPolicy(src.ticket),
    model_mappings: normalizeCodexModelMappings(src.model_mappings),
  }
}

export function isCodexProtocolAllowed(protocol, routing = {}) {
  const codex = normalizeCodexRouting(routing.codex || routing)
  if (!codex.enabled) return { ok: false, code: 'codex_disabled', mode: 'reject' }
  const entry = codex.protocols[protocol]
  if (!entry || entry.enabled === false || entry.mode === 'reject') {
    return { ok: false, code: 'protocol_not_allowed', mode: 'reject' }
  }
  return { ok: true, mode: entry.mode }
}

export function listCodexVms(vms = []) {
  return (vms || []).filter((vm) => isCodexVm(vm))
}
