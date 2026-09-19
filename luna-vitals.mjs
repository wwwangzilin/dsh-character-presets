/**
 * 露娜 · 生理层（vitals）v2
 * ============================================================================
 * 把情绪状态**派生**成一组生理事实，向模型注入一行身体描述。
 *
 * 设计原则（对齐 issue #1）：只报告，不命令 —— 不是「你现在应该害羞」，
 * 而是「耳朵尖发烫」。角色如何反应，由角色自己决定。
 *
 * ── v1 为什么不够 ──────────────────────────────────────────────────────────
 *   输出恒为「心跳 79，体温 36.7℃，呼吸平稳」，问题有四：
 *     · 三个数字都是**全身性**的，没有一处是「她的身体」在反应——
 *       可露娜的破绽长在耳朵、尾巴、指尖上，这些地方 v1 一个字都没有
 *     · 精度假得像仪表盘：36.6℃ 和 36.5℃ 的差别对她、对读者都没有意义，
 *       而且**每轮都报**，说多了就变成噪音，模型会开始忽略这一行
 *     · 呼吸与心情脱钩（MOOD_OFFSET 只覆盖心率与体温），
 *       于是「呼吸平稳」在暴怒时也会出现，自相矛盾
 *     · 抖动是纯随机数、无方向：傲娇和委屈抖得一模一样，
 *       随机性没换来「她有自己的脾气」，只换来不可信
 *
 * ── v2 改了什么 ────────────────────────────────────────────────────────────
 *   原则不变，但报告的是**能演出来的事实**：
 *     1. 局部体感优先 —— 按心情 + 强度给「耳朵尖发烫」「尾巴僵住」这类可动作化的细节
 *     2. 数字降级 —— 平静时不给数字（「心跳平稳」），只在真正激动时才报（「心跳 112」）
 *     3. 呼吸入列 —— 呼吸有自己的心情偏移，与心率同源但不同步
 *     4. 抖动有方向 —— 按心情偏向一侧（傲娇偏上、委屈偏下），随机只占四成
 *     5. 时间维度 —— 久别再见到你心跳会快一点，深夜体温低一点
 *
 * 本模块是纯函数集合，不依赖 Cordis，可单独测试。
 */

/** 默认基线：露娜静息心率 72，体温 36.5℃，呼吸 16 次/分。 */
export const VITALS_DEFAULTS = {
  baseline: { heartRate: 72, bodyTemp: 36.5, breath: 16 },
  sensitivity: { heartRate: 24, bodyTemp: 0.35, breath: 10 },
  /** 惯性：0 = 完全不动，1 = 立刻跟上情绪（默认慢半拍） */
  inertia: 0.5,
  /** 基线之上的自然波动（心率 ±、体温 ±、呼吸 ±） */
  jitter: { heartRate: 1.6, bodyTemp: 0.04, breath: 0.8 },
}

/** 心情对生理基线的小幅偏移——傲娇就是「嘴硬但心跳快」。 */
const MOOD_OFFSET = {
  傲娇: { heartRate: 7, bodyTemp: 0.10, breath: 1.5 },
  撒娇: { heartRate: 2, bodyTemp: 0.08, breath: 1.0 },
  开心: { heartRate: 6, bodyTemp: 0.15, breath: 2.0 },
  生气: { heartRate: 10, bodyTemp: 0.25, breath: 6.0 },
  委屈: { heartRate: -2, bodyTemp: -0.05, breath: -1.0 },
  心疼: { heartRate: 7, bodyTemp: 0.10, breath: -1.5 },
  焦虑: { heartRate: 8, bodyTemp: 0.08, breath: 7.0 },
  平淡: { heartRate: 0, bodyTemp: 0, breath: 0 },
}

/**
 * 抖动的方向偏置。身体不会随机乱跳，她是「往某个方向偏」。
 * 正数 = 整体偏高（心跳快、体温高），负数 = 整体偏低。
 */
const MOOD_DRIFT = {
  傲娇: 0.35, 撒娇: 0.15, 开心: 0.3, 生气: 0.7,
  焦虑: 0.6, 心疼: 0.1, 委屈: -0.45, 平淡: 0,
}

/**
 * 局部体感表：每档强度一层，索引 = intensity - 1。
 * 这些词是给角色「演」的抓手——耳朵、尾巴、指尖、喉咙，露娜的破绽都在这些地方。
 *
 * 约定：这里**不许出现「呼吸」**。呼吸由 breathWord 统一描述，
 * 两边都给会写出「呼吸短促，呼吸又急又浅」这种叠句。
 */
const SENSATIONS = {
  傲娇: [
    ['耳朵尖有点热'],
    ['耳朵尖发烫', '视线飘到别处'],
    ['耳朵烫得像要烧起来', '尾巴僵着一动不动', '嘴抿成一条线'],
  ],
  开心: [
    ['脚步有点轻'],
    ['尾巴甩个不停', '眼睛发亮'],
    ['尾巴翘得老高', '忍不住笑出声', '脚底下像装了弹簧'],
  ],
  生气: [
    ['后颈有点紧'],
    ['后颈绷住', '手指攥紧'],
    ['后颈发硬', '下颌咬紧', '尾巴竖成一根杆'],
  ],
  撒娇: [
    ['声音软下来'],
    ['声音软下来', '往你那边挪了半步'],
    ['黏着不肯走', '声音黏糊糊的', '手指勾着你衣角'],
  ],
  委屈: [
    ['鼻子有点酸'],
    ['鼻子发酸', '声音闷闷的'],
    ['喉咙堵住', '眼眶发热', '尾巴垂下去'],
  ],
  心疼: [
    ['心口轻轻一紧'],
    ['心口发紧', '眉头皱起来'],
    ['心口揪着', '眉头一直没松开', '手伸出去又收回来'],
  ],
  焦虑: [
    ['手心有点潮'],
    ['手心出汗', '坐不住'],
    ['手心全是汗', '膝盖抖', '坐立不安'],
  ],
  难过: [
    ['胸口发闷'],
    ['胸口发闷', '手指发凉'],
    ['喉咙发紧', '指尖冰凉', '肩膀塌下来'],
  ],
  认真工作: [
    ['眼神沉下来'],
    ['眼神沉下来', '肩膀放松'],
    ['整个人静下来', '眼神专注'],
  ],
  平淡: [
    [],
    ['肩膀松下来'],
    ['肩膀放松下来'],
  ],
}

/** 局部体感兜底：心情不在表里时用这组通用反应。 */
const SENSATIONS_FALLBACK = [
  [],
  ['肩膀绷着'],
  ['肩膀绷紧', '身体往前倾'],
]

/** 中性点：低于它 → 生理下沉，高于它 → 生理上扬。 */
const NEUTRAL = { tension: 25, energy: 60, interest: 60 }

/** 久别重逢的阈值与加成。 */
const ABSENCE = { hours: 48, heartRate: 4 }

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

/** 强度分档 1..3：兴奋度为主，心情本身的自带强度为辅。 */
export function intensityOf(state = {}) {
  const excitement = excitementOf(state)
  const mood = String(state.mood ?? '平淡')
  const moodBias = { 生气: 0.5, 焦虑: 0.4, 开心: 0.2, 傲娇: 0.15, 委屈: -0.1, 心疼: 0.05, 平淡: 0 }[mood] ?? 0
  const raw = excitement + moodBias
  if (raw >= 0.55) return 3
  if (raw >= 0.2) return 2
  return 1
}

/** 距离上次见面多久（小时）；没有记录时返回 null。 */
function hoursSince(state, now) {
  const last = Number(state?.lastSeenMs)
  if (!Number.isFinite(last) || last <= 0) return null
  const h = (now - last) / 3_600_000
  return h > 0 ? h : null
}

/**
 * 由情绪状态派生目标生理值（未平滑）。
 * @param {object} state 情绪状态（mood / energy / patience / interest / tension，可选 lastSeenMs）
 * @param {object} [config] 覆盖 baseline / sensitivity / jitter / now
 */
export function deriveVitals(state = {}, config = {}) {
  const baseline = { ...VITALS_DEFAULTS.baseline, ...(config.baseline ?? {}) }
  const sensitivity = { ...VITALS_DEFAULTS.sensitivity, ...(config.sensitivity ?? {}) }
  const jitter = { ...VITALS_DEFAULTS.jitter, ...(config.jitter ?? {}) }
  const mood = String(state.mood ?? '平淡')
  const offset = MOOD_OFFSET[mood] ?? MOOD_OFFSET.平淡
  const bias = MOOD_DRIFT[mood] ?? 0

  const excitement = excitementOf(state)
  const patience = clamp01(Number(state.patience ?? 80) / 100)

  // 耐心见底时会有点烦躁，呼吸先乱
  const strain = clamp01(1 - patience) * 0.3

  // 时间维度：久别再见到你，心跳会先快一步
  const away = hoursSince(state, Number(config.now ?? Date.now()))
  const reunion = away !== null && away >= ABSENCE.hours ? ABSENCE.heartRate : 0

  // 昼夜节律：困的时候什么都慢半拍。config.hour 由调用方给（纯函数不读系统时钟）
  const rhythm = rhythmOf(config.hour)
  const sleepy = rhythm?.sleepiness ?? 0

  const heartRate = baseline.heartRate
    + excitement * sensitivity.heartRate
    + offset.heartRate
    + reunion
    - sleepy * 4
    + drift(bias, jitter.heartRate)

  const bodyTemp = baseline.bodyTemp
    + excitement * sensitivity.bodyTemp
    + offset.bodyTemp
    - sleepy * 0.15
    + drift(bias, jitter.bodyTemp)

  const breath = baseline.breath
    + excitement * sensitivity.breath
    + offset.breath
    + strain * sensitivity.breath * 0.4
    - sleepy * 3
    + drift(bias, jitter.breath)

  return {
    heartRate: Math.round(heartRate),
    bodyTemp: Math.round(bodyTemp * 100) / 100,
    breath: Math.round(breath),
    mood,
    intensity: intensityOf(state),
    rhythm,
  }
}

/**
 * 惯性平滑：身体比情绪慢半拍。prev 为空时直接采用目标值。
 * 心情与强度不经平滑——它们当轮就该生效，慢半拍的只有身体数字。
 */
export function smoothVitals(prev, target, inertia = VITALS_DEFAULTS.inertia) {
  if (!prev) return { ...target }
  const k = clamp01(Number(inertia))
  const mix = (a, b) => Math.round((a + (b - a) * k) * 100) / 100
  return {
    heartRate: Math.round(mix(prev.heartRate ?? b0(target.heartRate), target.heartRate)),
    bodyTemp: mix(prev.bodyTemp ?? target.bodyTemp, target.bodyTemp),
    breath: Math.round(mix(prev.breath ?? target.breath, target.breath)),
    mood: target.mood ?? prev.mood,
    intensity: target.intensity ?? prev.intensity,
  }
}

/** 一步到位：派生 + 平滑。返回新的 vitals（不修改入参）。 */
export function deriveAndSmooth(state, prev, config = {}) {
  const target = deriveVitals(state, config)
  const inertia = config.inertia ?? VITALS_DEFAULTS.inertia
  return smoothVitals(prev, target, inertia)
}

/* ------------------------------- 昼夜节律 --------------------------------- */

/**
 * 昼夜节律：同样的心情，凌晨三点和下午三点不是一回事。
 *
 * 这是全套里最便宜的真实感来源——它不需要任何记忆或状态，
 * 只要一个钟点，就能让「今天的她」和「昨天同一时刻的她」不一样。
 *
 * @param {number} hour 0-23（超出范围自动绕回）
 * @returns {{ hour:number, sleepiness:number, hunger:number, label:string } | null}
 */
export function rhythmOf(hour) {
  const raw = Number(hour)
  if (!Number.isFinite(raw)) return null
  const h = ((raw % 24) + 24) % 24

  // 困倦：凌晨硬撑区，上午最清醒，午后一个小坑
  let sleepiness
  if (h < 5) sleepiness = 0.9
  else if (h < 7) sleepiness = 0.6      // 被吵醒
  else if (h < 9) sleepiness = 0.3      // 刚醒
  else if (h < 12) sleepiness = 0.05    // 最清醒
  else if (h < 14) sleepiness = 0.35    // 午后困
  else if (h < 18) sleepiness = 0.1
  else if (h < 22) sleepiness = 0.3
  else sleepiness = 0.65

  // 饥饿：按饭点走，饭前最饿
  let hunger
  if (h >= 6 && h < 9) hunger = 0.3
  else if (h < 12) hunger = 0.6
  else if (h < 14) hunger = 0.7
  else if (h < 18) hunger = 0.5
  else if (h < 20) hunger = 0.75
  else hunger = 0.35

  const label = h < 5 ? '深夜' : h < 9 ? '清晨' : h < 12 ? '上午'
    : h < 14 ? '中午' : h < 18 ? '下午' : h < 22 ? '傍晚' : '夜里'

  return { hour: h, sleepiness, hunger, label }
}

/** 节律带来的那一条体感（困优先于饿，一次只出一条）。 */
export function rhythmSensation(rhythm) {
  if (!rhythm || typeof rhythm !== 'object') return ''
  if (Number(rhythm.sleepiness) >= 0.6) return '眼皮发沉'
  if (Number(rhythm.hunger) >= 0.7) return '肚子在叫'
  if (Number(rhythm.sleepiness) >= 0.3) return '打了个哈欠'
  return ''
}

/** 节律的注入文本。 */
export function rhythmLine(hour) {
  const r = rhythmOf(hour)
  if (r === null) return ''
  if (r.sleepiness >= 0.6) return `${r.label}：你困得眼睛发涩，脑子转不太动（想不想硬撑，你自己决定）`
  if (r.hunger >= 0.7) return `${r.label}：你饿了，肚子一直在叫`
  if (r.sleepiness >= 0.3) return `${r.label}：你有点乏，提不太起劲`
  return ''
}

/* ------------------------------- 词汇化输出 -------------------------------- */

/** 心跳的程度词。脉搏词只描述事实，不解释原因。 */
export function hrWord(hr) {
  const h = Number(hr ?? VITALS_DEFAULTS.baseline.heartRate)
  if (h >= 115) return '撞得肋骨发疼'
  if (h >= 100) return '快得藏不住'
  if (h >= 90) return '偏快'
  if (h >= 78) return '稍快'
  if (h <= 60) return '又慢又沉'
  if (h <= 66) return '偏慢'
  return '平稳'
}

/**
 * 体温的程度词——不再报小数点，只报身体哪一处有温度。
 * 阈值刻意收紧到 36.75：36.6-36.7 这种「微微发热」会被体感表里的
 * 「耳朵尖发烫」抢先说掉，两边都给就重复了。
 */
export function tempWord(temp) {
  const t = Number(temp ?? VITALS_DEFAULTS.baseline.bodyTemp)
  if (t >= 36.75) return '耳根发烫'
  if (t <= 36.38) return '指尖发凉'
  return '体温正常'
}

/** 呼吸的文字描述（只描述事实，不描述感受）。 */
export function breathWord(breath) {
  const b = Number(breath ?? VITALS_DEFAULTS.baseline.breath)
  if (b >= 30) return '很急促'
  if (b >= 24) return '又急又浅'
  if (b >= 20) return '略快'
  if (b <= 11) return '轻得几乎听不见'
  if (b <= 14) return '很慢很匀'
  if (b <= 15) return '比平时慢'
  return '平稳'
}

/** 按心情与强度取局部体感（可能为空数组——平静时不该硬塞反应）。 */
export function sensationsFor(mood, intensity = 1) {
  const table = SENSATIONS[String(mood ?? '平淡')] ?? SENSATIONS_FALLBACK
  const idx = clamp(Math.round(Number(intensity) || 1), 1, 3) - 1
  return table[idx] ?? table[table.length - 1] ?? []
}

/** 是否值得报出具体数字：只有明显偏离常态时，数字才比词更有信息量。 */
export function worthNumber(hr) {
  const h = Number(hr ?? 0)
  return h >= 100 || (h > 0 && h <= 60)
}

/**
 * 生成注入给模型的一行身体事实。形如：
 *   心跳偏快，耳朵尖发烫，呼吸略快
 *   心跳 112（快得藏不住），后颈发硬，下颌咬紧，呼吸又急又浅
 *
 * 刻意不写「你很紧张」——那是结论，不是事实。
 * 平静时连数字都不给：数字一多就变成噪音，模型会开始跳过这一行。
 *
 * @param {object} v deriveAndSmooth 的产物
 * @param {object} [opts] { number: 强制给/不给数字 }
 */
export function describeVitals(v, opts = {}) {
  if (!v || typeof v.heartRate !== 'number') return ''

  const hr = Number(v.heartRate)
  const showNumber = opts.number ?? worthNumber(hr)
  const hw = hrWord(hr)
  const bw = breathWord(v.breath)
  const heart = showNumber ? `心跳 ${hr}（${hw}）` : `心跳${hw}`

  // 局部体感：强度越高给得越多。生气时「后颈发硬」比「心跳 94」有用得多
  const intensity = clamp(Math.round(Number(v.intensity) || 1), 1, 3)
  const body = sensationsFor(v.mood, intensity).slice(0, intensity >= 3 ? 2 : 1)

  // 体温只在真的偏离常态时才提——36.5℃ 这种「正常」不值得占字
  const tw = tempWord(v.bodyTemp)
  const extras = tw === '体温正常' ? [...body] : [...body, tw]
  // 节律体感排最后，且整体最多三条——再多就成一串报了
  const rhythmNote = rhythmSensation(v.rhythm)
  if (rhythmNote) extras.push(rhythmNote)
  const picked = extras.slice(0, 3)

  // 心率呼吸都在常态、又没有别的可说：合并成一句，别写成「平稳，平稳」
  if (!showNumber && hw === '平稳' && bw === '平稳' && picked.length === 0) {
    return '心跳和呼吸都很稳'
  }

  return [heart, ...picked, `呼吸${bw}`].filter(Boolean).join('，')
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

/**
 * 基线之上的波动——带方向。bias 占六成、随机占四成，
 * 所以傲娇总是偏高、委屈总是偏低，但每次的数字又不完全一样。
 */
function drift(bias, range) {
  if (!range) return 0
  const b = clamp(Number(bias) || 0, -1, 1)
  return (b * 0.6 + (Math.random() * 2 - 1) * 0.4) * range
}
