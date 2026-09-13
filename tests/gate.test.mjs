// 写入管线（证据门控）测试 —— 重点覆盖「各种应该被拒绝的场景」。
//
//   node --test tests/gate.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory, SOURCES } from '../luna-memory.mjs'
import {
  classifySource, containsNumber, hasToolEvidence, gateCandidate,
  extractCandidates, similarity, planMerge, commitCandidate, ingest,
} from '../luna-gate.mjs'

/* ------------------------------ 来源分类 ------------------------------ */

test('classifySource 能分出四类来源', () => {
  const ctx = { userText: '我用 Rust 写服务', toolText: 'build succeeded in 3.2s', selfText: '本小姐觉得还行' }
  assert.equal(classifySource('我用 Rust 写服务', ctx), SOURCES.USER)
  assert.equal(classifySource('build succeeded in 3.2s', ctx), SOURCES.TOOL)
  assert.equal(classifySource('本小姐觉得还行', ctx), SOURCES.SELF)
  assert.equal(classifySource('谁都没说过这句', ctx), null)
  assert.equal(classifySource('', ctx), null)
})

/* ------------------------------ 五道闸 -------------------------------- */

test('闸1：evidence 缺失 → 拒绝', () => {
  const v = gateCandidate({ type: 'episode', summary: 'x' }, { userText: 'x' })
  assert.equal(v.accepted, false)
  assert.equal(v.reason, 'evidence_missing')
})

test('闸1：evidence 不在原文里 → 拒绝（防编造）', () => {
  const v = gateCandidate(
    { type: 'episode', summary: 'x', evidence: '主人说他有三个孩子' },
    { userText: '今天天气不错' },
  )
  assert.equal(v.accepted, false)
  assert.equal(v.reason, 'evidence_not_found')
})

test('闸2/3：claim 的来源不是 [USER] → 拒绝', () => {
  const ctx = { toolText: 'detected occupation: embedded' }
  const v = gateCandidate(
    { type: 'claim', predicate: 'occupation', value: '嵌入式', evidence: 'detected occupation: embedded' },
    ctx,
  )
  assert.equal(v.accepted, false)
  assert.equal(v.reason, 'claim_requires_user_source')
})

test('闸3：露娜自己的话不能变成关于主人的事实', () => {
  const ctx = { selfText: '本小姐猜主人是个程序员' }
  const v = gateCandidate(
    { type: 'claim', predicate: 'occupation', value: '程序员', evidence: '本小姐猜主人是个程序员' },
    ctx,
  )
  assert.equal(v.accepted, false)
  assert.equal(v.reason, 'self_claim_not_allowed')
})

test('闸4：未注册的谓词 → 拒绝', () => {
  const ctx = { userText: '我最爱吃拉面' }
  const v = gateCandidate(
    { type: 'claim', predicate: 'favourite_food', value: '拉面', evidence: '我最爱吃拉面' },
    ctx,
  )
  assert.equal(v.accepted, false)
  assert.equal(v.reason, 'predicate_not_registered')
})

test('闸4：缺少 predicate → 拒绝', () => {
  const ctx = { userText: '我是做嵌入式的' }
  const v = gateCandidate({ type: 'claim', value: '嵌入式', evidence: '我是做嵌入式的' }, ctx)
  assert.equal(v.accepted, false)
  assert.equal(v.reason, 'predicate_missing')
})

test('闸5：数字必须有 [USER] 或 [TOOL] 证据', () => {
  const ctx = { selfText: '主人大概有 5 个项目' }
  const bad = gateCandidate(
    { type: 'claim', predicate: 'preference', value: { projects: 5 }, evidence: '主人大概有 5 个项目' },
    ctx,
  )
  assert.equal(bad.accepted, false, '露娜自己说出的数字不能进记忆')

  const toolCtx = { userText: '看下磁盘', toolText: 'disk usage 87%' }
  const good = gateCandidate(
    { type: 'episode', summary: '磁盘占用 87%', evidence: 'disk usage 87%' },
    toolCtx,
  )
  assert.equal(good.accepted, true)
  assert.equal(good.source, SOURCES.TOOL)
})

test('正例：主人明说的 claim 与 ordinary episode 都能过闸', () => {
  const ctx = { userText: '我是做嵌入式的，平时主要写 C' }
  assert.equal(gateCandidate({ type: 'claim', predicate: 'occupation', value: '嵌入式', evidence: ctx.userText }, ctx).accepted, true)
  assert.equal(gateCandidate({ type: 'episode', summary: '聊了工作', evidence: ctx.userText }, ctx).accepted, true)
})

test('非法候选（null / 非对象）被拒', () => {
  assert.equal(gateCandidate(null, {}).reason, 'candidate_invalid')
  assert.equal(gateCandidate('nope', {}).reason, 'candidate_invalid')
})

/* ------------------------------ 辅助函数 ------------------------------ */

test('containsNumber 认阿拉伯数字与中文数字', () => {
  assert.equal(containsNumber('87%'), true)
  assert.equal(containsNumber('三个'), true)
  assert.equal(containsNumber('嵌入式开发'), false)
  assert.equal(containsNumber({ a: 1 }), true)
  assert.equal(containsNumber(null), false)
})

test('hasToolEvidence 只看 [TOOL] 来源', () => {
  const ctx = { userText: '输出是 3.2 秒', toolText: 'took 3.2s' }
  assert.equal(hasToolEvidence({ evidence: ['took 3.2s'] }, ctx), true)
  assert.equal(hasToolEvidence({ evidence: ['输出是 3.2 秒'] }, ctx), false)
})

/* ------------------------------ 候选提取 ------------------------------ */

test('extractCandidates 能抽出称呼 / 职业 / 语言 / 边界', () => {
  const c1 = extractCandidates('叫我阿伟')
  assert.ok(c1.some((c) => c.predicate === 'name' && c.value === '阿伟'))

  const c2 = extractCandidates('我是做嵌入式的')
  assert.ok(c2.some((c) => c.predicate === 'occupation' && c.value.includes('嵌入式')))

  const c3 = extractCandidates('我不喜欢被催')
  assert.ok(c3.some((c) => c.predicate === 'boundary'))

  // 每轮都会产出一条 episode 候选
  assert.ok(extractCandidates('随便聊聊').some((c) => c.type === 'episode'))
  assert.equal(extractCandidates('').length, 0)
})

/* ------------------------------ 合并策略 ------------------------------ */

test('similarity：相同摘要为 1，无关摘要接近 0', () => {
  assert.equal(similarity('修好了备份链路', '修好了备份链路'), 1)
  assert.ok(similarity('修好了备份链路', '今天天气不错') < 0.2)
})

test('planMerge：claim 的 touch / replace / insert', () => {
  const m = emptyMemory()
  assert.equal(planMerge({ type: 'claim', predicate: 'name', value: '阿伟' }, m).action, 'insert')

  commitCandidate({ type: 'claim', predicate: 'name', value: '阿伟', evidence: '叫我阿伟' }, m)
  assert.equal(planMerge({ type: 'claim', predicate: 'name', value: '阿伟' }, m).action, 'touch')
  assert.equal(planMerge({ type: 'claim', predicate: 'name', value: '老王' }, m).action, 'replace')
})

test('planMerge：episode 相似则合并', () => {
  const m = emptyMemory()
  commitCandidate({ type: 'episode', summary: '修好了备份链路', evidence: '修好了备份链路' }, m)
  assert.equal(planMerge({ type: 'episode', summary: '修好了备份链路' }, m).action, 'merge')
  assert.equal(planMerge({ type: 'episode', summary: '聊了完全不同的东西' }, m).action, 'insert')
})

test('planMerge：inference 同 pattern 则强化', () => {
  const m = emptyMemory()
  commitCandidate({ type: 'inference', statement: '他喜欢深夜工作', pattern: 'night-owl', evidence: 'x' }, m)
  assert.equal(planMerge({ type: 'inference', pattern: 'night-owl' }, m).action, 'reinforce')
})

test('replace 时旧值进 history，不直接消失', () => {
  const m = emptyMemory()
  commitCandidate({ type: 'claim', predicate: 'name', value: '阿伟', evidence: '叫我阿伟' }, m)
  commitCandidate({ type: 'claim', predicate: 'name', value: '老王', evidence: '叫我老王' }, m)
  assert.equal(m.claims.length, 1)
  assert.equal(m.claims[0].value, '老王')
  assert.equal(m.claims[0].history.length, 1)
  assert.equal(m.claims[0].history[0].value, '阿伟')
})

test('inference 累积到 3 条证据后转为 confirmed', () => {
  const m = emptyMemory()
  for (let i = 0; i < 3; i++) {
    commitCandidate({ type: 'inference', statement: '他喜欢深夜工作', pattern: 'night-owl', evidence: 'x' }, m)
  }
  assert.equal(m.inferences.length, 1)
  assert.equal(m.inferences[0].evidenceCount, 3)
  assert.equal(m.inferences[0].status, 'confirmed')
})

/* ------------------------------ 一站式 -------------------------------- */

test('ingest：抽候选 → 过闸 → 写入，并给出拒绝原因', () => {
  const m = emptyMemory()
  const r = ingest('我是做嵌入式的', m, {})

  assert.ok(r.accepted.length > 0, '应至少写入 episode')
  assert.ok(m.episodes.length === 1)
  const claim = m.claims.find((c) => c.predicate === 'occupation')
  assert.ok(claim, '职业 claim 应被写入')
  assert.equal(claim.source, SOURCES.USER)
  assert.equal(r.rejected.length, 0)
  assert.ok(m.updatedAt, 'ingest 应更新 updatedAt')
})

test('ingest：编造的候选进不来', () => {
  const m = emptyMemory()
  const r = ingest('今天天气不错', m, { toolText: '', selfText: '' })
  // 只有 episode 候选，且它来自 [USER]，所以能进
  assert.equal(r.accepted.length, 1)
  assert.equal(m.claims.length, 0, '不该凭空产生 claim')
})

test('ingest：工具说的数字进不了 claim', () => {
  const m = emptyMemory()
  const r = ingest('看看磁盘', m, { toolText: 'disk usage 87%' })
  assert.equal(m.claims.length, 0, 'claim 必须来自 [USER]')
  assert.ok(r.accepted.every((a) => a.candidate.type !== 'claim'))
})
