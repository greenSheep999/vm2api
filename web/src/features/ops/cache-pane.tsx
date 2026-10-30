import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { CacheControlSection, CacheObserveSection } from './cache-control'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ApiKey = { id: string; name: string; group_type?: string; category?: string }
type Round = {
  round: number
  status: number
  vmId?: string | null
  inputTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  outputTokens: number
  hitRatio: number
  textSnippet?: string
  totalMs?: number
  error?: string
}
type TestResult = {
  ok: boolean
  model: string
  prefixParagraphs: number
  rounds: number
  intervalMs: number
  results: Round[]
  summary: {
    firstHitRatio: number | null
    repeatHitRatio: number | null
    cacheReadTokens: number
    completedRounds: number
  }
}


const MOCK_PREVIEW: TestResult = {
  ok: true,
  model: 'gpt-5.6-sol',
  prefixParagraphs: 48,
  rounds: 3,
  intervalMs: 1000,
  results: [
    { round: 1, status: 200, vmId: 'vm-gpt-03', inputTokens: 12500, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 256, hitRatio: 0, textSnippet: 'OK', totalMs: 4213 },
    { round: 2, status: 200, vmId: 'vm-gpt-03', inputTokens: 12500, cachedTokens: 12096, cacheWriteTokens: 0, outputTokens: 256, hitRatio: 12096 / 24596, textSnippet: 'OK', totalMs: 1680 },
    { round: 3, status: 200, vmId: 'vm-gpt-03', inputTokens: 12500, cachedTokens: 12420, cacheWriteTokens: 0, outputTokens: 256, hitRatio: 12420 / 24920, textSnippet: 'OK', totalMs: 1655 },
  ],
  summary: { firstHitRatio: 0, repeatHitRatio: (12096 / 24596 + 12420 / 24920) / 2, cacheReadTokens: 24516, completedRounds: 3 },
}

const MODELS = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.6-luna']
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh']

function pct(v: number | null | undefined) {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`
}
function num(v: number | null | undefined) {
  return v == null ? '—' : v.toLocaleString()
}

/** 缓存模块：控制（按 key 策略）→ 观测（谁在拖低命中率）→ 测试（验证效果）。 */
export function CacheLabPane() {
  const keys = useQuery({
    queryKey: ['api-keys-for-cache'],
    queryFn: () => api<{ items: ApiKey[] }>('/api/panel/api-keys'),
  })
  const [keyId, setKeyId] = useState('')
  const [model, setModel] = useState('gpt-5.6-sol')
  const [protocol, setProtocol] = useState('responses')
  const [rounds, setRounds] = useState(3)
  const [prefixParagraphs, setPrefixParagraphs] = useState(48)
  const [intervalMs, setIntervalMs] = useState(1000)
  const [timeoutSec, setTimeoutSec] = useState(120)
  const [maxOutput, setMaxOutput] = useState(256)
  const [effort, setEffort] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [history, setHistory] = useState<TestResult[]>([])

  const list = keys.data?.items || []
  const isMock = list.some((k) => String(k.id).startsWith('key_mock'))
  if (!keyId && list.length) {
    // 首次加载自动选第一个 Key，省掉「按钮灰着不知道要点哪」的困惑
    setTimeout(() => setKeyId(list[0].id), 0)
  }
  const currentKey = useMemo(() => list.find((k) => k.id === keyId) || null, [list, keyId])

  const test = useMutation({
    mutationFn: () =>
      api<TestResult>('/api/panel/ops/cache/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key_id: keyId,
          model,
          rounds,
          prefix_paragraphs: prefixParagraphs,
          interval_ms: intervalMs,
          timeout_s: timeoutSec,
          max_output_tokens: maxOutput,
          effort: effort || null,
        }),
      }),
    onSuccess: (r) => {
      setHistory((h) => [r, ...h].slice(0, 20))
      if (!r?.ok) toast.warning(`未全部成功：${r.summary.completedRounds}/${r.rounds} 完成`)
      else toast.success('测试完成')
    },
    onError: (e) => toast.error(`测试失败：${(e as Error).message}`),
  })

  // mock 模式下自动跑一次，直接看到结果表长什么样（真实模式绝不自动跑，会真扣费）
  const autoRan = useRef(false)
  useEffect(() => {
    if (!isMock || autoRan.current || !keyId) return
    autoRan.current = true
    test.mutate()
  }, [isMock, keyId, test])

  const result = test.data ?? (isMock ? MOCK_PREVIEW : null)
  const rows = result?.results || []

  return (
    <div className='space-y-4'>
      {isMock ? (
        <div className='rounded-md border border-blue-300/60 bg-blue-50/60 px-3 py-1.5 text-[11px] text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300'>
          当前是 MOCK 数据：Key、策略、命中率、测试结果都是假的，用来确认页面效果。
        </div>
      ) : null}
      <CacheControlSection />
      <CacheObserveSection />
      <div className='grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]'>
      {/* 左：测试配置 */}
      <section className='space-y-3 rounded-lg border p-3'>
        <h4 className='text-sm font-semibold'>测试配置</h4>
        <p className='text-[11px] text-muted-foreground'>
          用真实 Key 重复发送相同前缀，对比首轮与重复轮次的缓存读取。
        </p>

        <div className='space-y-1'>
          <Label className='text-[11px]'>我的 API Key</Label>
          <Select value={keyId} onValueChange={setKeyId}>
            <SelectTrigger className='h-8 w-full text-[11px]'>
              <SelectValue placeholder='选择一个 Key' />
            </SelectTrigger>
            <SelectContent>
              {list.map((k) => (
                <SelectItem key={k.id} value={k.id} className='text-[11px]'>
                  {k.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-1'>
          <Label className='text-[11px]'>接口协议</Label>
          <Select value={protocol} onValueChange={setProtocol}>
            <SelectTrigger className='h-8 w-full text-[11px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='responses' className='text-[11px]'>Responses</SelectItem>
              <SelectItem value='chat' className='text-[11px]' disabled>
                Chat Completions（暂不支持）
              </SelectItem>
              <SelectItem value='messages' className='text-[11px]' disabled>
                Messages（暂不支持）
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-1'>
          <Label className='text-[11px]'>模型</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className='h-8 w-full text-[11px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m} value={m} className='text-[11px]'>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='grid grid-cols-2 gap-2'>
          <div className='space-y-1'>
            <Label className='text-[11px]'>请求轮数</Label>
            <Select value={String(rounds)} onValueChange={(v) => setRounds(Number(v))}>
              <SelectTrigger className='h-8 w-full text-[11px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2, 3, 5, 8, 10].map((n) => (
                  <SelectItem key={n} value={String(n)} className='text-[11px]'>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label className='text-[11px]'>固定前缀长度</Label>
            <Select value={String(prefixParagraphs)} onValueChange={(v) => setPrefixParagraphs(Number(v))}>
              <SelectTrigger className='h-8 w-full text-[11px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[12, 24, 48, 96, 160].map((n) => (
                  <SelectItem key={n} value={String(n)} className='text-[11px]'>
                    {n} 段
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className='text-[10px] leading-relaxed text-muted-foreground'>
          约 {Math.round(prefixParagraphs * 132).toLocaleString()} 个字符，全部为合成内容。字符数不等于 token 数，不同模型的缓存门槛不同。
        </p>

        <button
          type='button'
          className='text-left text-[11px] text-muted-foreground hover:text-foreground'
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? '▲ 收起高级设置' : '▼ 高级设置'}
        </button>

        {advanced ? (
          <div className='space-y-2'>
            <div className='space-y-1'>
              <Label className='text-[11px]'>轮次间隔（毫秒）</Label>
              <Input
                type='number'
                min={0}
                step={500}
                className='h-8 w-full text-[11px]'
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value) || 0)}
              />
            </div>
            <div className='space-y-1'>
              <Label className='text-[11px]'>单轮超时</Label>
              <Select value={String(timeoutSec)} onValueChange={(v) => setTimeoutSec(Number(v))}>
                <SelectTrigger className='h-8 w-full text-[11px]'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[30, 60, 120, 300].map((n) => (
                    <SelectItem key={n} value={String(n)} className='text-[11px]'>
                      {n} s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1'>
              <Label className='text-[11px]'>最大输出 token</Label>
              <Input
                type='number'
                min={16}
                max={4096}
                className='h-8 w-full text-[11px]'
                value={maxOutput}
                onChange={(e) => setMaxOutput(Number(e.target.value) || 256)}
              />
            </div>
            <div className='space-y-1'>
              <Label className='text-[11px]'>推理强度</Label>
              <Select value={effort || 'none'} onValueChange={(v) => setEffort(v === 'none' ? '' : v)}>
                <SelectTrigger className='h-8 w-full text-[11px]'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='none' className='text-[11px]'>不指定</SelectItem>
                  {EFFORTS.filter(Boolean).map((e) => (
                    <SelectItem key={e} value={e} className='text-[11px]'>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}

        <div className='rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-[10px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'>
          开始后会真实发送 {rounds} 次计费请求；单轮失败即停止，不自动重试。停止或超时前已处理的内容仍可能计费。
        </div>

        <Button
          size='sm'
          variant={test.isPending ? 'outline' : 'default'}
          className='h-8 w-full text-[11px]'
          disabled={!keyId}
          loading={test.isPending}
          onClick={() => (test.isPending ? test.reset() : test.mutate())}
        >
          {test.isPending ? '停止' : '开始计费测试'}
        </Button>
      </section>

      {/* 右：结果 */}
      <section className='space-y-3 rounded-lg border p-3'>
        <div className='flex flex-wrap items-baseline justify-between gap-2'>
          <h4 className='text-sm font-semibold'>测试结果</h4>
          <span className='text-[11px] text-muted-foreground'>
            {currentKey?.name || '—'} · {model} · /v1/responses
          </span>
        </div>

        {result ? (
          <>
            <p className='text-[11px] text-muted-foreground'>
              前缀 {result.prefixParagraphs} 段 · 输出上限 {maxOutput} · 间隔 {result.intervalMs}ms · 槽位 {rows[0]?.vmId || '按调度'}
            </p>
            <div className='grid gap-2 sm:grid-cols-4'>
              <Stat label='首轮命中率' value={pct(result.summary.firstHitRatio)} />
              <Stat label='重复轮次命中率' value={pct(result.summary.repeatHitRatio)} />
              <Stat label='缓存读取' value={num(result.summary.cacheReadTokens)} />
              <Stat label='完成轮次' value={`${result.summary.completedRounds}/${result.rounds}`} />
            </div>
            <p className='text-[10px] leading-relaxed text-muted-foreground'>
              命中率按缓存读取 ÷（总输入 + 缓存读取）计算，数据来自网关响应，不保证上游物理缓存。
            </p>
            <div className='overflow-x-auto'>
              <table className='w-full text-[11px]'>
                <thead>
                  <tr className='text-muted-foreground'>
                    <th className='py-1 text-left'>轮次</th>
                    <th className='py-1 text-right'>总输入</th>
                    <th className='py-1 text-right'>缓存读取</th>
                    <th className='py-1 text-right'>缓存写入</th>
                    <th className='py-1 text-right'>命中率</th>
                    <th className='py-1 text-right'>输出</th>
                    <th className='py-1 text-left'>首段文本</th>
                    <th className='py-1 text-right'>耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.round} className='border-t'>
                      <td className='py-1'>{r.round === 1 ? '首轮' : `第 ${r.round} 轮`}</td>
                      <td className='py-1 text-right tabular-nums'>{num(r.inputTokens)}</td>
                      <td className='py-1 text-right tabular-nums'>{num(r.cachedTokens)}</td>
                      <td className='py-1 text-right tabular-nums'>{num(r.cacheWriteTokens)}</td>
                      <td className='py-1 text-right tabular-nums'>{r.status === 200 ? pct(r.hitRatio) : '失败'}</td>
                      <td className='py-1 text-right tabular-nums'>{num(r.outputTokens)}</td>
                      <td className='max-w-[220px] truncate py-1 text-muted-foreground'>{r.textSnippet || r.error || '—'}</td>
                      <td className='py-1 text-right tabular-nums text-muted-foreground'>{r.totalMs ?? '—'}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className='py-10 text-center text-[11px] text-muted-foreground'>选好 Key 与模型后开始测试，结果显示在这里</p>
        )}

        {history.length ? (
          <div className='border-t pt-2'>
            <div className='flex items-center justify-between'>
              <span className='text-[11px] font-medium'>本地测试历史</span>
              <button
                type='button'
                className='text-[10px] text-muted-foreground hover:text-foreground'
                onClick={() => setHistory([])}
              >
                清空历史
              </button>
            </div>
            <div className='mt-1 space-y-0.5'>
              {history.slice(0, 6).map((h, i) => (
                <div key={`${h.model}-${i}`} className='flex items-center justify-between text-[10px] text-muted-foreground'>
                  <span className='font-mono'>{h.model}</span>
                  <span>首轮 {pct(h.summary.firstHitRatio)} · 重复 {pct(h.summary.repeatHitRatio)}</span>
                  <span>{h.summary.completedRounds}/{h.rounds}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-md border px-2 py-1.5'>
      <div className='text-[10px] text-muted-foreground'>{label}</div>
      <div className='mt-0.5 font-mono text-sm tabular-nums'>{value}</div>
    </div>
  )
}
