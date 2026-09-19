/**
 * 露娜 · 牵挂层（loops）
 * ============================================================================
 * 你随口说的事，她记着。
 *
 * 现在她只会回应：你说什么她答什么，从不带头想起什么。而真人最像人的一刻，
 * 恰恰是「她突然问起你上周提过的那件事」——那说明你在她脑子里留着一页没读完。
 *
 * 一个 loop 就是一句你还没了结的话：
 *   从消息里抽出来 → 冷却够久问一次 → 你说「搞定了」就划掉
 *
 * 三条规矩：
 *   1. **冷却** —— 不能刚说完就追问，那是复读机。要求 ≥8 轮且 ≥30 分钟。
 *   2. **问过就记一笔** —— 问满两次就收手，第三次就变成烦人了。
 *   3. **工作时刻不问** —— 干活时别打岔，和时刻层联动（调用方判断）。
 */

/** 从消息里认出「一件还没完的事」。 */
const LOOP_PATTERNS = [
  // 「我在改那个备份脚本」
  { re: /(?:我|咱)(?:在|正在|还在)(?:改|写|做|搞|弄|查|修|调|试)[^，。！？,；]{1,14}/, kind: 'doing' },
  // 「明天要发版」「回头得把它挪走」
  { re: /(?:明天|下周|后天|待会|回头|之后|晚点|接下来)(?:要|得|去|准备)[^，。！？,；]{2,14}/, kind: 'plan' },
  // 「那个 bug 还没修」
  { re: /[^，。！？,；]{2,14}(?:还没|没有|没)(?:搞定|弄好|改完|做完|解决|好|修|弄|写)/, kind: 'stuck' },
]

/** 认出「这事了结了」。 */
const CLOSE_WORDS = [
  '搞定了', '弄好了', '改完了', '做完了', '完成了', '解决了', '搞定了', '成了',
  '好了', '搞定', '完事', 'OK了', 'ok了', '通过了', '跑通了', '上线了',
]

/** 冷却：至少过了这么多轮 + 这么久，才值得主动问一次。 */
export const LOOP_DEFAULTS = {
  minTurns: 8,
  minAgeMs: 30 * 60_000,
  maxAsks: 2,
  maxLoops: 12,
}

function clean(raw) {
  return String(raw ?? '')
    .replace(/^[\s，。、！？,.!?;:]+/, '')
    .replace(/[\s，。、！？,.!?;:]+$/, '')
    .trim()
}

/**
 * 从一条消息里抽出一件未了的事。
 * @returns {{ text:string, kind:string, at:number, asks:number } | null}
 */
export function extractLoop(text, now = Date.now()) {
  const t = String(text ?? '')
  if (t.length === 0 || t.length > 200) return null
  for (const rule of LOOP_PATTERNS) {
    const m = t.match(rule.re)
    if (!m) continue
    const found = clean(m[0])
    if (found.length < 4) continue
    return { text: found, kind: rule.kind, at: now, asks: 0 }
  }
  return null
}

/** 这条消息是不是在说「那事完了」。 */
export function looksResolved(text) {
  const t = String(text ?? '')
  return CLOSE_WORDS.some((w) => t.includes(w))
}

/**
 * 把一条消息并进 loops：先处理「了结」，再处理新增。
 *
 * @param {Array} loops 现有列表
 * @param {string} text 用户消息
 * @param {number} [now]
 * @returns {{ loops:Array, added:object|null, closed:number }}
 */
export function mergeLoops(loops, text, now = Date.now(), config = {}) {
  const cfg = { ...LOOP_DEFAULTS, ...config }
  const list = Array.isArray(loops) ? [...loops] : []
  let closed = 0

  // 了结：用户说「搞定了」，就把最旧的、还挂着的那条划掉
  if (looksResolved(text) && list.length > 0) {
    const idx = list.findIndex((l) => l.kind !== 'plan')
    if (idx >= 0) {
      list.splice(idx, 1)
      closed += 1
    }
  }

  const added = extractLoop(text, now)
  if (added !== null) {
    // 同一件事不重复记：比尾部几个字就够（「我在改那个备份脚本」重复提也只算一条）
    const tail = (s) => String(s ?? '').replace(/\s+/g, '').slice(-5)
    const dup = list.some((l) => tail(l.text) === tail(added.text))
    if (!dup) list.push(added)
  }

  return { loops: list.slice(-cfg.maxLoops), added, closed }
}

/**
 * 现在该不该主动问起某件事。
 *
 * @param {Array} loops
 * @param {{ turns:number, now:number, mode?:string, config?:object }} state
 * @returns {{ text:string, kind:string, ageMs:number } | null}
 */
export function dueLoop(loops, state = {}) {
  const cfg = { ...LOOP_DEFAULTS, ...(state.config ?? {}) }
  if (!Array.isArray(loops) || loops.length === 0) return null
  // 干活的时候别打岔——那是时刻层的判断，这里只尊重结论
  if (state.mode === 'work') return null

  const now = Number(state.now ?? Date.now())
  const turns = Number(state.turns ?? 0)
  const candidates = loops
    .filter((l) => Number(l.asks ?? 0) < cfg.maxAsks)
    .map((l) => ({ ...l, ageMs: now - Number(l.at ?? 0) }))
    .filter((l) => turns >= cfg.minTurns && l.ageMs >= cfg.minAgeMs)
    .sort((a, b) => b.ageMs - a.ageMs)

  if (candidates.length === 0) return null
  const pick = candidates[0]
  return { text: pick.text, kind: pick.kind, ageMs: pick.ageMs }
}

/** 记一次「问过了」。 */
export function markAsked(loops, text) {
  return (Array.isArray(loops) ? loops : []).map((l) => (
    l.text === text ? { ...l, asks: Number(l.asks ?? 0) + 1 } : l
  ))
}

/** 生成注入给模型的一行牵挂。 */
export function loopLine(loop) {
  if (!loop || typeof loop.text !== 'string') return ''
  const hours = Math.max(1, Math.round(Number(loop.ageMs ?? 0) / 3_600_000))
  const when = hours >= 24 ? `${Math.round(hours / 24)} 天前` : `${hours} 小时前`
  return `牵挂：${when}主人提过「${loop.text}」，你一直记着——找个自然的时机问一句，别硬插`
}
