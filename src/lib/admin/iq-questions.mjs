/**
 * 题库：每道题带判定规则。
 *
 * - numeric_pass：有期望值，答对才算通过（糖果题期望 21）
 * - record_only：没有校准过期望值，只记录答案，不参与分档（扑克/鹈鹕类）
 * - structure：检查输出形态（例如是否返回了可用的 HTML/SVG）
 */
import crypto from 'node:crypto'
import { getDb } from '../db/database.mjs'

function db() {
  return getDb()
}

function nowIso() {
  return new Date().toISOString()
}

const BUILTIN = [
  {
    id: 'candy',
    title: '糖果计数',
    kind: 'numeric',
    judge_rule: 'numeric_pass',
    expected: '21',
    auto_support: 1,
    prompt:
      '袋子里有三种口味糖果，每种有圆形和五角星两种形状（形状可摸出）。' +
      '圆形：苹果7 桃子9 西瓜8；五角星：苹果7 桃子6 西瓜4。' +
      '预先定好摸出个数，最少摸多少个才能保证同时拥有不同形状的苹果味和桃子味？只输出最终数字。',
  },
  {
    id: 'poker',
    title: '扑克翻牌',
    kind: 'numeric',
    judge_rule: 'record_only',
    auto_support: 0,
    prompt:
      '一副牌37张，背面蓝红两色翻前可见；花色黑桃红心梅花翻开可知。' +
      '蓝背：黑桃6 红心4 梅花9；红背：黑桃3 红心8 梅花7。' +
      '翻前定好总张数，每翻一张可根据已翻结果决定下一张翻蓝背还是红背。' +
      '最少翻多少张才能保证同时有一张黑桃和一张红心且牌背颜色不同？只输出最终数字。',
  },
  {
    id: 'pelican-bike',
    title: '鹈鹕骑自行车',
    kind: 'image',
    judge_rule: 'structure',
    auto_support: 0,
    prompt:
      '创建一个 HTML，内容是用 SVG 绘制一个鹈鹕骑自行车的 2D 动画。' +
      '所有样式与脚本内联。你不需要任何测试。只输出 HTML。',
  },
]

export function ensureBuiltinQuestions() {
  const count = db().prepare('SELECT COUNT(*) AS n FROM iq_questions').get()?.n || 0
  if (count > 0) return listQuestions()
  const at = nowIso()
  const insert = db().prepare(
    `INSERT OR REPLACE INTO iq_questions
       (id, title, kind, prompt, judge_rule, expected, auto_support, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
  for (const q of BUILTIN) {
    insert.run(q.id, q.title, q.kind, q.prompt, q.judge_rule, q.expected, q.auto_support, at, at)
  }
  return listQuestions()
}

export function listQuestions() {
  try {
    return db().prepare('SELECT * FROM iq_questions ORDER BY builtin DESC, created_at ASC').all()
  } catch {
    return []
  }
}

export function getQuestion(id) {
  try {
    return db().prepare('SELECT * FROM iq_questions WHERE id = ?').get(id) || null
  } catch {
    return null
  }
}

export function createQuestion({ title, kind = 'numeric', prompt, judge_rule = 'record_only', expected = null, auto_support = false }) {
  const id = `q_${crypto.randomBytes(5).toString('hex')}`
  const at = nowIso()
  db()
    .prepare(
      `INSERT INTO iq_questions (id, title, kind, prompt, judge_rule, expected, auto_support, builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, String(title || '自定义题'), kind, String(prompt || ''), judge_rule, expected, auto_support ? 1 : 0, at, at)
  return getQuestion(id)
}

export function deleteQuestion(id) {
  const q = getQuestion(id)
  if (!q || q.builtin === 1) return false
  db().prepare('DELETE FROM iq_questions WHERE id = ?').run(id)
  return true
}

/** 判定：numeric_pass 比期望值；record_only 只记录；structure 看输出形态。 */
export function judgeAnswer(question, text) {
  const raw = String(text || '')
  if (!question) return { answer: null, expected: null, verdict: 'unknown_question' }
  if (question.judge_rule === 'numeric_pass') {
    const nums = raw.match(/-?\d{1,5}/g) || []
    const answer = nums.length ? Number(nums[nums.length - 1]) : null
    const expected = Number(question.expected)
    return {
      answer,
      expected,
      verdict: answer === expected ? 'pass' : answer == null ? 'no_answer' : 'fail',
    }
  }
  if (question.judge_rule === 'structure') {
    const ok = /<svg[\s>]/i.test(raw) || /<html[\s>]/i.test(raw)
    return { answer: null, expected: null, verdict: ok ? 'structure_ok' : 'structure_missing' }
  }
  const nums = raw.match(/-?\d{1,5}/g) || []
  return {
    answer: nums.length ? Number(nums[nums.length - 1]) : null,
    expected: null,
    verdict: 'recorded',
  }
}
