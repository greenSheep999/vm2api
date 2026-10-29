export type OpsTicketBucket = { verdict: string; n: number }
export type OpsTicketSlot = { vm_id: string; verdict: string; n: number }
export type OpsEffortBucket = { asked: string; got: string; n: number }

export type OpsTicketAccount = {
  vm_id: string | null
  model: string | null
  verdict: string
  blocks: number | null
  len: number | null
  issued_at: string | null
  seen_at: string
}

export type OpsTicketCount = {
  vm_id: string | null
  model: string | null
  verdict: string
  n: number
}

export type OpsTicketPolicy = {
  enabled: boolean
  models: string[]
  target_blocks: number
  ttl_seconds: number
  refresh_before_seconds: number
  fail_closed: boolean
  harvest_interval_seconds: number
  harvest_cooldown_seconds: number
  max_probes_per_round: number
  harvest_proxies: string[]
  edge_direct: boolean
  edge_ips: string[]
  candy_observation: boolean
  gate_scheduling: boolean
  probe_interval_seconds: number
  probe_idle_interval_seconds: number
  candy_interval_seconds: number
  pelican_interval_seconds: number
  auto_park: boolean
  inject: boolean
  probe_routing: boolean
  overflow_to_any_plan: boolean
  edge_auto: boolean
  edge_auto_interval_seconds: number
}

export type OpsIqResult = {
  vm_id: string | null
  n: number
  model_mismatch: number
  effort_drop: number
  ticket_bad: number
  last_at: string
}

export type OpsSummary = {
  hours: number
  tickets: OpsTicketBucket[]
  ticketSlots: OpsTicketSlot[]
  effort: OpsEffortBucket[]
  iqResults: OpsIqResult[]
  ticketsByAccount: OpsTicketAccount[]
  ticketCounts: OpsTicketCount[]
  ticketPolicy: OpsTicketPolicy | null
  modelMismatch: number
  totals: {
    requests: number
    ok: number
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
    prompt_tokens: number
    cache_hit_rate: number | null
    avg_ttft_ms: number | null
    avg_first_byte_ms: number | null
  }
  config: {
    sticky_ttl_seconds: number | null
    quota_limit_5h: number | null
    quota_limit_7d: number | null
    usage_probe_enabled: boolean | null
  }
}

export type IqTask = {
  id: string
  name: string
  kind: 'probe' | 'candy' | 'pelican'
  interval_sec: number
  model: string | null
  enabled: number
  only_healthy: number
  last_run_at: string | null
  next_run_at: string | null
  last_verdict: string | null
  run_count: number
  fail_count: number
}

export type IqRun = {
  id: string
  task_id: string
  vm_id: string
  model: string | null
  verdict: string | null
  answer: number | null
  expected: number | null
  detail: string | null
  ok: number
  started_at: string
  duration_ms: number | null
  source?: string | null
  question_id?: string | null
  effort?: string | null
  tokens?: number | null
}

export type IqQuestion = {
  id: string
  title: string
  kind: string
  prompt: string
  judge_rule: string
  expected: string | null
  auto_support: number
  builtin: number
}
