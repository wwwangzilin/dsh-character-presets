// 记忆层 v2 的迁移与基础行为测试。
//
//   node --test tests/
//
// 零依赖：只用 node 内置的 node:test + node:assert。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MEMORY_VERSION, PREDICATE_REGISTRY, SOURCES,
  emptyMemory, isV1, isV2, createMemory, migrateV1toV2, normalizeV2,
  generateId, appendClaim, appendEpisode, stageFromMemory, summarize,
  validatePredicate, isSuppressed, visibleEpisodes, visibleClaims,
} from '../luna-memory.mjs'

/** 一份真实的 v1 记忆（结构照抄 luna-soul.mjs 的 MEMORY_DEFAULTS + remember）。 */
function sampleV1() {
  return {
    version: 1,
    profile: {
      nickname: '阿伟',
      preferences: [{ tool: 'pnpm' }, '早睡'],
      observations: ['他喜欢深夜写代码'],
    },
    relationship: { stage: '熟客', closeness: 42 },
    experiences: [
      { date: '2026-09-10', topic: '修好了备份链路', emotion: '开心' },
      { date: '2026-09-11', topic: '被 bug 卡住', emotion: '难过' },
    ],
  }
}

/* ------------------------------ 版本检测 ------------------------------ */

test('空输入 → 空 v2 记忆', () => {
  const r = createMemory(undefined)
  assert.equal(r.reason, 'empty')
  assert.equal(r.migrated, false)
  assert.equal(r.memory.version, MEMORY_VERSION)
})

test('v1 被识别并迁移', () => {
  const v1 = sampleV1()
  assert.equal(isV1(v1), true)
  assert.equal(isV2(v1), false)
  const r = createMemory(v1)
  assert.equal(r.reason, 'v1->v2')
  assert.equal(r.migrated, true)
  assert.equal(r.memory.version, MEMORY_VERSION)
})

test('v2 原样通过（不重复迁移）', () => {
  const v2 = { ...emptyMemory(), claims: [{ id: 'c1', predicate: 'name', value: 'a' }] }
  const r = createMemory(v2)
  assert.equal(r.reason, 'v2')
  assert.equal(r.migrated, false)
  assert.equal(r.memory.claims.length, 1)
})

test('未知版本与损坏输入都退回空记忆', () => {
  assert.equal(createMemory({ version: '9.9' }).reason, 'unknown-version')
  assert.equal(createMemory(null).reason, 'empty')
  assert.deepEqual(createMemory({ version: '9.9' }).memory.claims, [])
})

test('normalizeV2 补齐缺失字段', () => {
  const m = normalizeV2({ version: '2.0.0', claims: null })
  assert.deepEqual(m.claims, [])
  assert.deepEqual(m.episodes, [])
  assert.deepEqual(m.suppressions, [])
  assert.equal(m.version, MEMORY_VERSION)
})

/* ------------------------------- 迁移 -------------------------------- */

test('nickname 迁移成低置信度的 name claim', () => {
  const m = migrateV1toV2(sampleV1())
  const claim = m.claims.find((c) => c.predicate === 'name')
  assert.ok(claim)
  assert.equal(claim.value, '阿伟')
  assert.equal(claim.source, SOURCES.USER)
  assert.equal(claim.confidence, 0.8, '没有原始证据的迁移数据要降置信度')
  assert.match(claim.evidence, /迁移/)
})

test('preferences 迁移成 preference claim（对象与字符串都支持）', () => {
  const m = migrateV1toV2(sampleV1())
  const prefs = m.claims.filter((c) => c.predicate === 'preference')
  assert.equal(prefs.length, 2)
  assert.deepEqual(prefs.find((c) => c.value.tool === 'pnpm').value, { tool: 'pnpm' })
  assert.deepEqual(prefs.find((c) => c.value.note === '早睡').value, { note: '早睡' })
})

test('observations 迁移成 inference（本来就是慢速推断）', () => {
  const m = migrateV1toV2(sampleV1())
  assert.equal(m.inferences.length, 1)
  assert.equal(m.inferences[0].status, 'accumulating')
  assert.equal(m.inferences[0].evidenceCount, 1)
  assert.equal(m.inferences[0].source, SOURCES.INFERRED)
})

test('experiences 迁移成 episode 并映射效价', () => {
  const m = migrateV1toV2(sampleV1())
  assert.equal(m.episodes.length, 2)
  const happy = m.episodes.find((e) => e.summary === '修好了备份链路')
  const sad = m.episodes.find((e) => e.summary === '被 bug 卡住')
  assert.ok(happy.valence > 0, '开心应当是正效价')
  assert.ok(sad.valence < 0, '难过应当是负效价')
  assert.equal(happy.createdAt, '2026-09-10', '日期要保留')
  assert.equal(happy.migratedFrom, 'v1')
})

test('relationship 迁移进 runtimeState（临时状态，不是长期事实）', () => {
  const m = migrateV1toV2(sampleV1())
  assert.equal(m.runtimeState.closeness, 42)
  assert.equal(m.runtimeState.stage, '熟客')
  assert.ok(m.runtimeState.expiresAt, '临时状态要带过期时间')
})

test('迁移后不再残留 v1 字段', () => {
  const m = migrateV1toV2(sampleV1())
  for (const gone of ['profile', 'experiences', 'relationship']) {
    assert.equal(gone in m, false, `${gone} 不应出现在 v2 里`)
  }
})

test('迁移是幂等的：v1 → v2 → 再 createMemory 不再变', () => {
  const once = createMemory(sampleV1()).memory
  const twice = createMemory(once)
  assert.equal(twice.migrated, false)
  assert.deepEqual(twice.memory.claims.length, once.claims.length)
})

test('空 v1 也能迁移成合法 v2', () => {
  const m = migrateV1toV2({ version: 1 })
  assert.equal(m.version, MEMORY_VERSION)
  assert.deepEqual(m.claims, [])
  assert.deepEqual(m.episodes, [])
})

/* --------------------------- 谓词注册表 ------------------------------ */

test('谓词注册表限制可写入字段', () => {
  assert.equal(validatePredicate('occupation', '嵌入式').ok, true)
  assert.equal(validatePredicate('favourite_food', '面').ok, false, '未注册的谓词必须被拒')
  assert.equal(validatePredicate('name', ['a']).ok, false, '类型不符必须被拒')
  assert.equal(validatePredicate('name', '').ok, false, '空值必须被拒')
  assert.equal(validatePredicate('language', ['C', 'Rust']).ok, true)
  assert.ok(Object.keys(PREDICATE_REGISTRY).length >= 6)
})

/* ------------------------------ 写入辅助 ----------------------------- */

test('appendClaim 拒绝未注册谓词', () => {
  const m = emptyMemory()
  const r = appendClaim(m, { predicate: 'nope', value: 1 })
  assert.equal(r.ok, false)
  assert.equal(m.claims.length, 0)
})

test('重复 claim 合并并提升置信度（而不是堆重复条目）', () => {
  const m = emptyMemory()
  appendClaim(m, { predicate: 'name', value: '阿伟', confidence: 0.5 })
  const again = appendClaim(m, { predicate: 'name', value: '阿伟', confidence: 0.5 })
  assert.equal(again.merged, true)
  assert.equal(m.claims.length, 1)
  assert.ok(m.claims[0].confidence > 0.5)
})

test('appendEpisode 同日同摘要去重', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '聊了备份', emotion: '开心' })
  const dup = appendEpisode(m, { summary: '聊了备份', emotion: '开心' })
  assert.equal(dup.duplicate, true)
  assert.equal(m.episodes.length, 1)
})

test('appendEpisode 拒绝空摘要并遵守上限', () => {
  const m = emptyMemory()
  assert.equal(appendEpisode(m, { summary: '   ' }).ok, false)
  for (let i = 0; i < 12; i++) appendEpisode(m, { summary: '第 ' + i + ' 件事', limit: 5 })
  assert.equal(m.episodes.length, 5)
})

/* --------------------------- 摘要与阶段 ------------------------------ */

test('空记忆给出友好的开场摘要', () => {
  assert.match(summarize(emptyMemory()), /刚开始相处/)
})

test('摘要包含最近经历与称呼', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '修好了备份链路' })
  appendClaim(m, { predicate: 'name', value: '阿伟' })
  const s = summarize(m)
  assert.match(s, /修好了备份链路/)
  assert.match(s, /阿伟/)
})

test('阶段随内容推进', () => {
  const m = emptyMemory()
  assert.equal(stageFromMemory(m), '新客')
  m.runtimeState.closeness = 35
  assert.equal(stageFromMemory(m), '熟客')
  m.runtimeState.closeness = 70
  assert.equal(stageFromMemory(m), '长期主人')
})

/* ----------------------------- 遗忘接口 ------------------------------ */

test('被抑制的 episode 不再可见', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '要被忘掉的事' })
  const id = m.episodes[0].id
  assert.equal(isSuppressed(m, id), false)
  assert.equal(visibleEpisodes(m).length, 1)
  m.suppressions.push({
    id: generateId('sup'), targetType: 'episode', targetId: id,
    reason: '用户明确要求忘掉', createdAt: new Date().toISOString(), affectedInferences: [],
  })
  assert.equal(isSuppressed(m, id), true)
  assert.equal(visibleEpisodes(m).length, 0, '抑制后不得注入上下文')
})

test('被抑制的 claim 不再可见', () => {
  const m = emptyMemory()
  appendClaim(m, { predicate: 'occupation', value: '嵌入式' })
  const id = m.claims[0].id
  assert.equal(visibleClaims(m).length, 1)
  m.suppressions.push({ id: 'sup_x', targetType: 'claim', targetId: id, reason: '过期', createdAt: '', affectedInferences: [] })
  assert.equal(visibleClaims(m).length, 0)
})

/* -------------------------------- id --------------------------------- */

test('id 带前缀且时间有序', () => {
  const a = generateId('ep')
  assert.match(a, /^ep_\d{14}_[a-z0-9]{4}$/)
  const b = generateId('claim')
  assert.match(b, /^claim_/)
})
