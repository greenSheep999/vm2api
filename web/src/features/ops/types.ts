export type OpsTicketBucket = { verdict: string; n: number }
export type OpsTicketSlot = { vm_id: string; verdict: string; n: number }
export type OpsEffortBucket = { asked: string; got: string; n: number }

export type OpsSummary = {
  hours: number
  tickets: OpsTicketBucket[]
  ticketSlots: OpsTicketSlot[]
  effort: OpsEffortBucket[]
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
