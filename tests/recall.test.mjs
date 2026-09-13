// 检索管线测试：分词 / 三路打分 / RRF 融合 / 限额 / 情绪加权。
//
//   node --test tests/recall.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory, appendEpisode, appendClaim } from '../luna-memory.mjs'
import {
  tokenize, scoreKeyword, scoreValence, scoreRecency, collectItems,
  reciprocalRankFusion, retrieve, valenceOfMood, buildTriggerIndex, formatRecall,
  RECALL_DEFAULTS,
} from '../luna-recall.mjs'

/* ------------------------------- 分词 -------------------------------- */

test('tokenize：中文切 bigram，英文与数字按词', () => {
  assert.deepEqual(tokenize('审查'), ['审查'])
  assert.deepEqual(tokenize('边界条件'), ['边界', '界条', '条件'])
  assert.ok(tokenize('用 rust 写').includes('rust'))
  assert.ok(tokenize('node 24').includes('node'))
  assert.deepEqual(tokenize(''), [])
  assert.deepEqual(tokenize(null), [])
})

test('tokenize 让中文两字词也能被检索到（这正是 FTS5 失败的地方）', () => {
  const hay = tokenize('今天调试了一个离奇的 bug')
  assert.ok(hay.includes('调试'), '「调试」应作为一个词元出现')
  assert.ok(hay.includes('bug'))
})

/* ------------------------------- 打分 -------------------------------- */

test('scoreKeyword：命中率 0..1', () => {
  assert.equal(scoreKeyword('修好了备份链路', tokenize('备份')), 1)
  assert.equal(scoreKeyword('完全无关的内容', tokenize('备份')), 0)
  const half = scoreKeyword('备份这件事', tokenize('备份天气'))
  assert.ok(half > 0 && half < 1, String(half))
  assert.equal(scoreKeyword('任意', []), 0)
})

test('scoreValence：情绪同频（issue 3.3 的公式）', () => {
  assert.equal(scoreValence({ valence: 0.8 }, 0.8), 1)
  assert.equal(scoreValence({ valence: -0.8 }, -0.8), 1)
  assert.ok(Math.abs(scoreValence({ valence: 0.8 }, -0.8) - 0.2) < 1e-9)
  assert.equal(scoreValence({}, 0), 1)
})

test('scoreRecency：半衰期衰减', () => {
  const now = Date.now()
  const fresh = scoreRecency({ createdAt: new Date(now).toISOString() }, now)
  const half = scoreRecency({ createdAt: new Date(now - 14 * 86400000).toISOString() }, now)
  const stale = scoreRecency({ createdAt: new Date(now - 56 * 86400000).toISOString() }, now)
  assert.ok(fresh > 0.99, String(fresh))
  assert.ok(Math.abs(half - 0.5) < 0.01, String(half))
  assert.ok(stale < 0.1, String(stale))
  assert.equal(scoreRecency({}, now), 0.5, '没有时间戳时给中间值')
})

test('valenceOfMood 把心情折算成效价', () => {
  assert.ok(valenceOfMood('开心') > 0)
  assert.ok(valenceOfMood('难过') < 0)
  assert.equal(valenceOfMood('平淡'), 0)
  assert.equal(valenceOfMood('不存在的心情'), 0)
})

/* -------------------------------- RRF -------------------------------- */

test('RRF：两路都命中的排最前，并记录来源', () => {
  const fused = reciprocalRankFusion([
    { name: 'keyword', items: [{ id: 'x' }, { id: 'y' }] },
    { name: 'recency', items: [{ id: 'y' }, { id: 'z' }] },
  ])
  assert.equal(fused[0].id, 'y')
  assert.deepEqual([...fused[0].sources].sort(), ['keyword', 'recency'])
  assert.ok(fused[0].score > fused[1].score)
})

test('RRF：单路结果也能返回', () => {
  const fused = reciprocalRankFusion([{ name: 'only', items: [{ id: 'a' }] }])
  assert.equal(fused.length, 1)
  assert.deepEqual(fused[0].sources, ['only'])
})

/* ------------------------------ 主入口 ------------------------------- */

test('retrieve：关键词命中优先，并遵守限额', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '修好了备份链路', evidence: '修好了备份链路' })
  appendEpisode(m, { summary: '聊了天气', evidence: '聊了天气' })
  appendEpisode(m, { summary: '讨论前端配色', evidence: '讨论前端配色' })
  appendClaim(m, { predicate: 'occupation', value: '嵌入式', evidence: '我是做嵌入式的' })

  const r = retrieve('备份', m, { tension: 20 })
  assert.ok(r.length >= 1)
  assert.match(r[0].text, /备份/, '最相关的应排第一')
  assert.ok(r.length <= RECALL_DEFAULTS.maxResults, '必须限额')

  const many = retrieve('备份 天气 配色 嵌入式', m, { tension: 20 }, { maxResults: 2 })
  assert.equal(many.length, 2, 'maxResults 必须生效')
})

test('retrieve：情绪强烈时启用情绪路', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '很开心的经历', emotion: '开心' })
  appendEpisode(m, { summary: '很难过的经历', emotion: '难过' })

  // 低情绪：不应出现 emotional 来源
  const calm = retrieve('经历', m, { mood: '平淡', tension: 20 })
  assert.ok(calm.every((r) => !r.sources.includes('emotional')), '情绪平缓时不该走情绪路')

  // 高情绪：应出现 emotional 来源，且方向朝同频的那些
  const hot = retrieve('经历', m, { mood: '开心', tension: 90 })
  assert.ok(hot.some((r) => r.sources.includes('emotional')), '情绪强烈时应启用情绪路')
})

test('retrieve：空记忆返回空数组', () => {
  assert.deepEqual(retrieve('随便问问', emptyMemory(), {}), [])
})

test('retrieve：被抑制的记忆检索不到', () => {
  const m = emptyMemory()
  appendEpisode(m, { summary: '要被忘掉的备份事故' })
  assert.ok(retrieve('备份', m, {}).length > 0)
  m.suppressions.push({
    id: 'sup_1', targetType: 'episode', targetId: m.episodes[0].id,
    reason: '用户要求忘掉', createdAt: new Date().toISOString(), affectedInferences: [],
  })
  assert.deepEqual(retrieve('备份', m, {}), [], '抑制后不得再被检索到')
})

test('collectItems 汇总三类记忆', () => {
  const m = emptyMemory()
  appendClaim(m, { predicate: 'name', value: '阿伟' })
  appendEpisode(m, { summary: '聊了备份' })
  m.inferences.push({ id: 'i1', statement: '他喜欢深夜工作', pattern: 'night-owl', createdAt: '2026-09-01T00:00:00Z' })
  const items = collectItems(m)
  assert.equal(items.length, 3)
  assert.deepEqual([...new Set(items.map((i) => i.kind))].sort(), ['claim', 'episode', 'inference'])
})

/* --------------------------- 触发器索引 ------------------------------ */

test('buildTriggerIndex：每行一条，可供模型自选', () => {
  const m = emptyMemory()
  appendClaim(m, { predicate: 'occupation', value: '嵌入式开发' })
  appendEpisode(m, { summary: '审查 Rust 代码' })
  const idx = buildTriggerIndex(m)
  const lines = idx.split('\n')
  assert.equal(lines.length, 2)
  assert.match(idx, /嵌入式/)
  assert.match(idx, /Rust/)
  assert.equal(buildTriggerIndex(emptyMemory()), '')
})

test('buildTriggerIndex 遵守条数上限', () => {
  const m = emptyMemory()
  for (let i = 0; i < 10; i++) appendEpisode(m, { summary: '第 ' + i + ' 件事' })
  assert.equal(buildTriggerIndex(m, 3).split('\n').length, 3)
})

test('formatRecall 渲染成一行一条并标注来源', () => {
  const text = formatRecall([{ kind: 'episode', text: '修好了备份链路', sources: ['keyword', 'recency'] }])
  assert.match(text, /\[episode\]/)
  assert.match(text, /keyword\+recency/)
  assert.equal(formatRecall([]), '')
})
