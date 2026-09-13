/**
 * 露娜 · 遗忘机制
 * ============================================================================
 * 核心立场（issue #8 第 4 节）：**遗忘不是删除，是抑制**。
 * 删掉就真没了，而且依赖它得出的结论不会重算——那才是记忆系统里最危险的谎话。
 *
 * 三件事：
 *
 *   1. suppression  —— 落下一条「不再使用」的记录，并**重算受影响的推断**
 *                      （证据不够的推断从 confirmed 降回 accumulating）
 *   2. 老化          —— 长期未引用且很少被想起的经历标记为 stale（仍留在文件里）
 *   3. 墓碑          —— 软删（可恢复）或硬删（真删，但留下 suppression 记录）
 *
 * 三种状态都不进上下文：`visibleEpisodes()` 会过滤掉 suppressed / stale / deleted。
 *
 * 纯函数模块，不依赖 Cordis，可单独测试。
 */

import { visibleEpisodes, visibleClaims, generateId } from './luna-memory.mjs'
import { tokenize } from './luna-recall.mjs'
import { similarity } from './luna-gate.mjs'

export const FORGET_DEFAULTS = {
  /** 超过这么多天没被引用，且访问次数低 → 老化 */
  staleAfterDays: 30,
  /** 访问次数低于它才算「很少被想起」 */
  staleAccessThreshold: 3,
  /** 推断证据数达到它才算 confirmed */
  inferenceConfirmThreshold: 3,
  /** 老化时合并相似经历（比去重更激进：这些本来就是要清理的） */
  mergeThreshold: 0.7,
  /** 这些 claim 优先保留，永不参与清理 */
  protectedPredicates: ['name', 'preference', 'boundary'],
}

/* ============================ 相关度 ================================== */

/** 词元重叠度（0..1），用来判断一段记忆是否被某条推断依赖。 */
export function overlapScore(a, b) {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.min(ta.size, tb.size)
}

const episodeText = (ep) => `${ep.summary ?? ''} ${(ep.evidence ?? []).join(' ')}`

/* ========================= 推断的重算 ================================ */

/**
 * 找出依赖某条记忆的推断（用词元重叠近似——我们不留显式依赖边）。
 *
 * 阈值刻意放宽（0.1）：**漏判会让依赖关系静默丢失，误判只是多算一次重算**，
 * 两边代价不对称。典型情况「深夜调试备份脚本」与「他倾向于深夜工作」只有
 * 一个共同词元，得分约 0.14，必须仍然算数。
 */
export function findAffectedInferences(memory, targetId, threshold = 0.1) {
  const target =
    (memory.episodes ?? []).find((e) => e.id === targetId)
    ?? (memory.claims ?? []).find((c) => c.id === targetId)
  if (!target) return []
  const targetText = target.summary ? episodeText(target) : `${target.predicate ?? ''} ${JSON.stringify(target.value ?? '')}`
  return (memory.inferences ?? []).filter(
    (inf) => overlapScore(inf.statement ?? '', targetText) > threshold,
  )
}

/**
 * 重算一条推断：证据数 = 当前「可见且与结论相关」的经历条数。
 * 证据不够就降级——这正是「遗忘要让下游重新计算」的落点。
 */
export function recalculateInference(memory, infId, config = {}) {
  const cfg = { ...FORGET_DEFAULTS, ...config }
  const inference = (memory.inferences ?? []).find((i) => i.id === infId)
  if (!inference) return null

  const supportive = visibleEpisodes(memory)
    .filter((ep) => overlapScore(episodeText(ep), inference.statement ?? '') > 0.1)
    .length

  const before = inference.evidenceCount
  inference.evidenceCount = supportive
  inference.status = supportive >= cfg.inferenceConfirmThreshold ? 'confirmed' : 'accumulating'
  inference.updatedAt = new Date().toISOString()
  return { id: infId, before, after: supportive, status: inference.status }
}

/* ============================ 抑制 =================================== */

/**
 * 落下一条 suppression，并重算受影响的推断。
 * 幂等：同一目标重复抑制不会被重复记录。
 */
export function suppress(memory, { targetType, targetId, reason, cascade = true }, now = new Date()) {
  if (!targetId) return null
  const existing = (memory.suppressions ?? []).find((s) => s.targetId === targetId)
  if (existing) return { ...existing, duplicate: true }

  const affected = cascade ? findAffectedInferences(memory, targetId) : []
  const suppression = {
    id: generateId('sup'),
    targetType,
    targetId,
    reason: reason ?? '未说明',
    createdAt: now.toISOString(),
    affectedInferences: affected.map((i) => i.id),
  }
  memory.suppressions.push(suppression)

  const recalculated = []
  for (const id of suppression.affectedInferences) {
    const r = recalculateInference(memory, id)
    if (r) recalculated.push(r)
  }

  memory.updatedAt = now.toISOString()
  return { ...suppression, recalculated }
}

/** 撤回一条抑制（后悔了也来得及）。 */
export function unsuppress(memory, suppressionId, config = {}) {
  const idx = (memory.suppressions ?? []).findIndex((s) => s.id === suppressionId)
  if (idx === -1) return null
  const [removed] = memory.suppressions.splice(idx, 1)
  const recalculated = removed.affectedInferences
    .map((id) => recalculateInference(memory, id, config))
    .filter(Boolean)
  return { ...removed, recalculated }
}

/* ============================ 老化 =================================== */

/**
 * 老化：长期没人提、也很少被想起的经历标记为 stale。
 * 只是不再注入，**不删除**；claim 一律不参与老化。
 */
export function ageMemories(memory, now = new Date(), config = {}) {
  const cfg = { ...FORGET_DEFAULTS, ...config }
  const staled = []

  for (const ep of memory.episodes ?? []) {
    if (ep.status === 'deleted' || ep.status === 'stale') continue
    const last = Date.parse(ep.lastSeenAt ?? ep.createdAt ?? '')
    if (!Number.isFinite(last)) continue
    const days = (now.getTime() - last) / 86400000
    const accesses = Number(ep.accessCount ?? 0)
    if (days > cfg.staleAfterDays && accesses < cfg.staleAccessThreshold) {
      ep.status = 'stale'
      ep.staledAt = now.toISOString()
      staled.push({ id: ep.id, days: Math.round(days), accesses })
    }
  }

  memory.updatedAt = now.toISOString()
  return { staled, protectedClaims: visibleClaims(memory).filter((c) => cfg.protectedPredicates.includes(c.predicate)).length }
}

/** 把相似的 stale 经历合并成一条（老化时的清理动作）。 */
export function mergeStaleEpisodes(memory, config = {}) {
  const cfg = { ...FORGET_DEFAULTS, ...config }
  const stale = (memory.episodes ?? []).filter((e) => e.status === 'stale')
  const merged = []
  const removed = new Set()

  for (let i = 0; i < stale.length; i++) {
    if (removed.has(stale[i].id)) continue
    for (let j = i + 1; j < stale.length; j++) {
      if (removed.has(stale[j].id)) continue
      if (similarity(stale[i].summary, stale[j].summary) > cfg.mergeThreshold) {
        stale[i].accessCount = Number(stale[i].accessCount ?? 0) + Number(stale[j].accessCount ?? 0)
        stale[i].mergedFrom = [...(stale[i].mergedFrom ?? []), stale[j].id]
        removed.add(stale[j].id)
        merged.push({ into: stale[i].id, from: stale[j].id })
      }
    }
  }

  if (removed.size > 0) {
    // 被合并掉的：留墓碑（不真删），并从可见集合里消失
    for (const ep of memory.episodes) {
      if (removed.has(ep.id)) {
        ep.status = 'deleted'
        ep.deletedAt = new Date().toISOString()
        ep.deletedReason = 'merged'
      }
    }
  }
  return { merged }
}

/* ============================ 墓碑 =================================== */

/** 软删：标记 deleted，可恢复。 */
export function tombstone(memory, episodeId, now = new Date()) {
  const ep = (memory.episodes ?? []).find((e) => e.id === episodeId)
  if (!ep) return null
  ep.status = 'deleted'
  ep.deletedAt = now.toISOString()
  ep.deletedReason = ep.deletedReason ?? 'user_requested'
  return { id: episodeId, restorable: true }
}

/** 从回收站恢复（把 stale 一起复位）。 */
export function restore(memory, episodeId) {
  const ep = (memory.episodes ?? []).find((e) => e.id === episodeId)
  if (!ep || ep.status !== 'deleted') return null
  delete ep.deletedAt
  delete ep.deletedReason
  ep.status = 'active'
  ep.accessCount = Number(ep.accessCount ?? 0) + 1
  return { id: episodeId, status: 'active' }
}

/**
 * 硬删：真的从数组里移除，但**留下 suppression 记录**——
 * 这样依赖它的推断仍会重算，而不是无声无息地失去依据。
 */
export function hardDelete(memory, episodeId, reason = '用户要求彻底删除', now = new Date()) {
  const idx = (memory.episodes ?? []).findIndex((e) => e.id === episodeId)
  if (idx === -1) return null
  // 顺序要紧：**先**落下抑制（此时还能找到这条记忆，依赖它的推断才会被重算），
  // **再**移除。反过来就找不到它了，依赖关系会静默丢失。
  const suppression = suppress(memory, { targetType: 'episode', targetId: episodeId, reason }, now)
  memory.episodes.splice(idx, 1)
  return { id: episodeId, suppression }
}

/**
 * 一站式遗忘入口（对应第 4.3 节的 deleteEpisode）。
 *   mode = 'soft'（默认，可恢复）| 'hard'（真删 + 留 suppression）
 */
export function forget(memory, episodeId, { reason, mode = 'soft' } = {}, now = new Date()) {
  if (mode === 'hard') return hardDelete(memory, episodeId, reason, now)
  return tombstone(memory, episodeId, now)
}

/** 统计：一眼看清记忆的账（回收站里有多少、老化了多少）。 */
export function memoryStats(memory) {
  const eps = memory?.episodes ?? []
  return {
    claims: visibleClaims(memory).length,
    episodesActive: visibleEpisodes(memory).length,
    episodesStale: eps.filter((e) => e.status === 'stale').length,
    episodesDeleted: eps.filter((e) => e.status === 'deleted').length,
    inferences: (memory?.inferences ?? []).length,
    suppressions: (memory?.suppressions ?? []).length,
  }
}
