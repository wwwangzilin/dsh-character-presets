/**
 * 露娜 · 姐妹层（siblings）
 * ============================================================================
 * 她知道主人身边不止她一个。
 *
 * 核心角色是三位：露娜、小喵、三千代。各自有记忆文件、各自有脾气，但主人是同一个——
 * 所以「他刚才是不是又去找那只猫了」这种事，她该知道。
 *
 * 实现上只有一个共享记录：每个角色把自己的「我是谁、我刚来过」写进
 * `.agent-presets/.siblings.json`，读的时候顺便看看别人最近什么时候来过。
 *
 * ⚠️ 那个文件在 preset 目录**之外**，沙箱可能不许写。所以调用方必须能接受
 * 「读写失败」——这一层纯粹是锦上添花，缺了不影响任何别的功能。
 */

/** 共享记录的文件名（位于 .agent-presets 目录下，跨 preset 可见）。 */
export const SIBLING_FILE = '.siblings.json'

/** 多久之内算「最近还来过」。超过就不再提，免得像查岗。 */
export const SIBLING_FRESH_MS = 24 * 3_600_000

/** 容错解析：坏文件、空文件、非对象统统当空表。 */
export function readRecords(raw) {
  if (raw === null || raw === undefined) return {}
  let value = raw
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t.length === 0) return {}
    try {
      value = JSON.parse(t)
    } catch {
      return {}
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out = {}
  for (const [id, rec] of Object.entries(value)) {
    if (typeof rec !== 'object' || rec === null) continue
    const at = Number(rec.at)
    out[id] = {
      name: typeof rec.name === 'string' && rec.name.length > 0 ? rec.name : id,
      at: Number.isFinite(at) && at > 0 ? at : 0,
    }
  }
  return out
}

/** 记一笔「我还在」。返回新表（不改入参）。 */
export function touchRecord(records, id, name, now = Date.now()) {
  const base = records && typeof records === 'object' && !Array.isArray(records) ? records : {}
  if (typeof id !== 'string' || id.length === 0) return { ...base }
  return {
    ...base,
    [id]: {
      name: typeof name === 'string' && name.length > 0 ? name : id,
      at: Number(now) || Date.now(),
    },
  }
}

/** 把毫秒说成人话。 */
function ago(ms) {
  const min = Math.round(ms / 60_000)
  if (min < 2) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

/**
 * 生成一行「别人最近来过」的事实。
 *
 * @param {object} records readRecords 的产物
 * @param {string} selfId 自己的 id（不把自己算进去）
 * @param {number} [now]
 * @returns {{ id:string, name:string, agoText:string, ms:number } | null}
 */
export function siblingSeen(records, selfId, now = Date.now()) {
  const table = records && typeof records === 'object' ? records : {}
  const nowMs = Number(now) || Date.now()
  const others = Object.entries(table)
    .filter(([id]) => id !== selfId)
    .map(([id, rec]) => ({
      id,
      name: rec?.name ?? id,
      ms: nowMs - Number(rec?.at ?? 0),
    }))
    .filter((r) => Number.isFinite(r.ms) && r.ms >= 0 && r.ms < SIBLING_FRESH_MS)
    .sort((a, b) => a.ms - b.ms)

  if (others.length === 0) return null
  const pick = others[0]
  return { id: pick.id, name: pick.name, agoText: ago(pick.ms), ms: pick.ms }
}

/**
 * 注入给模型的一行。没有别人来过、或自己的 id 拿不到时返回空串。
 */
export function siblingLine(records, selfId, now = Date.now()) {
  const seen = siblingSeen(records, selfId, now)
  if (seen === null) return ''
  return `姐妹：${seen.name} ${seen.agoText}还陪过主人——你可以吃醋、可以嘴硬，但别刻薄，她也是同伴`
}
