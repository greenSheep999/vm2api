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

const CONTRACT = '所有样式与脚本内联。你不需要任何测试。只输出 HTML。'

const BUILTIN = [
  {
    id: 'candy',
    title: '糖果计数',
    kind: 'numeric',
    judge_rule: 'numeric_pass',
    expected: '21',
    auto_support: 1,
    prompt:
      '在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。' +
      '现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，' +
      '最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？' +
      '（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）\n' +
      '苹果味 桃子味 西瓜味\n圆形 7 9 8\n五角星形 7 6 4',
  },
  {
    id: 'pelican-bike',
    title: '鹈鹕骑自行车',
    kind: 'image',
    judge_rule: 'structure',
    auto_support: 1,
    prompt: '创建一个 HTML，内容是用 SVG 绘制一个鹈鹕骑自行车的 2D 动画。' + CONTRACT,
  },
  {
    id: 'polar-bear-bike',
    title: '北极熊骑自行车',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 绘制一只北极熊骑自行车的 2D 动画：北极熊体型圆润、白色毛发、黑鼻子，' +
      '坐在一辆两轮自行车上，双腿随踏板做圆周蹬踏，车轮持续转动并带辐条，背景是雪地与远处的冰山，雪花缓缓飘落。' +
      CONTRACT,
  },
  {
    id: 'ultraman-moto',
    title: '奥特曼骑摩托车',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 绘制奥特曼骑摩托车的 2D 动画：奥特曼为银红配色、头顶有鳍状冠、胸口有闪烁的计时器，' +
      '跨坐在一辆流线型摩托车上向右疾驰，车轮高速旋转、尾部拖出速度线，背景是横向滚动的城市楼群，天上偶尔有怪兽剪影掠过。' +
      CONTRACT,
  },
  {
    id: 'octopus-drums',
    title: '章鱼打架子鼓',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 绘制一只章鱼打架子鼓的 2D 动画：章鱼有 8 条可辨的触手，分别握着鼓棒，' +
      '同时敲击底鼓、军鼓、镲片等至少 5 件鼓组部件，敲击节奏要稳定循环，被击中的部件有震动或闪光反馈，章鱼头部随节拍轻微点动。' +
      CONTRACT,
  },
  {
    id: 'giraffe-skate',
    title: '长颈鹿踩滑板',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 绘制一只长颈鹿踩滑板的 2D 动画：长颈鹿脖子明显修长、带棕色斑块，' +
      '四蹄站在一块滑板上从左向右滑行，滑板轮子转动，途中遇到一个小坡道时做起跳与落地动作，' +
      '脖子随动作前后摆动，背景是热带草原与移动的云。' + CONTRACT,
  },
  {
    id: 'astro-cat-fishing',
    title: '宇航猫月球钓鱼',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 绘制一只穿宇航服的猫在月球上钓鱼的 2D 动画：猫戴着透明头盔、尾巴从宇航服后面伸出，' +
      '坐在月面环形山边缘，鱼竿伸向一片漂浮的星星湖，钓线末端不时钓起一颗闪光的星星，' +
      '背景是漆黑太空、缓慢自转的地球与散布的星点，猫会偶尔甩尾。' + CONTRACT,
  },
  {
    id: 'analog-clock',
    title: '模拟时钟 · 实时走针',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 绘制一个模拟时钟：有表盘刻度、时针、分针、秒针，读取浏览器本地时间实时走针，' +
      '秒针平滑扫动，时针随分钟联动偏移。表盘下方用数字显示当前时间。' + CONTRACT,
  },
  {
    id: 'solar-system',
    title: '太阳系轨道动画',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 绘制太阳系动画：太阳居中，至少包含水星、金星、地球、火星、木星、土星六颗行星沿各自轨道公转，' +
      '公转周期按真实比例缩放（地球 1 圈时水星约 4 圈、土星约 1/29 圈），地球带一颗绕转的月球，土星有光环，' +
      '每颗行星标注中文名称。深色星空背景带闪烁星点。' + CONTRACT,
  },
  {
    id: 'bouncing-balls',
    title: '弹跳小球物理模拟',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 Canvas 或 SVG 实现弹跳小球物理模拟：初始生成 8 个不同颜色和半径的小球，受重力作用下落，' +
      '碰到容器四壁反弹并有能量损耗，小球之间发生碰撞时按动量守恒交换速度，不允许相互穿透或卡在墙内。' +
      '点击画面任意位置新增一个小球。' + CONTRACT,
  },
  {
    id: 'gear-train',
    title: '齿轮传动机构',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 绘制一组相互啮合的齿轮传动动画：至少 4 个齿轮，齿数分别为 12、24、36、18，' +
      '齿形要真实可辨，相邻齿轮的齿必须正确啮合而不重叠或穿透，转速与齿数成反比，转向相邻相反。' +
      '用不同颜色区分齿轮，并在每个齿轮中心标注齿数。' + CONTRACT,
  },
  {
    id: 'city-parallax',
    title: '城市夜景视差滚动',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 绘制一幅横向无限滚动的城市夜景：至少三层视差（远景山脉与月亮、中景楼群、近景马路），' +
      '层速由远到近递增；楼窗随机点亮熄灭，马路上有汽车往返行驶并带车灯，天空偶尔划过流星。画面循环时不能出现接缝或跳变。' +
      CONTRACT,
  },
  {
    id: 'stroke-order',
    title: '汉字笔顺书写动画',
    kind: 'image',
    judge_rule: 'structure',
    prompt:
      '创建一个 HTML，用 SVG 路径动画演示汉字「永」的书写过程：按正确笔顺逐笔书写，共 5 笔（点、横折钩、横撇、撇、捺），' +
      '每一笔用 stroke-dashoffset 动画呈现毛笔运笔效果，笔画粗细有提按变化，写完一笔再写下一笔，' +
      '全部写完后暂停两秒重新开始。旁边列出笔顺编号。' + CONTRACT,
  },
  {
    id: 'poker',
    title: '扑克翻牌',
    kind: 'numeric',
    judge_rule: 'record_only',
    prompt:
      '一副牌37张，背面蓝红两色翻前可见；花色黑桃红心梅花翻开可知。' +
      '蓝背：黑桃6 红心4 梅花9；红背：黑桃3 红心8 梅花7。' +
      '翻前定好总张数，每翻一张可根据已翻结果决定下一张翻蓝背还是红背。' +
      '最少翻多少张才能保证同时有一张黑桃和一张红心且牌背颜色不同？只输出最终数字。',
  },
]

/**
 * 幂等补齐内置题：以前只在空表时播种，导致后续新增的内置题永远进不来。
 * 现在每次调用都按 id 补齐缺失项；已存在的不覆盖（保留运营可能做的调整）。
 */
export function ensureBuiltinQuestions() {
  const at = nowIso()
  const insert = db().prepare(
    `INSERT INTO iq_questions
       (id, title, kind, prompt, judge_rule, expected, auto_support, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
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
    // 对齐 sub 的结构门槛：至少 1 个 SVG、10 条 path、3 段 text，且含 script 或 text 标签。
    const svg = (raw.match(/<svg[\s>]/gi) || []).length
    const paths = (raw.match(/<path[\s>]/gi) || []).length
    const texts = (raw.match(/<text[\s>]/gi) || []).length
    const interactive = /<script[\s>]/i.test(raw) || texts > 0
    const ok = svg >= 1 && paths >= 10 && texts >= 3 && interactive
    return {
      answer: null,
      expected: null,
      verdict: ok ? 'structure_ok' : 'structure_missing',
      detail: `svg=${svg} path=${paths} text=${texts}`,
    }
  }
  const nums = raw.match(/-?\d{1,5}/g) || []
  return {
    answer: nums.length ? Number(nums[nums.length - 1]) : null,
    expected: null,
    verdict: 'recorded',
  }
}
