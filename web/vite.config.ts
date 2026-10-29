import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 仅本地预览用：改写两个接口的响应体。
 *
 *  - `/api/panel/me`：补 ops 视图白名单（ACL 在后端，未上线时菜单会被过滤掉）
 *  - `/api/panel/ops/summary`：补「账号级门票 + 策略」（后端这段未上线时用现有数据派生）
 *
 * 关键细节：浏览器会带 `Accept-Encoding: gzip`，dev proxy 会原样转发压缩体。
 * 这里先把上游请求改成 `identity`，否则 JSON.parse 必然失败、连接也会被写坏（表现为 500 白屏）。
 */
function previewOpsAcl() {
  function rewriteJson(res: any, mutate: (json: any) => void) {
    const chunks: Buffer[] = []
    const origWrite = res.write.bind(res)
    const origEnd = res.end.bind(res)
    res.write = (chunk: any) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    }
    res.end = (chunk?: any) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      const raw = Buffer.concat(chunks)
      let out = raw
      try {
        const json = JSON.parse(raw.toString('utf8'))
        mutate(json)
        out = Buffer.from(JSON.stringify(json), 'utf8')
      } catch {
        // 解析失败就原样回传，绝不写坏连接。
        out = raw
      }
      res.write = origWrite
      res.end = origEnd
      res.setHeader('content-length', String(out.length))
      return origEnd(out)
    }
  }

  const OPS_VIEWS = ['ops', 'ops/ticket', 'ops/iq', 'ops/cache', 'ops/sched', 'ops/results']

  return {
    name: 'preview-ops-acl',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(
        (req: any, res: any, next: () => void) => {
          const url = String(req.url || '')
          const hitMe = req.method === 'GET' && url.startsWith('/api/panel/me')
          const hitSummary = req.method === 'GET' && url.startsWith('/api/panel/ops/summary')
          const hitHarvest = url.startsWith('/api/panel/ops/harvest')
          const hitIq = url.startsWith('/api/panel/ops/iq')

          // 降智检测桩：题库 / 任务 / 记录 / 结果（后端接口未上线时让界面可验）。
          if (hitIq && req.method === 'GET') {
            const now = Date.now()
            const qs = [
              { id: 'candy', title: '糖果计数', kind: 'numeric', prompt: '…糖果题原文…', judge_rule: 'numeric_pass', expected: '21', auto_support: 1, builtin: 1 },
              { id: 'poker', title: '扑克翻牌', kind: 'numeric', prompt: '…扑克题原文…', judge_rule: 'record_only', expected: null, auto_support: 0, builtin: 1 },
              { id: 'pelican-bike', title: '鹈鹕骑自行车', kind: 'image', prompt: '…SVG 动画…', judge_rule: 'structure', expected: null, auto_support: 0, builtin: 1 },
            ]
            let data: any = { items: qs }
            if (url.includes('/iq/tasks')) {
              data = {
                items: [
                  { id: 'iq_demo1', name: '门票探针', kind: 'probe', interval_sec: 180, model: null, enabled: 1, only_healthy: 0, last_run_at: new Date(now - 120000).toISOString(), next_run_at: new Date(now + 60000).toISOString(), last_verdict: 'degraded', run_count: 128, fail_count: 96 },
                  { id: 'iq_demo2', name: '糖果题', kind: 'candy', interval_sec: 900, model: null, enabled: 1, only_healthy: 1, last_run_at: new Date(now - 420000).toISOString(), next_run_at: new Date(now + 480000).toISOString(), last_verdict: 'pass', run_count: 42, fail_count: 3 },
                  { id: 'iq_demo3', name: '鹈鹕结构', kind: 'pelican', interval_sec: 1800, model: null, enabled: 0, only_healthy: 1, last_run_at: null, next_run_at: null, last_verdict: null, run_count: 0, fail_count: 0 },
                ],
                latest: [
                  { vm_id: 'vm-13', kind: 'probe', verdict: 'healthy', started_at: new Date(now - 90000).toISOString() },
                  { vm_id: 'vm-gpt-02', kind: 'probe', verdict: 'degraded', started_at: new Date(now - 100000).toISOString() },
                ],
              }
            } else if (url.includes('/iq/runs')) {
              data = {
                items: [
                  { id: 'r1', task_id: 'single', vm_id: 'vm-13', model: 'gpt-6-astra', verdict: 'pass', answer: 21, expected: 21, question_id: 'candy', source: 'single', started_at: new Date(now - 90000).toISOString(), duration_ms: 4200 },
                  { id: 'r2', task_id: 'iq_demo2', vm_id: 'vm-gpt-02', model: 'gpt-6-astra', verdict: 'fail', answer: 29, expected: 21, question_id: 'candy', source: 'task', started_at: new Date(now - 300000).toISOString(), duration_ms: 6100 },
                  { id: 'r3', task_id: 'iq_demo1', vm_id: 'vm-13', model: 'gpt-6-astra', verdict: 'healthy', answer: null, expected: null, question_id: 'probe', source: 'task', started_at: new Date(now - 600000).toISOString(), duration_ms: 2100 },
                ],
              }
            } else if (url.includes('/iq/results')) {
              const mk = (id: string, vm: string, kind: string, verdict: string, answer: number | null, expected: number | null, min: number) => ({
                id, vm_id: vm, model: 'gpt-6-astra', verdict, answer, expected,
                question_id: kind, question_kind: kind,
                question_title: kind === 'candy' ? '糖果计数' : kind === 'probe' ? '门票探针' : '鹈鹕骑自行车',
                source: min % 2 ? 'task' : 'single',
                started_at: new Date(now - min * 60000).toISOString(),
                duration_ms: 2000 + (min % 7) * 400,
                keys: vm === 'vm-13' ? [{ id: 'key_f9aaa7d2dc56', name: 'new-api-plus-self' }] : [{ id: 'key_aaa', name: 'new-api-self' }],
              })
              data = {
                items: [
                  mk('a1', 'vm-13', 'candy', 'pass', 21, 21, 3),
                  mk('a2', 'vm-13', 'probe', 'healthy', null, null, 2),
                  mk('a3', 'vm-gpt-02', 'candy', 'fail', 29, 21, 5),
                  mk('a4', 'vm-gpt-02', 'probe', 'degraded', null, null, 4),
                  mk('a5', 'vm-gpt-05', 'candy', 'fail', 29, 21, 18),
                  mk('a6', 'vm-13', 'pelican', 'structure_ok', null, null, 22),
                ],
                keys: [
                  { id: 'key_f9aaa7d2dc56', name: 'new-api-plus-self' },
                  { id: 'key_aaa', name: 'new-api-self' },
                ],
              }
            }
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true, data, items: data.items }))
            return
          }

          // 打票面板桩：后端接口未上线时，用内存态把页面与交互跑通。
          if (hitHarvest) {
            const st = ((globalThis as any).__harvestStub ||= {
              skip: new Set<string>(),
              snaps: new Map<string, any>(),
              events: [] as any[],
              seq: 1,
            })
            const now = () => new Date().toISOString()
            const ids = ['01','02','03','04','05','06','07','08','09','10']
            if (req.method === 'GET') {
              return rewriteJson(res, (json) => {
                res.statusCode = 200
                delete json.error
                json.ok = true
                json.data = {
                  accounts: ids.map((n) => {
                    const id = `vm-gpt-${n}`
                    const snap = st.snaps.get(id)
                    return {
                      id,
                      name: id,
                      status: 'running',
                      schedulable: true,
                      plan_type: null,
                      skip_harvest: st.skip.has(id),
                      expected_blocks: 10,
                      proxy: 'bound',
                      models: [
                        snap || {
                          model: 'gpt-6-astra',
                          verdict: null,
                          blocks: null,
                          len: null,
                          issued_at: null,
                          expires_at: null,
                          proxy: null,
                          checked_at: null,
                          http_status: null,
                        },
                      ],
                    }
                  }),
                  events: st.events.slice(0, 60),
                  policy: {
                    enabled: true,
                    models: ['gpt-6-astra'],
                    target_blocks: 0,
                    ttl_seconds: 3600,
                    refresh_before_seconds: 300,
                    fail_closed: false,
                    harvest_interval_seconds: 3600,
                    harvest_cooldown_seconds: 600,
                    max_probes_per_round: 3,
                    harvest_proxies: [],
                    edge_direct: false,
                    edge_ips: [],
                    candy_observation: false,
                    gate_scheduling: false,
                  },
                }
              }), next()
            }
            const chunks: Buffer[] = []
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => {
              let body: any = {}
              try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch {}
              const id = String(body.vm_id || '')
              let payload: any = { ok: true, data: {} }
              if (url.includes('/ops/iq/results') && req.method === 'GET') {
                const now = Date.now()
                const mk = (id: string, vm: string, kind: string, verdict: string, answer: number | null, expected: number | null, min: number) => ({
                  id, vm_id: vm, model: 'gpt-6-astra', verdict, answer, expected,
                  question_id: kind, question_kind: kind,
                  question_title: kind === 'candy' ? '糖果计数' : kind === 'probe' ? '门票探针' : '鹈鹕骑自行车',
                  source: min % 2 ? 'task' : 'single', started_at: new Date(now - min * 60000).toISOString(),
                  duration_ms: 2000 + (min % 7) * 400,
                  keys: vm === 'vm-13' ? [{ id: 'key_f9aaa7d2dc56', name: 'new-api-plus-self' }] : [{ id: 'key_aaa', name: 'new-api-self' }],
                })
                payload.data = {
                  items: [
                    mk('a1', 'vm-13', 'candy', 'pass', 21, 21, 3),
                    mk('a2', 'vm-13', 'probe', 'healthy', null, null, 2),
                    mk('a3', 'vm-gpt-02', 'candy', 'fail', 29, 21, 5),
                    mk('a4', 'vm-gpt-02', 'probe', 'degraded', null, null, 4),
                    mk('a5', 'vm-gpt-05', 'candy', 'fail', 29, 21, 18),
                    mk('a6', 'vm-13', 'pelican', 'structure_ok', null, null, 22),
                  ],
                  keys: [
                    { id: 'key_f9aaa7d2dc56', name: 'new-api-plus-self' },
                    { id: 'key_aaa', name: 'new-api-self' },
                  ],
                }
              } else if (url.includes('/ops/iq/tasks') && req.method === 'GET') {
                const now = Date.now()
                payload.data = {
                  items: [
                    { id: 'iq_demo1', name: '门票探针', kind: 'probe', interval_sec: 180, model: null, enabled: 1, only_healthy: 0, last_run_at: new Date(now - 120_000).toISOString(), next_run_at: new Date(now + 60_000).toISOString(), last_verdict: 'degraded', run_count: 128, fail_count: 96 },
                    { id: 'iq_demo2', name: '糖果题', kind: 'candy', interval_sec: 900, model: null, enabled: 1, only_healthy: 1, last_run_at: new Date(now - 420_000).toISOString(), next_run_at: new Date(now + 480_000).toISOString(), last_verdict: 'pass', run_count: 42, fail_count: 3 },
                    { id: 'iq_demo3', name: '鹈鹕结构', kind: 'pelican', interval_sec: 1800, model: null, enabled: 0, only_healthy: 1, last_run_at: null, next_run_at: null, last_verdict: null, run_count: 0, fail_count: 0 },
                  ],
                  latest: [
                    { vm_id: 'vm-13', kind: 'probe', verdict: 'healthy', started_at: new Date(now - 90_000).toISOString() },
                    { vm_id: 'vm-13', kind: 'candy', verdict: 'pass', started_at: new Date(now - 400_000).toISOString() },
                    { vm_id: 'vm-gpt-02', kind: 'probe', verdict: 'degraded', started_at: new Date(now - 100_000).toISOString() },
                    { vm_id: 'vm-gpt-02', kind: 'candy', verdict: 'fail', started_at: new Date(now - 500_000).toISOString() },
                  ],
                }
              } else if (url.includes('/ops/iq/runs') && req.method === 'GET') {
                const now = Date.now()
                payload.data = {
                  items: [
                    { id: 'r1', task_id: 'iq_demo1', vm_id: 'vm-13', model: 'gpt-6-astra', verdict: 'healthy', answer: null, expected: null, detail: 'shot1=200/780 shot2=200/0', ok: 1, started_at: new Date(now - 90_000).toISOString(), duration_ms: 2140 },
                    { id: 'r2', task_id: 'iq_demo2', vm_id: 'vm-13', model: 'gpt-6-astra', verdict: 'pass', answer: 21, expected: 21, detail: '', ok: 1, started_at: new Date(now - 400_000).toISOString(), duration_ms: 5200 },
                    { id: 'r3', task_id: 'iq_demo1', vm_id: 'vm-gpt-02', model: 'gpt-6-astra', verdict: 'degraded', answer: null, expected: null, detail: 'shot2 reissued', ok: 0, started_at: new Date(now - 100_000).toISOString(), duration_ms: 2380 },
                    { id: 'r4', task_id: 'iq_demo2', vm_id: 'vm-gpt-02', model: 'gpt-6-astra', verdict: 'fail', answer: 29, expected: 21, detail: '', ok: 0, started_at: new Date(now - 500_000).toISOString(), duration_ms: 6100 },
                  ],
                }
              } else if (url.includes('/probe')) {
                const model = String(body.model || 'gpt-6-astra')
                const healthy = st.seq % 2 === 0
                st.events.unshift({ id: st.seq++, at: now(), kind: 'probe', vm_id: id, model, http_status: 200, result: healthy ? 'ok' : 'fail', reason: healthy ? 'healthy' : 'degraded', detail: 'shot1=200/780 shot2=200/0', proxy: 'slot', edge_ip: null })
                payload.data = {
                  ok: healthy,
                  verdict: healthy ? 'healthy' : 'degraded',
                  shot1: { http: 200, ticket_len: 780, model },
                  shot2: { http: 200, new_ticket: !healthy, ticket_len: healthy ? 0 : 780, model },
                  edge_ip: null,
                }
              } else if (url.includes('/skip')) {
                if (body.skip) st.skip.add(id)
                else st.skip.delete(id)
                st.events.unshift({ id: st.seq++, at: now(), kind: 'select', vm_id: id, model: null, http_status: null, result: body.skip ? 'skip' : 'ok', reason: body.skip ? 'skip_harvest' : 'enable_harvest', detail: null, proxy: null })
                payload.data = { vm_id: id, skip_harvest: !!body.skip }
              } else {
                const hit = st.seq % 3 === 0
                const model = String(body.model || 'gpt-6-astra')
                const at = now()
                st.snaps.set(id, {
                  model,
                  verdict: hit ? 'ok' : 'absent',
                  blocks: hit ? 10 : null,
                  len: hit ? 290 : 0,
                  issued_at: hit ? at : null,
                  expires_at: hit ? new Date(Date.now() + 3600_000).toISOString() : null,
                  proxy: 'slot',
                  checked_at: at,
                  http_status: 200,
                })
                st.events.unshift({ id: st.seq++, at, kind: 'ticket', vm_id: id, model, http_status: 200, result: hit ? 'ok' : 'fail', reason: hit ? 'ok' : 'absent', detail: null, proxy: 'slot' })
                payload.data = { ok: hit, verdict: hit ? 'ok' : 'absent', blocks: hit ? 10 : null, http_status: 200 }
              }
              res.statusCode = 200
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify(payload))
            })
            return
          }

          if (req.method !== 'GET') return next()
          if (!hitMe && !hitSummary) return next()

          // 让上游回明文，避免 gzip 体被当成 JSON。
          req.headers['accept-encoding'] = 'identity'

          rewriteJson(res, (json) => {
            if (hitMe) {
              for (const target of [json, json?.data]) {
                const views = target?.views
                if (Array.isArray(views)) {
                  for (const v of OPS_VIEWS) if (!views.includes(v)) views.push(v)
                }
              }
              return
            }
            const data = json?.data
            if (!data || data.ticketsByAccount) return
            const slots = data.ticketSlots || []
            data.iqResults = slots.map((t: any) => ({
              vm_id: t.vm_id,
              n: t.n,
              model_mismatch: 0,
              effort_drop: 0,
              ticket_bad: t.verdict === 'ok' ? 0 : t.n,
              last_at: new Date().toISOString(),
            }))
            data.ticketCounts = (data.ticketSlots || []).map((t: any) => ({
              vm_id: t.vm_id,
              model: 'gpt-6-astra',
              verdict: t.verdict,
              n: t.n,
            }))
            data.ticketsByAccount = (data.ticketSlots || []).map((t: any) => ({
              vm_id: t.vm_id,
              model: 'gpt-6-astra',
              verdict: t.verdict,
              blocks: t.verdict === 'ok' ? 10 : null,
              len: t.verdict === 'ok' ? 290 : 0,
              issued_at: null,
              seen_at: new Date().toISOString(),
            }))
            data.ticketPolicy = {
              enabled: false,
              models: ['gpt-6-astra', 'gpt-6.1-sol'],
              target_blocks: 0,
              ttl_seconds: 3600,
              refresh_before_seconds: 300,
              fail_closed: false,
              harvest_interval_seconds: 3600,
              harvest_cooldown_seconds: 600,
              max_probes_per_round: 3,
              harvest_proxies: [],
            }
          })
          next()
        },
      )
    },
  }
}

export default defineConfig({
  plugins: [
    ...(process.env.VM2API_PREVIEW_OPS === '1' ? [previewOpsAcl()] : []),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target:
          process.env.VM2API_API_PROXY ||
          process.env.KIN_API_PROXY ||
          'http://127.0.0.1:8787',
        ws: true,
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
