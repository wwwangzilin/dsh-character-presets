/**
 * 露娜 · 生理层（vitals）
 * ============================================================================
 * 把情绪状态**派生**成一组生理事实，向模型注入一行身体描述。
 *
 * 设计原则（对齐 issue #1）：
 *   只报告，不命令 —— 不是「你现在应该害羞」，而是「你此刻心跳 112」。
 *   角色如何反应，由角色自己决定。
 *
 * 生理层不是医学模拟，而是角色内在状态的物理化表达。因此：
 *   · 输入只有情绪状态（mood / energy / patience / interest / tension）
 *   · 输出只有三个数字（心率 / 体温 / 呼吸频率）
 *   · 有**惯性**：身体比情绪慢半拍，不会一句话跳一次
 *   · 基线之上永远保留一点波动（她有自己的脾气）
 *
 * 本模块是纯函数集合，不依赖 Cordis，可单独测试。
 */

/** 默认基线：露娜静息心率 72，体温 36.5℃，呼吸 16 次/分。 */
export const VITALS_DEFAULTS = {
  baseline: { heartRate: 72, bodyTemp: 36.5, breath: 16 },
  sensitivity: { heartRate: 24, bodyTemp: 0.35, breath: 10 },
  /** 惯性：0 = 完全不动，1 = 立刻跟上情绪（默认慢半拍） */
  inertia: 0.5,
  /** 基线之上的自然波动（心率 ±、体温 ±） */
  jitter: { heartRate: 1.6, bodyTemp: 0.04 },
}

/** 心情对生理基线的小幅偏移——傲娇就是「嘴硬但心跳快」。 */
const MOOD_OFFSET = {
  傲娇: { heartRate: 4, bodyTemp: 0.10 },
  撒娇: { heartRate: 2, bodyTemp: 0.08 },
  开心: { heartRate: 6, bodyTemp: 0.15 },
  生气: { heartRate: 10, bodyTemp: 0.25 },
  委屈: { heartRate: 2, bodyTemp: -0.05 },
  心疼: { heartRate: 5, bodyTemp: 0.10 },
  平淡: { heartRate: 0, bodyTemp: 0 },
}

/** 中性点：低于它 → 生理下沉，高于它 → 生理上扬。 */
const NEUTRAL = { tension: 25, energy: 60, interest: 60 }

/** 把 state 归一到 -0.35..1 的「兴奋度」——以中性点为基准的偏离，平静时贴近 0。 */
export function excitementOf(state = {}) {
  const tension = Number(state.tension ?? NEUTRAL.tension)
  const energy = Number(state.energy ?? NEUTRAL.energy)
  const interest = Number(state.interest ?? NEUTRAL.interest)
  const drift =
    ((tension - NEUTRAL.tension) / 100) * 0.6 +
    ((energy - NEUTRAL.energy) / 100) * 0.25 +
    ((interest - NEUTRAL.interest) / 100) * 0.15
  return clamp(drift * 1.6, -0.35, 1)
}

/**
 * 由情绪状态派生目标生理值（未平滑）。
 * @param {object} state 情绪状态
 * @param {object} [config] 覆盖 baseline / sensitivity / jitter
 */
export function deriveVitals(state = {}, config = {}) {
  const baseline = { ...VITALS_DEFAULTS.baseline, ...(config.baseline ?? {}) }
  const sensitivity = { ...VITALS_DEFAULTS.sensitivity, ...(config.sensitivity ?? {}) }
  const jitter = { ...VITALS_DEFAULTS.jitter, ...(config.jitter ?? {}) }
  const offset = MOOD_OFFSET[state.mood] ?? MOOD_OFFSET.平淡

  const excitement = excitementOf(state)
  const patience = clamp01(Number(state.patience ?? 80) / 100)

  // 耐心见底时会有点烦躁，呼吸先乱
  const strain = clamp01(1 - patience) * 0.3

  const heartRate = baseline.heartRate
    + excitement * sensitivity.heartRate
    + offset.heartRate
    + wobble(jitter.heartRate)

  const bodyTemp = baseline.bodyTemp
    + excitement * sensitivity.bodyTemp
    + offset.bodyTemp
    + wobble(jitter.bodyTemp)

  const breath = baseline.breath
    + excitement * sensitivity.breath
    + strain * sensitivity.breath * 0.4
    + wobble(jitter.heartRate * 0.4)

  return {
    heartRate: Math.round(heartRate),
    bodyTemp: Math.round(bodyTemp * 100) / 100,
    breath: Math.round(breath),
  }
}

/**
 * 惯性平滑：身体比情绪慢半拍。prev 为空时直接采用目标值。
 */
export function smoothVitals(prev, target, inertia = VITALS_DEFAULTS.inertia) {
  if (!prev) return { ...target }
  const k = clamp01(Number(inertia))
  const mix = (a, b) => Math.round((a + (b - a) * k) * 100) / 100
  return {
    heartRate: Math.round(mix(prev.heartRate ?? b0(target.heartRate), target.heartRate)),
    bodyTemp: mix(prev.bodyTemp ?? target.bodyTemp, target.bodyTemp),
    breath: Math.round(mix(prev.breath ?? target.breath, target.breath)),
  }
}

/** 一步到位：派生 + 平滑。返回新的 vitals（不修改入参）。 */
export function deriveAndSmooth(state, prev, config = {}) {
  const target = deriveVitals(state, config)
  const inertia = config.inertia ?? VITALS_DEFAULTS.inertia
  return smoothVitals(prev, target, inertia)
}

/** 呼吸的文字描述（只描述事实，不描述感受）。 */
export function breathWord(breath) {
  const b = Number(breath ?? VITALS_DEFAULTS.baseline.breath)
  if (b >= 30) return '很急促'
  if (b >= 24) return '有点急'
  if (b >= 20) return '略快'
  if (b <= 12) return '很浅很慢'
  if (b <= 14) return '偏慢'
  return '平稳'
}

/**
 * 生成注入给模型的一行身体事实。形如：
 *   心跳 94，体温 36.8℃，呼吸略快
 * 刻意不写「你很紧张」——那是结论，不是事实。
 */
export function describeVitals(v) {
  if (!v || typeof v.heartRate !== 'number') return ''
  const temp = Number(v.bodyTemp ?? VITALS_DEFAULTS.baseline.bodyTemp).toFixed(1)
  return `心跳 ${v.heartRate}，体温 ${temp}℃，呼吸${breathWord(v.breath)}`
}

/* --------------------------------- helpers -------------------------------- */

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo
  return n < lo ? lo : n > hi ? hi : n
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function b0(v) {
  return typeof v === 'number' ? v : 0
}

/** 基线之上的自然波动（她有自己的脾气）。 */
function wobble(range) {
  if (!range) return 0
  return (Math.random() * 2 - 1) * range
}
