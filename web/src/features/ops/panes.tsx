import { useState } from 'react'
import { Clock, TicketX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration, formatTokenAmount } from '@/lib/usage-format'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { IqQuestion, IqRun, IqTask, OpsSummary } from './types'

const CARD = 'rounded-lg border bg-card p-4'

function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: string
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
  hint?: string
}) {
  const color =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'bad'
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-foreground'
  return (
    <div className={CARD}>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className={cn('mt-1 font-mono text-lg font-semibold tabular-nums', color)}>
        {value}
      </div>
      {hint ? <div className='mt-0.5 text-[10px] text-muted-foreground'>{hint}</div> : null}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { probe: '门票探针', candy: '糖果题', pelican: '鹈鹕结构' }

function fmtAt(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function verdictTone(v?: string | null) {
  if (!v) return 'text-muted-foreground'
  if (['healthy', 'healthy_same', 'pass', 'recorded'].includes(v)) return 'text-emerald-600 dark:text-emerald-400'
  if (['degraded', 'route_changed', 'fail', 'no_answer', 'no_ticket'].includes(v)) return 'text-rose-600 dark:text-rose-400'
  return 'text-amber-600 dark:text-amber-400'
}

/** 降智检测：工作台 / 题库 / 定时任务 / 检测记录 四个独立入口。 */
export function IqPane() {
  const [tab, setTab] = useState<'workbench' | 'questions' | 'tasks' | 'records'>('workbench')
  const presetVm =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.hash.split('?')[1] || '').get('vm')
      : null
  const TABS = [
    ['workbench', '检测工作台'],
    ['questions', '题库'],
    ['tasks', '定时任务'],
    ['records', '检测记录'],
  ] as const
  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap gap-1'>
        {TABS.map(([id, label]) => (
          <Button
            key={id}
            size='sm'
            variant={tab === id ? 'default' : 'outline'}
            className='h-7 px-3 text-xs'
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === 'workbench' ? <IqWorkbench presetVm={presetVm} /> : null}
      {tab === 'questions' ? <IqQuestions /> : null}
      {tab === 'tasks' ? <IqTasks /> : null}
      {tab === 'records' ? <IqRecords /> : null}
    </div>
  )
}

/** 单次检测：按槽或按 Key 选目标，选题、选模型与 effort，跑完就地看结果。 */
function IqWorkbench({ presetVm = null }: { presetVm?: string | null }) {
  const vms = useQuery({
    queryKey: ['vms-for-iq'],
    queryFn: () => api<{ items: Array<{ id: string; platform?: string; status?: string }> }>('/api/panel/vms'),
  })
  const keys = useQuery({
    queryKey: ['keys-for-iq'],
    queryFn: () => api<{ items: Array<{ id: string; name: string; allowed_vms?: string[] }> }>('/api/panel/api-keys'),
  })
  const questions = useQuery({
    queryKey: ['iq-questions'],
    queryFn: () => api<{ items: IqQuestion[] }>('/api/panel/ops/iq/questions'),
  })
  const [scopeType, setScopeType] = useState<'slot' | 'key'>('slot')
  const [slotIds, setSlotIds] = useState<string[]>(presetVm ? [presetVm] : [])
  const [keyIds, setKeyIds] = useState<string[]>([])
  const [model, setModel] = useState('gpt-6-astra')
  const [effort, setEffort] = useState('high')
  const [questionId, setQuestionId] = useState('candy')
  const [repeat, setRepeat] = useState(1)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Array<{ vm_id: string; verdict?: string; answer?: number | null; ok: boolean }>>([])

  const slotList = (vms.data?.items || []).filter((v) => String(v.platform || '').includes('codex') || v.id.startsWith('vm'))
  const selected = scopeType === 'slot' ? slotIds : keyIds

  async function run() {
    setRunning(true)
    try {
      const r = await api<{ ran: number; results: typeof results }>('/api/panel/ops/iq/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope_type: scopeType,
          scope_ids: selected,
          model,
          effort,
          question_id: questionId,
          repeat,
        }),
      })
      setResults(r.results || [])
      toast.success(`完成 ${r.ran} 次检测`)
    } catch (e) {
      toast.error(`检测失败：${(e as Error).message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className='grid gap-3 lg:grid-cols-[380px_1fr]'>
      <div className={CARD}>
        <div className='text-sm font-semibold'>检测设置</div>
        <div className='mt-3 space-y-3 text-xs'>
          <div>
            <div className='mb-1 text-muted-foreground'>检测范围</div>
            <div className='flex gap-1'>
              <Button
                size='sm'
                variant={scopeType === 'slot' ? 'default' : 'outline'}
                className='h-6 px-2 text-[11px]'
                onClick={() => setScopeType('slot')}
              >
                按槽
              </Button>
              <Button
                size='sm'
                variant={scopeType === 'key' ? 'default' : 'outline'}
                className='h-6 px-2 text-[11px]'
                onClick={() => setScopeType('key')}
              >
                按 Key
              </Button>
            </div>
          </div>
          <div>
            <div className='mb-1 text-muted-foreground'>
              {scopeType === 'slot' ? '选择槽位（不选 = 全部）' : '选择 Key（按各自白名单展开）'}
            </div>
            <div className='max-h-40 space-y-1 overflow-auto rounded border p-2'>
              {(scopeType === 'slot' ? slotList : keys.data?.items || []).map((item: any) => {
                const id = item.id
                const checked = (scopeType === 'slot' ? slotIds : keyIds).includes(id)
                return (
                  <label key={id} className='flex items-center gap-2 font-mono text-[11px]'>
                    <input
                      type='checkbox'
                      checked={checked}
                      onChange={(e) => {
                        const setter = scopeType === 'slot' ? setSlotIds : setKeyIds
                        setter((cur) => (e.target.checked ? [...cur, id] : cur.filter((x) => x !== id)))
                      }}
                    />
                    {id}
                    {scopeType === 'key' && item.name ? (
                      <span className='text-muted-foreground'>{item.name}</span>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <label className='block'>
              <span className='text-muted-foreground'>模型</span>
              <Input className='mt-1 h-7 text-[11px]' value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label className='block'>
              <span className='text-muted-foreground'>思考强度</span>
              <Select value={effort} onValueChange={setEffort}>
                <SelectTrigger className='mt-1 h-7 w-full text-[11px]'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['low', 'medium', 'high', 'xhigh'].map((x) => (
                    <SelectItem key={x} value={x}>
                      {x}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <label className='block'>
            <span className='text-muted-foreground'>题目</span>
            <Select value={questionId} onValueChange={setQuestionId}>
              <SelectTrigger className='mt-1 h-7 w-full text-[11px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='probe'>门票探针（两发）</SelectItem>
                {(questions.data?.items || []).map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.title}（
                    {q.judge_rule === 'numeric_pass'
                      ? `期望 ${q.expected}`
                      : q.judge_rule === 'structure'
                        ? '形态检查'
                        : '只记录'}
                    ）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className='block'>
            <span className='text-muted-foreground'>重复次数</span>
            <Input
              type='number'
              min={1}
              max={5}
              className='mt-1 h-7 text-[11px]'
              value={repeat}
              onChange={(e) => setRepeat(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <Button className='h-8 w-full text-xs' disabled={running} onClick={() => void run()}>
            {running ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : <Play className='mr-1 h-3 w-3' />}
            开始检测
          </Button>
        </div>
      </div>

      <div className={CARD}>
        <div className='text-sm font-semibold'>检测结果</div>
        {results.length === 0 ? (
          <div className='flex h-40 items-center justify-center text-xs text-muted-foreground'>
            选好范围与题目后开始检测，结果显示在这里
          </div>
        ) : (
          <div className='mt-2 space-y-1'>
            {results.map((r, i) => (
              <div key={`${r.vm_id}-${i}`} className='flex items-center justify-between border-b py-1 font-mono text-[11px] last:border-0'>
                <span>{r.vm_id}</span>
                <span className={verdictTone(r.verdict)}>{r.verdict}</span>
                <span className={verdictTone(r.verdict)}>{r.answer != null ? `答 ${r.answer}` : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 题库：内置题只读，自定义题可增删；每题标明判定规则，题面可展开。 */
function IqQuestions() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const questions = useQuery({
    queryKey: ['iq-questions'],
    queryFn: () => api<{ items: IqQuestion[] }>('/api/panel/ops/iq/questions'),
  })
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [expected, setExpected] = useState('')

  async function add() {
    if (!prompt.trim()) return toast.error('提示词不能为空')
    await api('/api/panel/ops/iq/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || '自定义题',
        kind: 'numeric',
        prompt,
        judge_rule: expected.trim() ? 'numeric_pass' : 'record_only',
        expected: expected.trim() || null,
        auto_support: Boolean(expected.trim()),
      }),
    })
    setTitle('')
    setPrompt('')
    setExpected('')
    toast.success('已添加题目')
    void qc.invalidateQueries({ queryKey: ['iq-questions'] })
  }

  async function remove(id: string) {
    await api(`/api/panel/ops/iq/questions/${id}`, { method: 'DELETE' })
    void qc.invalidateQueries({ queryKey: ['iq-questions'] })
  }

  return (
    <div className='space-y-3'>
      <div className={CARD}>
        <div className='text-sm font-semibold'>新增题目</div>
        <div className='mt-2 grid gap-2 md:grid-cols-3'>
          <Input placeholder='标题' className='h-7 text-[11px]' value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input
            placeholder='期望答案（留空 = 只记录不判分）'
            className='h-7 text-[11px]'
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
          <Button size='sm' className='h-7 text-[11px]' onClick={() => void add()}>
            添加
          </Button>
        </div>
        <textarea
          className='mt-2 h-20 w-full rounded border bg-background p-2 text-[11px]'
          placeholder='提示词（发送给模型的原文）'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <div className={CARD}>
        <div className='flex items-center justify-between'>
          <div className='text-sm font-semibold'>题目列表</div>
          <span className='text-[11px] text-muted-foreground'>只有 numeric_pass 的题参与自动分档</span>
        </div>
        <div className='mt-2 space-y-1'>
          {(questions.data?.items || []).map((q) => (
            <div key={q.id} className='flex items-start gap-2 border-b py-1.5 text-[11px] last:border-0'>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium'>{q.title}</span>
                  <span className='rounded bg-muted px-1 text-[10px] text-muted-foreground'>{q.id}</span>
                  <span className='rounded bg-muted px-1 text-[10px]'>
                    {q.judge_rule === 'numeric_pass' ? `期望 ${q.expected}` : q.judge_rule === 'structure' ? '形态检查' : '只记录'}
                  </span>
                  {q.builtin === 1 ? <span className='text-[10px] text-muted-foreground'>内置</span> : null}
                </div>
                <div
                  className={cn(
                    'mt-0.5 cursor-pointer whitespace-pre-wrap text-muted-foreground',
                    expanded === q.id ? '' : 'line-clamp-2',
                  )}
                  onClick={() => setExpanded(expanded === q.id ? null : q.id)}
                  title={expanded === q.id ? '点击收起' : '点击展开完整题面'}
                >
                  {q.prompt}
                </div>
              </div>
              {q.builtin === 1 ? null : (
                <Button size='sm' variant='ghost' className='h-6 px-1.5 text-[10px]' onClick={() => void remove(q.id)}>
                  删除
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 定时任务：间隔、范围、上次/下次执行、运行计数与立即执行。 */
function IqTasks() {
  const qc = useQueryClient()
  const tasks = useQuery({
    queryKey: ['iq-tasks'],
    queryFn: () => api<{ items: IqTask[]; latest: Array<{ vm_id: string; kind: string; verdict: string; started_at: string }> }>('/api/panel/ops/iq/tasks'),
    refetchInterval: 15_000,
  })
  const [running, setRunning] = useState<string | null>(null)

  async function runNow(id: string) {
    setRunning(id)
    try {
      const r = await api<{ ran: number; failed: number }>(`/api/panel/ops/iq/tasks/${id}/run`, { method: 'POST' })
      toast.success(`执行完成：${r.ran} 个账号，失败 ${r.failed}`)
      void qc.invalidateQueries({ queryKey: ['iq-tasks'] })
      void qc.invalidateQueries({ queryKey: ['iq-runs'] })
    } catch (e) {
      toast.error(`执行失败：${(e as Error).message}`)
    } finally {
      setRunning(null)
    }
  }

  async function toggle(task: IqTask) {
    await api(`/api/panel/ops/iq/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: task.enabled !== 1 }),
    })
    void qc.invalidateQueries({ queryKey: ['iq-tasks'] })
  }

  const items = tasks.data?.items || []
  return (
    <div className='grid gap-3 md:grid-cols-3'>
      {items.map((task) => (
        <div key={task.id} className={CARD}>
          <div className='flex items-start justify-between'>
            <div>
              <div className='text-sm font-semibold'>{task.name}</div>
              <div className='mt-0.5 text-[11px] text-muted-foreground'>
                {KIND_LABEL[task.kind] || task.kind} · 每 {Math.round(task.interval_sec / 60)} 分钟
                {task.only_healthy ? ' · 仅满血号' : ''}
              </div>
            </div>
            <Button
              size='sm'
              variant={task.enabled === 1 ? 'secondary' : 'outline'}
              className='h-6 px-2 text-[11px]'
              onClick={() => void toggle(task)}
            >
              {task.enabled === 1 ? '已启用' : '已停用'}
            </Button>
          </div>
          <div className='mt-2 space-y-1 text-[11px]'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>上次执行</span>
              <span className='font-mono'>{fmtAt(task.last_run_at)}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>下次执行</span>
              <span className='font-mono'>{fmtAt(task.next_run_at)}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>运行 / 失败</span>
              <span className='font-mono'>
                {task.run_count} /{' '}
                <span className={task.fail_count ? 'text-rose-600 dark:text-rose-400' : ''}>{task.fail_count}</span>
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>最近结论</span>
              <span className={cn('font-mono', verdictTone(task.last_verdict))}>{task.last_verdict || '—'}</span>
            </div>
          </div>
          <Button
            size='sm'
            variant='outline'
            className='mt-2 h-6 w-full text-[11px]'
            disabled={running === task.id}
            onClick={() => void runNow(task.id)}
          >
            {running === task.id ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : <Play className='mr-1 h-3 w-3' />}
            立即执行
          </Button>
        </div>
      ))}
    </div>
  )
}

/** 检测记录：按来源与账号筛选，单次与定时任务混在一条时间线上。 */
function IqRecords() {
  const [source, setSource] = useState('all')
  const runs = useQuery({
    queryKey: ['iq-runs', source],
    queryFn: () => api<{ items: IqRun[] }>('/api/panel/ops/iq/runs?limit=100'),
    refetchInterval: 20_000,
  })
  const items = (runs.data?.items || []).filter((r) => source === 'all' || (r.source || 'task') === source)
  return (
    <div className={CARD}>
      <div className='flex items-center justify-between'>
        <div className='text-sm font-semibold'>检测记录</div>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className='h-7 w-[120px] text-[11px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部来源</SelectItem>
            <SelectItem value='single'>单次检测</SelectItem>
            <SelectItem value='task'>定时任务</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className='mt-2 space-y-1'>
        {items.length === 0 ? (
          <div className='py-6 text-center text-xs text-muted-foreground'>还没有记录</div>
        ) : (
          items.map((run) => (
            <div key={run.id} className='flex items-center gap-2 border-b py-1 font-mono text-[11px] last:border-0'>
              <span className='shrink-0 text-muted-foreground'>{fmtAt(run.started_at)}</span>
              <span className='shrink-0 rounded bg-muted px-1 text-[10px]'>
                {run.source === 'single' ? '单次' : '任务'}
              </span>
              <span className='shrink-0'>{run.vm_id}</span>
              <span className='shrink-0 text-muted-foreground'>{run.question_id || run.model}</span>
              <span className={cn('shrink-0', verdictTone(run.verdict))}>{run.verdict}</span>
              {run.answer != null ? (
                <span className={cn('shrink-0', verdictTone(run.verdict))}>
                  答 {run.answer}/{run.expected ?? '—'}
                </span>
              ) : null}
              <span className='flex-1 truncate text-right text-muted-foreground'>
                {run.duration_ms ?? 0}ms
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function CachePane({ data }: { data: OpsSummary }) {
  const t = data.totals
  const rate = t.cache_hit_rate == null ? null : t.cache_hit_rate * 100
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <Stat
          label='命中率'
          value={rate == null ? '—' : `${rate.toFixed(1)}%`}
          tone={rate == null ? 'neutral' : rate >= 50 ? 'good' : rate >= 30 ? 'warn' : 'bad'}
        />
        <Stat label='读命中' value={formatTokenAmount(t.cache_read_tokens)} />
        <Stat
          label='写入'
          value={formatTokenAmount(t.cache_creation_tokens)}
          hint='隐式缓存链路恒 0，不算异常'
        />
        <Stat label='输入（全价）' value={formatTokenAmount(t.input_tokens)} />
      </div>
      <p className='text-[11px] leading-relaxed text-muted-foreground'>
        命中率 = 读命中 ÷（输入 + 读命中 + 写入）。Codex/ChatGPT 是隐式缓存，上游只回命中读取，
        不单独上报写入量，所以「写入 0」是正常现象。详见 docs/ops/cache.md。
      </p>
    </div>
  )
}

export function SchedPane({ data }: { data: OpsSummary }) {
  const c = data.config
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <Stat
          label='会话粘性'
          value={c.sticky_ttl_seconds == null ? '—' : `${Math.round(c.sticky_ttl_seconds / 60)} 分钟`}
          tone={c.sticky_ttl_seconds && c.sticky_ttl_seconds > 7200 ? 'warn' : 'good'}
          hint='过长会把额度堆在一个号上'
        />
        <Stat
          label='5h 闸线'
          value={c.quota_limit_5h == null ? '—' : `${Math.round(c.quota_limit_5h * 100)}%`}
          tone='neutral'
        />
        <Stat
          label='7d 闸线'
          value={c.quota_limit_7d == null ? '—' : `${Math.round(c.quota_limit_7d * 100)}%`}
          tone='neutral'
        />
        <Stat
          label='用量探测'
          value={c.usage_probe_enabled == null ? '—' : c.usage_probe_enabled ? '已开启' : '已关闭'}
          tone={c.usage_probe_enabled ? 'good' : 'bad'}
          hint='不探测就看不到额度爬升'
        />
      </div>
      <div className='flex gap-2 rounded-lg border bg-card p-3 text-xs text-muted-foreground'>
        <Clock className='mt-0.5 h-4 w-4 shrink-0' />
        <span>
          这些值来自 routing.json 的当前配置。修改入口在「设置 → 粘性 / 配额 / OpenAI」，
          改完保存立即生效，不需要重启。
        </span>
      </div>
      <div className='flex gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'>
        <TicketX className='mt-0.5 h-4 w-4 shrink-0' />
        <span>
          本轮巡检平均 TTFT {formatDuration(data.totals.avg_ttft_ms)}、首字节{' '}
          {formatDuration(data.totals.avg_first_byte_ms)}。首字节占大头时先查代理，
          思考占大头时先查 effort 与门票。
        </span>
      </div>
    </div>
  )
}
