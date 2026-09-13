// 遗忘机制测试：抑制与下游重算 / 老化与合并 / 墓碑与恢复。
//
//   node --test tests/forget.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory, appendEpisode, appendClaim, visibleEpisodes } from '../luna-memory.mjs'
import {
  overlapScore, findAffectedInferences, recalculateInference,
  suppress, unsuppress, ageMemories, mergeStaleEpisodes,
  tombstone, restore, hardDelete, forget, memoryStats, FORGET_DEFAULTS,
} from '../luna-forget.mjs'

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()

/** 造一条「深夜调试」经历 + 一条依赖它的推断。 */
function seedInference(memory, { count = 3, status = 'confirmed' } = {}) {
  appendEpisode(memory, { summary: '深夜调试备份脚本' })
  memory.inferences.push({
    id: 'i1', statement: '主人倾向于深夜工作',
    evidenceCount: count, status, createdAt: daysAgo(1), updatedAt: daysAgo(1),
  })
  return memory.episodes[0].id
}

/* ------------------------------ 相关度 ------------------------------- */

test('overlapScore：词元重叠 0..1', () => {
  assert.equal(overlapScore('修好了备份链路', '修好了备份链路'), 1)
  assert.ok(overlapScore('修好了备份链路', '备份出了问题') > 0)
  assert.equal(overlapScore('修好了备份链路', '今天天气不错'), 0)
  assert.equal(overlapScore('', 'x'), 0)
})

test('findAffectedInferences：按文本相关找出依赖的推断', () => {
  const m = emptyMemory()
  const epId = seedInference(m)
  m.inferences.push({ id: 'i2', statement: '他喜欢猫', createdAt: daysAgo(1) })
  const affected = findAffectedInferences(m, epId)
  assert.deepEqual(affected.map((i) => i.id), ['i1'])
  assert.deepEqual(findAffectedInferences(m, '不存在的 id'), [])
})

test('recalculateInference：证据掉了就降级', () => {
  const m = emptyMemory()
  seedInference(m, { count: 5, status: 'confirmed' })
  const r = recalculateInference(m, 'i1')
  assert.equal(r.before, 5)
  assert.equal(r.after, 1, '只剩一条可见经历支撑')
  assert.equal(m.inferences[0].status, 'accumulating', '必须降级')
  assert.equal(recalculateInference(m, 'nope'), null)
})

/* ------------------------------ 抑制 --------------------------------- */

test('suppress：记录受影响推断、重算、且幂等', () => {
  const m = emptyMemory()
  const epId = seedInference(m)

  const s = suppress(m, { targetType: 'episode', targetId: epId, reason: '用户要求忘掉' })
  assert.ok(s.id)
  assert.deepEqual(s.affectedInferences, ['i1'])
  assert.equal(m.inferences[0].status, 'accumulating')
  assert.equal(visibleEpisodes(m).length, 0, '抑制后不得再注入')

  const again = suppress(m, { targetType: 'episode', targetId: epId })
  assert.equal(again.duplicate, true)
  assert.equal(m.suppressions.length, 1, '不得重复记录同一条抑制')

  assert.equal(suppress(m, { targetType: 'episode', targetId: '' }), null)
})

test('unsuppress：撤回抑制后记忆回来，推断再次重算', () => {
  const m = emptyMemory()
  const epId = seedInference(m)
  const s = suppress(m, { targetType: 'episode', targetId: epId, reason: '说错了' })
  assert.equal(visibleEpisodes(m).length, 0)

  const r = unsuppress(m, s.id)
  assert.ok(r)
  assert.equal(m.suppressions.length, 0)
  assert.equal(visibleEpisodes(m).length, 1, '撤回后应重新可见')
  assert.equal(unsuppress(m, 'nope'), null)
})

/* ------------------------------ 老化 --------------------------------- */

test('ageMemories：久未引用且访问少 → stale，且不再注入', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '很久以前的事' })
  appendEpisode(m, { summary: '昨天的事' })
  appendClaim(m, { predicate: 'preference', value: { tool: 'pnpm' } })

  // appendEpisode 是前插，所以按摘要找，别按下标猜
  const old = m.episodes.find((e) => e.summary === '很久以前的事')
  const fresh = m.episodes.find((e) => e.summary === '昨天的事')
  old.createdAt = daysAgo(40)
  old.accessCount = 0

  const r = ageMemories(m)
  assert.equal(r.staled.length, 1)
  assert.equal(old.status, 'stale')
  assert.equal(fresh.status, undefined, '新经历不该被老化')
  assert.equal(visibleEpisodes(m).length, 1, 'stale 不再注入但仍在文件里')
  assert.equal(m.claims.length, 1, 'claim 不参与老化')
  assert.equal(r.protectedClaims, 1)
})

test('ageMemories：被反复想起的旧事不老化', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '常被想起的旧事' })
  m.episodes[0].createdAt = daysAgo(40)
  m.episodes[0].accessCount = FORGET_DEFAULTS.staleAccessThreshold
  assert.equal(ageMemories(m).staled.length, 0)
})

test('ageMemories：已删除的不会二次老化', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '早就删了的事' })
  m.episodes[0].createdAt = daysAgo(40)
  m.episodes[0].status = 'deleted'
  assert.equal(ageMemories(m).staled.length, 0)
})

test('mergeStaleEpisodes：相似的老化经历合并，被并的留墓碑', () => {
  const m = emptyMemory()
  m.episodes.push({ id: 'e1', summary: '修好了备份链路', status: 'stale', accessCount: 1, createdAt: daysAgo(40) })
  m.episodes.push({ id: 'e2', summary: '修好了备份链路问题', status: 'stale', accessCount: 2, createdAt: daysAgo(40) })
  m.episodes.push({ id: 'e3', summary: '聊了完全无关的天气', status: 'stale', accessCount: 0, createdAt: daysAgo(40) })

  const r = mergeStaleEpisodes(m)
  assert.equal(r.merged.length, 1)
  assert.equal(m.episodes[0].accessCount, 3, '访问次数应累加')
  assert.deepEqual(m.episodes[0].mergedFrom, ['e2'])
  const e2 = m.episodes.find((e) => e.id === 'e2')
  assert.equal(e2.status, 'deleted', '被合并的留墓碑而不是消失')
  assert.equal(e2.deletedReason, 'merged')
})

/* ------------------------------ 墓碑 --------------------------------- */

test('tombstone / restore：软删可恢复', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '要被软删的事' })
  const id = m.episodes[0].id

  const t = tombstone(m, id)
  assert.equal(t.restorable, true)
  assert.equal(m.episodes[0].status, 'deleted')
  assert.equal(visibleEpisodes(m).length, 0, '软删后不再注入')
  assert.ok(m.episodes[0].deletedAt)

  const rec = restore(m, id)
  assert.equal(rec.status, 'active')
  assert.equal(visibleEpisodes(m).length, 1, '恢复后重新可见')
  assert.equal(m.episodes[0].deletedAt, undefined)
  assert.equal(restore(m, 'nope'), null)
  assert.equal(tombstone(m, 'nope'), null)
})

test('hardDelete：真删，但留下 suppression 并重算依赖的推断', () => {
  const m = emptyMemory()
  const epId = seedInference(m)
  const r = hardDelete(m, epId)

  assert.equal(m.episodes.length, 0, '硬删要真的移除')
  assert.ok(r.suppression, '必须留下痕迹')
  assert.equal(m.suppressions.length, 1)
  assert.deepEqual(r.suppression.affectedInferences, ['i1'])
  assert.equal(m.inferences[0].status, 'accumulating', '依赖它的推断必须重算')
  assert.equal(hardDelete(m, 'nope'), null)
})

test('forget 一站式：默认软删，mode=hard 真删', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '一件事' })
  appendEpisode(m, { summary: '另一件事' })
  const id1 = m.episodes[0].id
  const id2 = m.episodes[1].id

  assert.equal(forget(m, id1).restorable, true)
  assert.equal(m.episodes.find((e) => e.id === id1).status, 'deleted')

  const hard = forget(m, id2, { mode: 'hard', reason: '不要了' })
  assert.ok(hard.suppression)
  assert.equal(m.episodes.find((e) => e.id === id2), undefined)
})

/* ------------------------------ 账目 --------------------------------- */

test('memoryStats：一眼看清账目', () => {
  const m = emptyMemory()
  appendClaim(m, { predicate: 'name', value: '阿伟' })
  appendEpisode(m, { summary: '活跃的事' })
  appendEpisode(m, { summary: '要老化的' })
  m.episodes[1].createdAt = daysAgo(40)
  m.episodes[1].accessCount = 0
  appendEpisode(m, { summary: '要删的' })
  tombstone(m, m.episodes[0].id)
  ageMemories(m)

  const s = memoryStats(m)
  assert.equal(s.claims, 1)
  assert.equal(s.episodesDeleted, 1)
  assert.equal(s.episodesStale, 1)
  assert.equal(s.episodesActive, 1)
  assert.equal(s.suppressions, 0)
})

test('被抑制 + 已老化 + 已墓碑，三者都不进上下文', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '会被抑制的' })
  appendEpisode(m, { summary: '会被老化的' })
  appendEpisode(m, { summary: '会被墓碑的' })

  suppress(m, { targetType: 'episode', targetId: m.episodes[0].id, reason: '忘掉' })
  m.episodes[1].createdAt = daysAgo(40)
  m.episodes[1].accessCount = 0
  ageMemories(m)
  tombstone(m, m.episodes[2].id)

  assert.equal(visibleEpisodes(m).length, 0, '三种状态都不得注入')
  assert.equal(m.episodes.length, 3, '但数据都还在文件里')
})
