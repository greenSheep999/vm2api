/**
 * 降智检测任务：探针 / 糖果 / 鹈鹕 三类检测都可以建成独立任务。
 *
 * 每个任务有自己的间隔、状态（上次执行、下次执行、成功失败计数）和运行历史，
 * 这样「检测」是一个可观察的流程，而不是一次性按钮。
 */
import crypto from 'node:crypto'
import { getDb } from '../db/database.mjs'
import { listVms } from '../vm/vm-registry.mjs'
import { isCodexVm } from '../vm/vm-kind.mjs'
import { readCodexAccounts } from '../vm/codex-slot.mjs'
import { runCapabilityCheck, runTicketProbe } from './ticket-harvest.mjs'
import { getQuestion, judgeAnswer, listQuestions } from './iq-questions.mjs'
import { mintOnce } from './ticket-harvest.mjs'

const KINDS = new Set(['probe', 'candy', 'pelican'])
const DEFAULT_INTERVAL = { probe: 300, candy: 900, pelican: 1800 }

function db() {
  return getDb()
}

function nowIso() {
  return new Date().toISOString()
}

export function listTasks() {
  try {
    return db().prepare('SELECT * FROM iq_tasks ORDER BY created_at ASC').all()
  } catch {
    return []
  }
}

export function ensureDefaultTasks() {
  const existing = listTasks()
  if (existing.length) return existing
  createTask({ name: '门票探针', kind: 'probe', question_id: 'probe' })
  createTask({ name: '糖果题', kind: 'candy', question_id: 'candy', only_healthy: true })
  createTask({ name: '鹈鹕结构', kind: 'pelican', question_id: 'pelican-bike', only_healthy: true })
  return listTasks()
}

export function createTask({ name, kind, interval_sec = null, model = null, enabled = true, only_healthy = false, question_id = null, scope_type = 'slot', scope_ids = [], effort = null }) {
  if (!KINDS.has(kind)) throw new Error('invalid_kind')
  const id = `iq_${crypto.randomBytes(6).toString('hex')}`
  const interval = Math.max(60, Number(interval_sec) || DEFAULT_INTERVAL[kind] || 600)
  const at = nowIso()
  db()
    .prepare(
      `INSERT INTO iq_tasks (id, name, kind, interval_sec, model, enabled, only_healthy, next_run_at, created_at, updated_at,
         question_id, scope_type, scope_ids, effort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      String(name || kind),
      kind,
      interval,
      model,
      enabled ? 1 : 0,
      only_healthy ? 1 : 0,
      at,
      at,
      at,
      question_id || kind,
      scope_type,
      JSON.stringify(Array.isArray(scope_ids) ? scope_ids : []),
      effort,
    )
  return getTask(id)
}

export function getTask(id) {
  try {
    return db().prepare('SELECT * FROM iq_tasks WHERE id = ?').get(id) || null
  } catch {
    return null
  }
}

export function updateTask(id, patch = {}) {
  const task = getTask(id)
  if (!task) return null
  const next = {
    name: patch.name ?? task.name,
    interval_sec: Math.max(60, Number(patch.interval_sec ?? task.interval_sec) || task.interval_sec),
    model: patch.model === undefined ? task.model : patch.model,
    enabled: patch.enabled === undefined ? task.enabled : patch.enabled ? 1 : 0,
    only_healthy: patch.only_healthy === undefined ? task.only_healthy : patch.only_healthy ? 1 : 0,
  }
  db()
    .prepare(
      `UPDATE iq_tasks SET name = ?, interval_sec = ?, model = ?, enabled = ?, only_healthy = ?, updated_at = ? WHERE id = ?`,
    )
    .run(next.name, next.interval_sec, next.model, next.enabled, next.only_healthy, nowIso(), id)
  return getTask(id)
}

export function deleteTask(id) {
  try {
    db().prepare('DELETE FROM iq_tasks WHERE id = ?').run(id)
    return true
  } catch {
    return false
  }
}

export function listRuns({ taskId = null, vmId = null, limit = 50 } = {}) {
  const clauses = []
  const args = []
  if (taskId) {
    clauses.push('task_id = ?')
    args.push(taskId)
  }
  if (vmId) {
    clauses.push('vm_id = ?')
    args.push(vmId)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  try {
    return db()
      .prepare(`SELECT * FROM iq_task_runs ${where} ORDER BY started_at DESC LIMIT ?`)
      .all(...args, Math.max(1, Math.min(500, Number(limit) || 50)))
  } catch {
    return []
  }
}

/** 账号级最新结论：给页面做状态汇总。 */
export function latestByVm() {
  try {
    return db()
      .prepare(
        `SELECT vm_id, kind, verdict, started_at FROM (
           SELECT r.vm_id, t.kind, r.verdict, r.started_at,
                  ROW_NUMBER() OVER (PARTITION BY r.vm_id, t.kind ORDER BY r.started_at DESC) AS rn
             FROM iq_task_runs r JOIN iq_tasks t ON t.id = r.task_id
         ) WHERE rn = 1`,
      )
      .all()
  } catch {
    return []
  }
}

function targets(projectRoot, model) {
  return (listVms(projectRoot) || []).filter((vm) => vm?.id && isCodexVm(vm)).map((vm) => vm.id)
}

function probeHealthy(vmId, model) {
  try {
    const row = db()
      .prepare('SELECT probe_verdict FROM ticket_snapshots WHERE vm_id = ? AND model = ?')
      .get(vmId, model || 'gpt-6-astra')
    return row?.probe_verdict === 'healthy' || row?.probe_verdict === 'healthy_same'
  } catch {
    return false
  }
}

/** 执行一个任务：逐账号跑一遍检测，写入运行历史并推进 next_run_at。 */
export async function runTask({ projectRoot, task, model: modelOverride = null }) {
  const startedAll = Date.now()
  const model = modelOverride || task.model || 'gpt-6-astra'
  const list = targets(projectRoot, model)
  const results = []
  for (const vmId of list) {
    if (task.only_healthy && task.kind !== 'probe' && !probeHealthy(vmId, model)) continue
    const token = readCodexAccounts(projectRoot, vmId).find((a) => a?.access_token)?.access_token || null
    const vm = (await import('../vm/vm-registry.mjs')).getVm(projectRoot, vmId)
    const proxyUrl = vm?.proxy?.url || null
    const startedAt = nowIso()
    const t0 = Date.now()
    let result
    try {
      if (task.kind === 'probe') {
        result = await runTicketProbe({ projectRoot, vmId, model, policy: { models: [model] } })
      } else {
        result = await runCapabilityCheck({ vmId, model, questionId: task.kind, proxyUrl, token })
      }
    } catch (error) {
      result = { ok: false, verdict: 'error', reason: String(error?.message || error) }
    }
    const verdict = result?.verdict || result?.reason || 'unknown'
    const ok = result?.ok === true || verdict === 'pass' || verdict === 'recorded'
    db()
      .prepare(
        `INSERT INTO iq_task_runs (id, task_id, vm_id, model, verdict, answer, expected, detail, ok, started_at, finished_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `run_${crypto.randomBytes(8).toString('hex')}`,
        task.id,
        vmId,
        model,
        verdict,
        result?.answer ?? null,
        result?.expected ?? null,
        String(result?.reason || result?.detail || '').slice(0, 300),
        ok ? 1 : 0,
        startedAt,
        nowIso(),
        Date.now() - t0,
      )
    results.push({ vm_id: vmId, verdict, answer: result?.answer ?? null, ok })
  }
  const nextAt = new Date(Date.now() + task.interval_sec * 1000).toISOString()
  const failed = results.filter((r) => !r.ok).length
  db()
    .prepare(
      `UPDATE iq_tasks SET last_run_at = ?, next_run_at = ?, last_verdict = ?,
         run_count = run_count + ?, fail_count = fail_count + ?, updated_at = ? WHERE id = ?`,
    )
    .run(nowIso(), nextAt, results[0]?.verdict || null, results.length, failed, nowIso(), task.id)
  return { task_id: task.id, ran: results.length, failed, duration_ms: Date.now() - startedAll, results }
}

/** 调度入口：跑所有到点的启用任务。 */
export async function runDueTasks({ projectRoot }) {
  const due = listTasks().filter(
    (task) => task.enabled === 1 && (!task.next_run_at || Date.parse(task.next_run_at) <= Date.now()),
  )
  const out = []
  for (const task of due) out.push(await runTask({ projectRoot, task }))
  return out
}


/** 按 key 展开成槽位：key 的 allowed_vms 就是它可以调用的槽位。 */
function vmsForScope(projectRoot, scopeType, scopeIds) {
  const all = (listVms(projectRoot) || []).filter((vm) => vm?.id && isCodexVm(vm)).map((vm) => vm.id)
  if (!scopeType || scopeType === 'slot') {
    const ids = Array.isArray(scopeIds) && scopeIds.length ? scopeIds : all
    return all.filter((id) => ids.includes(id))
  }
  if (scopeType === 'key') {
    // 按 key 检测 = 用该 key 白名单里的槽位做目标
    try {
      const rows = db().prepare('SELECT allowed_vms FROM api_keys').all()
      const allow = new Set()
      for (const row of rows) {
        let list = []
        try {
          list = JSON.parse(row.allowed_vms || '[]')
        } catch {}
        if (!Array.isArray(scopeIds) || !scopeIds.length || scopeIds.some((k) => k && list.length)) {
          for (const id of list) if (all.includes(id)) allow.add(id)
        }
      }
      return all.filter((id) => allow.has(id))
    } catch {
      return []
    }
  }
  return []
}

/**
 * 单次检测：跑一道题（或探针），结果写进检测记录，来源标记 single。
 */
export async function runSingleCheck({ projectRoot, scopeType = 'slot', scopeIds = [], model = 'gpt-6-astra', effort = null, questionId = 'candy', repeat = 1 }) {
  const question = questionId === 'probe' ? null : getQuestion(questionId)
  if (questionId !== 'probe' && !question) return { ok: false, reason: 'unknown_question' }
  const list = vmsForScope(projectRoot, scopeType, scopeIds)
  if (!list.length) return { ok: false, reason: 'no_targets' }
  const results = []
  for (const vmId of list) {
    const vm = (await import('../vm/vm-registry.mjs')).getVm(projectRoot, vmId)
    const token = readCodexAccounts(projectRoot, vmId).find((a) => a?.access_token)?.access_token || null
    const proxyUrl = vm?.proxy?.url || null
    for (let i = 0; i < Math.max(1, Math.min(5, Number(repeat) || 1)); i++) {
      const startedAt = nowIso()
      const t0 = Date.now()
      let result
      try {
        if (questionId === 'probe') {
          result = await runTicketProbe({ projectRoot, vmId, model })
        } else {
          const shot = await mintOnce({ vmId, model, prompt: question.prompt, proxyUrl, token, effort })
          const judged = judgeAnswer(question, shot.text)
          result = {
            ok: judged.verdict === 'pass' || judged.verdict === 'recorded' || judged.verdict === 'structure_ok',
            ...judged,
            http: shot.status,
            text: shot.text,
          }
        }
      } catch (error) {
        result = { ok: false, verdict: 'error', reason: String(error?.message || error) }
      }
      db()
        .prepare(
          `INSERT INTO iq_task_runs (id, task_id, vm_id, model, verdict, answer, expected, detail, ok, started_at, finished_at, duration_ms, source, question_id, effort, tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `run_${crypto.randomBytes(8).toString('hex')}`,
          'single',
          vmId,
          model,
          result?.verdict || 'unknown',
          result?.answer ?? null,
          result?.expected ?? null,
          String(result?.reason || result?.text || '').slice(0, 300),
          result?.ok ? 1 : 0,
          startedAt,
          nowIso(),
          Date.now() - t0,
          'single',
          questionId,
          effort,
          result?.tokens ?? null,
        )
      results.push({ vm_id: vmId, verdict: result?.verdict, answer: result?.answer ?? null, ok: result?.ok === true })
    }
  }
  return { ok: true, ran: results.length, results }
}

export function listQuestionsForApi() {
  return listQuestions()
}


/**
 * 结果视图：把检测记录按「Key」聚合，并带上题目类型，供结果页筛选。
 * Key 与槽位的对应关系来自 api_keys.allowed_vms。
 */
export function listResults({ kind = null, limit = 200 } = {}) {
  let rows = []
  try {
    rows = db()
      .prepare(
        `SELECT r.*, q.kind AS question_kind, q.title AS question_title
           FROM iq_task_runs r
           LEFT JOIN iq_questions q ON q.id = r.question_id
          ORDER BY r.started_at DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(1000, Number(limit) || 200)))
  } catch {
    return { items: [], keys: [] }
  }

  // 槽位 → 可调用它的 Key（一个槽可以属于多个 Key）
  const keyByVm = new Map()
  const keyList = []
  try {
    const keys = db().prepare('SELECT id, name, allowed_vms FROM api_keys').all()
    for (const k of keys) {
      keyList.push({ id: k.id, name: k.name })
      let allow = []
      try {
        allow = JSON.parse(k.allowed_vms || '[]')
      } catch {}
      for (const vmId of allow) {
        if (!keyByVm.has(vmId)) keyByVm.set(vmId, [])
        keyByVm.get(vmId).push({ id: k.id, name: k.name })
      }
    }
  } catch {}

  const items = rows
    .filter((row) => (kind ? row.question_kind === kind || row.question_id === kind : true))
    .map((row) => ({
      ...row,
      keys: keyByVm.get(row.vm_id) || [],
    }))
  return { items, keys: keyList, keyByVm: Object.fromEntries(keyByVm) }
}
