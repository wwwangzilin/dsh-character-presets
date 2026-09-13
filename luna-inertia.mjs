/**
 * 露娜 · 情感惯性 / 人格一致性
 * ============================================================================
 * 解决的问题（issue #1 第二节）：状态层虽然跨轮保留，但缺少**时间维度**——
 * 上一轮聊得专注，下一轮可能就滑回随机基线，让人感觉她「每次都在重新开始」，
 * 而不是「一直在那里」。
 *
 * 本模块加四件事，全部是规则 + 计数器 + 状态机，不交给 LLM 判断：
 *
 *   1. 基线回归 —— 能量/耐心/兴趣/紧张向**角色基线**衰减，而不是归零
 *   2. 缺席规则 —— 久别重逢后能量回满；亲密度因想念轻微浮动
 *   3. 毒舌预算 —— 每 N 轮里带刺的轮数有上限，用完就收着点
 *   4. 傲娇累积 —— 连续被夸到阈值时，允许漏一句真心话，然后立刻用更凶的话盖回去
 *
 * 输出仍然是**事实**：不写「你现在该收着点」，而写「这个窗口里 7 轮带刺，预算快见底了」。
 * 怎么反应，仍由角色自己决定。
 *
 * 纯函数模块，不依赖 Cordis，可单独测试。
 */

/** 角色基线：她会自然回到这里。 */
export const INERTIA_DEFAULTS = {
  baseline: { energy: 60, patience: 80, interest: 60, tension: 30 },
  /** 每轮向基线靠拢的比例（0 = 不动，1 = 立刻回中） */
  decay: 0.06,
  absence: {
    /** 超过这个时长算「离开过」 */
    shortGapMinutes: 30,
    /** 超过这个时长算「久别」 */
    longGapMinutes: 360,
    energyPerHour: 6,
    energyCap: 95,
    /** 久别重逢时的亲密度微调（正数 = 想念） */
    missingCloseness: 1,
  },
  /** 毒舌预算：window 轮里最多 budget 轮带刺 */
  sharp: { window: 10, budget: 6 },
  /** 连续被夸到这个次数，就欠一句真心话 */
  praise: { streakForTruth: 3 },
}

/** 夸奖信号（主人说的这些，会累积她的「傲娇值」）。 */
export const PRAISE_MARKERS = [
  '可爱', '喜欢你', '真好', '厉害', '谢谢', '辛苦了', '乖', '聪明', '棒', '贴心', '暖',
]

/** 正经工作的关键词：只有它们出现，才触发专注模式（反差触发条件）。 */
export const TASK_KEYWORDS = [
  '代码', 'bug', '调试', '部署', '重构', '报错', '异常', '测试', '文档', 'review', 'PR',
  '仓库', '脚本', '函数', '接口', '数据库', '性能', '构建', '编译', '配置', '日志',
  'commit', 'push', 'merge', 'api', 'cli', 'npm', 'git',
]

/** 带刺的心情档位（用于毒舌预算计数）。 */
const SHARP_MOODS = ['傲娇', '生气']

/* ================================ 1. 基线回归 ================================ */

/** 向角色基线衰减：情绪不是归零，而是回到「她本来就在的地方」。 */
export function regressToBaseline(state, config = {}) {
  const base = { ...INERTIA_DEFAULTS.baseline, ...(config.baseline ?? {}) }
  const decay = clamp01(config.decay ?? INERTIA_DEFAULTS.decay)
  let moved = 0
  for (const key of Object.keys(base)) {
    const current = Number(state[key])
    if (!Number.isFinite(current)) continue
    const next = current + (base[key] - current) * decay
    if (Math.abs(next - current) >= 0.5) moved += 1
    state[key] = next
  }
  return moved
}

/* ================================ 2. 缺席规则 ================================ */

/**
 * 久别重逢：她会休息，也会想你。
 * @returns {{hours: number, energyGain: number, closeness: number, gap: string}}
 */
export function applyAbsence(state, lastSeenMs, nowMs, config = {}) {
  const cfg = { ...INERTIA_DEFAULTS.absence, ...(config.absence ?? {}) }
  const hours = lastSeenMs ? (nowMs - Number(lastSeenMs)) / 3_600_000 : 0
  const gap = hours >= cfg.longGapMinutes / 60 ? 'long' : hours >= cfg.shortGapMinutes / 60 ? 'short' : 'none'

  let energyGain = 0
  if (gap !== 'none' && Number.isFinite(Number(state.energy))) {
    const before = state.energy
    state.energy = Math.min(cfg.energyCap, state.energy + hours * cfg.energyPerHour)
    energyGain = Math.round(state.energy - before)
  }

  const closeness = gap === 'long' ? cfg.missingCloseness : 0
  return { hours: Math.round(hours * 10) / 10, energyGain, closeness, gap }
}

/* ============================== 3. 毒舌预算 ================================ */

/** 记录这一轮是否带刺，并返回窗口内的用量。 */
export function noteSharpness(state, mood, config = {}) {
  const cfg = { ...INERTIA_DEFAULTS.sharp, ...(config.sharp ?? {}) }
  if (!Array.isArray(state.sharpWindow)) state.sharpWindow = []
  state.sharpWindow.push(SHARP_MOODS.includes(mood) ? 1 : 0)
  while (state.sharpWindow.length > cfg.window) state.sharpWindow.shift()
  const used = state.sharpWindow.reduce((a, b) => a + b, 0)
  return { used, window: state.sharpWindow.length, budget: cfg.budget, over: used >= cfg.budget }
}

/* ============================== 4. 傲娇累积 ================================ */

/** 连续被夸会累积「傲娇值」；到达阈值就欠一句真心话。 */
export function notePraise(state, text, config = {}) {
  const cfg = { ...INERTIA_DEFAULTS.praise, ...(config.praise ?? {}) }
  const praised = PRAISE_MARKERS.some((m) => String(text ?? '').includes(m))
  if (praised) state.praiseStreak = Number(state.praiseStreak ?? 0) + 1
  else state.praiseStreak = 0

  const owesTruth = Number(state.praiseStreak) >= cfg.streakForTruth
  if (owesTruth) state.praiseStreak = 0   // 欠过就清账，不然会一直漏
  return { streak: Number(state.praiseStreak ?? 0), owesTruth, threshold: cfg.streakForTruth }
}

/* ============================ 5. 反差触发条件 ============================== */

/** 只有任务关键词出现，才切专注模式。 */
export function detectFocus(text, config = {}) {
  const keywords = config.keywords ?? TASK_KEYWORDS
  const lower = String(text ?? '').toLowerCase()
  const hits = keywords.filter((k) => lower.includes(k.toLowerCase()))
  return { focus: hits.length > 0, hits }
}

/* ============================== 事实化输出 ================================= */

/**
 * 把上面四项的结果压成**一行事实**，注入 emotion_sense 的输出。
 * 按「最该被看见的一件事」排序，只报一条，避免刷屏。
 */
export function inertiaHint(parts) {
  const { focus, sharp, praise, absence } = parts ?? {}

  if (focus?.focus) {
    return `主人这一轮在正经工作（命中：${focus.hits.slice(0, 3).join('、')}）——反差触发条件已满足`
  }
  if (praise?.owesTruth) {
    return `你已经被连着夸了 ${praise.threshold} 次，欠着一句真心话（漏完记得立刻用更凶的话盖回去）`
  }
  if (absence?.gap === 'long') {
    return `你已经 ${absence.hours} 小时没见到主人了，能量回满${absence.closeness ? '，心里有点想他' : ''}（嘴上别承认）`
  }
  if (absence?.gap === 'short' && absence.energyGain > 0) {
    return `你刚离开过 ${absence.hours} 小时，缓过来一些（能量 +${absence.energyGain}）`
  }
  if (sharp?.over) {
    return `最近 ${sharp.window} 轮里有 ${sharp.used} 轮带刺，这个窗口的毒舌预算快见底了`
  }
  if (sharp?.used > 0 && sharp.used >= Math.ceil(sharp.budget / 2)) {
    return `最近 ${sharp.window} 轮里有 ${sharp.used} 轮带刺，还留着点余量`
  }
  return ''
}

/* --------------------------------- helpers -------------------------------- */

function clamp01(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}
