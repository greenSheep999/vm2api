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
        async (req: any, res: any, next: () => void) => {
          const url = String(req.url || '')
          // 单端口 mock 模式：访问 /?mock=1#/logs 会写入 cookie，
          // 之后 usage-logs 接口返回 7 种状态的假数据（不额外开端口）。
          if (url.includes('mock=1')) {
            // ?mock=1&to=/ops/cache → 打开 mock 并跳到指定路由（默认日志页）
            const to = (() => {
              try {
                const u = new URL(url, 'http://127.0.0.1')
                const raw = u.searchParams.get('to') || '/logs'
                return raw.startsWith('/') ? raw : `/${raw}`
              } catch {
                return '/logs'
              }
            })()
            res.setHeader('set-cookie', 'kin_mock=1; Path=/; Max-Age=86400')
            res.statusCode = 302
            res.setHeader('location', `/#${to}`)
            res.end()
            return
          }
          const mockMode = String(req.headers?.cookie || '').includes('kin_mock=1')
          if (mockMode && req.method === 'GET' && url.startsWith('/api/panel/usage-logs')) {
            // 拿真实响应做底板再改字段：手搓行容易缺字段、页面直接 500。
            const upstream = process.env.VM2API_API_PROXY || 'https://vm2a.muxpay.xyz'
            try {
              const upstreamRes = await fetch(upstream + url, { headers: { authorization: String(req.headers?.authorization || '') } })
              const json = (await upstreamRes.json()) as any
              const logs = json?.data?.logs
              if (Array.isArray(logs) && logs.length) {
                // [票, 探针, 上游响应模型, effort, 本行模型]
                const variants: Array<[string, string | null, string, string, string]> = [
                  ['ok', 'healthy', 'gpt-6-astra', 'xhigh', 'gpt-6-astra'],
                  ['ok', 'degraded', 'gpt-6-astra', 'xhigh', 'gpt-6-astra'],
                  ['ok', null, 'gpt-6-astra', 'xhigh', 'gpt-6-astra'],
                  ['absent', 'degraded', 'gpt-6-astra', 'xhigh', 'gpt-6-astra'],
                  ['ok', 'route_changed', 'gpt-6-astra', 'xhigh', 'gpt-6-astra'],
                  ['ok', 'healthy', 'gpt-6-astra', 'xhigh', 'gpt-5.6-sol'],
                  ['ok', 'degraded', 'gpt-6-astra', 'xhigh', 'gpt-5.6-sol'],
                  ['ok', 'inconclusive', 'gpt-6.1-sol', 'xhigh', 'gpt-6.1-sol'],
                  ['ok', 'healthy', 'gpt-6-astra', 'low', 'gpt-6-sol'],
                ]
                const base = logs.slice(0, 9)
                const out = variants.map(([ticket, probe, upstreamModel, effort, rowModel], i) => {
                  const row = { ...(base[i] || base[0]) }
                  row.id = `mock_${i}`
                  row.vmId = `vm-mock-0${i + 1}`
                  row.requestId = `mock_req_${i}`
                  row.turnStateVerdict = ticket
                  row.turnStateLen = ticket === 'ok' ? 780 : 0
                  row.turnStateBlocks = ticket === 'ok' ? 33 : null
                  row.probeVerdict = probe
                  row.probeAt = probe ? new Date(Date.now() - 180_000).toISOString() : null
                  row.reasoningEffort = effort
                  row.upstreamReasoningEffort = effort === 'low' ? 'low' : effort
                  row.upstreamResponseModel = upstreamModel
                  row.requestedModel = rowModel
                  row.model = rowModel
                  return row
                })
                json.data.logs = out
              }
              const body = JSON.stringify(json)
              res.statusCode = 200
              res.setHeader('content-type', 'application/json')
              res.end(body)
              return
            } catch {
              // 拿不到底板就退回真实数据
            }
          }
          if (mockMode && req.method === 'GET' && url.startsWith('/api/panel/ops/cache/policies')) {
            const body = JSON.stringify({
              ok: true,
              data: {
                items: [
                  { keyId: 'key_mock_pro', keyName: 'new-api-self', groupType: null, configured: true,
                    policy: { allow_migration: false, sticky_minutes: 30, target_ratio: 0.85, force_continue: true } },
                  { keyId: 'key_mock_plus', keyName: 'new-api-plus-self', groupType: null, configured: false,
                    policy: { allow_migration: true, sticky_minutes: 10, target_ratio: 0.6, force_continue: false } },
                ],
              },
            })
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(body)
            return
          }
          if (mockMode && req.method === 'GET' && url.startsWith('/api/panel/ops/cache/stats')) {
            const body = JSON.stringify({
              ok: true,
              data: {
                hours: 12,
                bucketRows: [
                  { plan: 'pro', bucket: '0-1min', samples: 62, hitRatio: 0.891 },
                  { plan: 'pro', bucket: '1-5min', samples: 2, hitRatio: 0.539 },
                  { plan: 'prolite', bucket: '0-1min', samples: 586, hitRatio: 0.855 },
                  { plan: 'prolite', bucket: '1-5min', samples: 22, hitRatio: 0.545 },
                  { plan: 'plus', bucket: '0-1min', samples: 14, hitRatio: 0.609 },
                  { plan: 'plus', bucket: '1-5min', samples: 17, hitRatio: 0.405 },
                  { plan: 'plus', bucket: '1-6h', samples: 9, hitRatio: 0.315 },
                ],
                keyRows: [
                  { keyId: 'key_mock_pro', keyName: 'new-api-self', samples: 721, hitRatio: 0.825, avgTtftMs: 4900 },
                  { keyId: 'key_mock_plus', keyName: 'new-api-plus-self', samples: 32, hitRatio: 0.456, avgTtftMs: 17200 },
                ],
                slotRows: [
                  { vmId: 'vm-gpt-03', plan: 'prolite', samples: 619, hitRatio: 0.845, avgTtftMs: 4691 },
                  { vmId: 'vm-gpt-02', plan: 'pro', samples: 56, hitRatio: 0.84, avgTtftMs: 5120 },
                  { vmId: 'vm-gpt-10', plan: 'plus', samples: 11, hitRatio: 0.662, avgTtftMs: 9800 },
                  { vmId: 'vm-gpt-08', plan: 'plus', samples: 11, hitRatio: 0.155, avgTtftMs: 22600 },
                ],
              },
            })
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(body)
            return
          }
          if (mockMode && req.method === 'GET' && url.startsWith('/api/panel/api-keys')) {
            const body = JSON.stringify({
              ok: true,
              data: {
                items: [
                  { id: 'key_mock_pro', name: 'new-api-self', group_type: null, category: 'oauth' },
                  { id: 'key_mock_plus', name: 'new-api-plus-self', group_type: null, category: 'oauth' },
                ],
              },
            })
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(body)
            return
          }
          if (mockMode && req.method === 'POST' && url.startsWith('/api/panel/ops/cache/test')) {
            const mk = (i: number, cached: number) => ({
              round: i,
              status: 200,
              vmId: 'vm-gpt-03',
              inputTokens: 12500,
              cachedTokens: cached,
              cacheWriteTokens: 0,
              outputTokens: 256,
              hitRatio: cached / (cached + 12500),
              textSnippet: 'OK',
              totalMs: i === 1 ? 4213 : 1680,
            })
            const results = [mk(1, 0), mk(2, 12096), mk(3, 12420)]
            const body = JSON.stringify({
              ok: true,
              data: {
                ok: true, model: 'gpt-5.6-sol', prefixParagraphs: 48, rounds: 3, intervalMs: 1000,
                results,
                summary: { firstHitRatio: 0, repeatHitRatio: (12096 / 24596 + 12420 / 24920) / 2, cacheReadTokens: 24516, completedRounds: 3 },
              },
            })
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(body)
            return
          }
          const hitMe = req.method === 'GET' && url.startsWith('/api/panel/me')
          const hitSummary = req.method === 'GET' && url.startsWith('/api/panel/ops/summary')
          const hitHarvest = url.startsWith('/api/panel/ops/harvest')
          const hitIq = url.startsWith('/api/panel/ops/iq')

          // 降智检测桩：题库 / 任务 / 记录 / 结果（后端接口未上线时让界面可验）。
          if (hitIq && req.method === 'GET') {
            const now = Date.now()
            const PROMPTS: Record<string, string> = {
              candy: '在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形）…最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？',
              'pelican-bike': '创建一个 HTML，内容是用 SVG 绘制一个鹈鹕骑自行车的 2D 动画。所有样式与脚本内联。',
              'polar-bear-bike': '创建一个 HTML，用 SVG 绘制一只北极熊骑自行车的 2D 动画：体型圆润、白色毛发、黑鼻子…',
              'ultraman-moto': '创建一个 HTML，用 SVG 绘制奥特曼骑摩托车的 2D 动画：银红配色、头顶有鳍状冠…',
              'octopus-drums': '创建一个 HTML，用 SVG 绘制一只章鱼打架子鼓的 2D 动画：8 条触手各持鼓棒…',
              'giraffe-skate': '创建一个 HTML，用 SVG 绘制一只长颈鹿踩滑板的 2D 动画：脖子修长、带棕色斑块…',
              'astro-cat-fishing': '创建一个 HTML，用 SVG 绘制一只穿宇航服的猫在月球上钓鱼的 2D 动画…',
              'analog-clock': '创建一个 HTML，用 SVG 绘制一个模拟时钟：表盘刻度、时针分针秒针，读取本地时间实时走针…',
              'solar-system': '创建一个 HTML，用 SVG 绘制太阳系动画：六颗行星沿轨道公转，周期按真实比例缩放…',
              'bouncing-balls': '创建一个 HTML，用 Canvas 或 SVG 实现弹跳小球物理模拟：8 个球受重力下落…',
              'gear-train': '创建一个 HTML，用 SVG 绘制一组相互啮合的齿轮传动动画：至少 4 个齿轮…',
              'city-parallax': '创建一个 HTML，用 SVG 绘制横向无限滚动的城市夜景：至少三层视差…',
              'stroke-order': '创建一个 HTML，用 SVG 路径动画演示汉字「永」的书写过程：按正确笔顺逐笔书写，共 5 笔…',
              poker: '一副牌37张，背面蓝红两色翻前可见；花色黑桃红心梅花翻开可知…最少翻多少张才能保证…',
            }
            const qs = [
              ['candy', '糖果计数', 'numeric', 'numeric_pass', '21'],
              ['pelican-bike', '鹈鹕骑自行车', 'image', 'structure', null],
              ['polar-bear-bike', '北极熊骑自行车', 'image', 'structure', null],
              ['ultraman-moto', '奥特曼骑摩托车', 'image', 'structure', null],
              ['octopus-drums', '章鱼打架子鼓', 'image', 'structure', null],
              ['giraffe-skate', '长颈鹿踩滑板', 'image', 'structure', null],
              ['astro-cat-fishing', '宇航猫月球钓鱼', 'image', 'structure', null],
              ['analog-clock', '模拟时钟 · 实时走针', 'image', 'structure', null],
              ['solar-system', '太阳系轨道动画', 'image', 'structure', null],
              ['bouncing-balls', '弹跳小球物理模拟', 'image', 'structure', null],
              ['gear-train', '齿轮传动机构', 'image', 'structure', null],
              ['city-parallax', '城市夜景视差滚动', 'image', 'structure', null],
              ['stroke-order', '汉字笔顺书写动画', 'image', 'structure', null],
              ['poker', '扑克翻牌', 'numeric', 'record_only', null],
            ].map(([id, title, kind, rule, expected]) => ({
              id,
              title,
              kind,
              prompt: PROMPTS[String(id)] || '',
              judge_rule: rule,
              expected,
              auto_support: rule === 'numeric_pass' ? 1 : 0,
              builtin: 1,
            }))
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
              const svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 320 200\"><rect width=\"320\" height=\"200\" fill=\"#fafaf7\"/><circle cx=\"60\" cy=\"150\" r=\"26\" fill=\"none\" stroke=\"#1f2937\" stroke-width=\"3\"/><circle cx=\"130\" cy=\"150\" r=\"26\" fill=\"none\" stroke=\"#1f2937\" stroke-width=\"3\"/><path d=\"M60 150 L95 110 L130 150\" fill=\"none\" stroke=\"#1f2937\" stroke-width=\"3\"/><path d=\"M95 110 L108 96\" stroke=\"#1f2937\" stroke-width=\"3\"/><ellipse cx=\"185\" cy=\"120\" rx=\"38\" ry=\"26\" fill=\"#fff\" stroke=\"#1f2937\" stroke-width=\"3\"/><path d=\"M218 112 q26 -8 30 6 q-14 6 -30 2z\" fill=\"#f59e0b\"/><circle cx=\"203\" cy=\"112\" r=\"3\" fill=\"#1f2937\"/></svg>'
              const mk = (id: string, vm: string, kind: string, verdict: string, answer: number | null, expected: number | null, min: number) => ({
                id, vm_id: vm, model: 'gpt-6-astra', effort: 'high', verdict, answer, expected,
                question_id: kind, question_kind: kind,
                question_title: kind === 'candy' ? '糖果计数' : kind === 'probe' ? '门票探针' : '鹈鹕骑自行车',
                judge_rule: kind === 'candy' ? 'numeric_pass' : kind === 'pelican' ? 'structure' : 'record_only',
                artifact: kind === 'pelican' ? svg : null,
                source: min % 2 ? 'task' : 'single',
                started_at: new Date(now - min * 60000).toISOString(),
                duration_ms: 2000 + (min % 7) * 400,
                keys: vm === 'vm-13'
                  ? [{ id: 'key_f9aaa7d2dc56', name: 'new-api-plus-self' }]
                  : [{ id: 'key_87b1b7bb0cdb', name: 'new-api-self' }],
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
                  { id: 'key_f9aaa7d2dc56', name: 'new-api-plus-self', status: 'active', slots: 7 },
                  { id: 'key_87b1b7bb0cdb', name: 'new-api-self', status: 'active', slots: 10 },
                  { id: 'key_76456e470805', name: 'new-api-GPT-Pro-Stable-Self', status: 'active', slots: 10 },
                  { id: 'key_4c11959ab9b3', name: 'gpt-05-solo', status: 'disabled', slots: 1 },
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
