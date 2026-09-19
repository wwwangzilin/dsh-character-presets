/**
 * 情绪感知层测试。
 *
 * 重点盯住四类曾经判错的句子：
 *   否定（我不开心）、强度（哈哈哈哈）、混合（气笑了）、标点（？？？）
 * 这些是原「字面包含 + 词长累加」判据下必然出错的地方，所以各留一条硬断言。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzeEmotion,
  intensityOf,
  isHidden,
  punctuationSignals,
  signalSummary,
} from '../luna-emotion.mjs'

test('否定：我不开心不该判成开心', () => {
  const r = analyzeEmotion('我不开心')
  assert.notEqual(r.label, '开心', '「不开心」被判成开心就是原版最大的硬伤')
  assert.equal(r.label, '难过')
  assert.equal(r.negated, true)
})

test('否定：不高兴 / 没生气 方向相反', () => {
  assert.equal(analyzeEmotion('我不高兴').label, '难过')
  // 否定掉负向词 → 松一口气，不该还判生气
  const calm = analyzeEmotion('我不生气了')
  assert.notEqual(calm.label, '生气')
  assert.equal(calm.negated, true)
})

test('否定范围只有 4 字，别误伤后文', () => {
  // 「不问这个了」的否定不该波及后面的「开心」
  assert.equal(analyzeEmotion('不问这个了，今天挺开心的').label, '开心')
})

test('强度：哈哈哈哈 明显强于 哈哈', () => {
  const mild = analyzeEmotion('哈哈')
  const wild = analyzeEmotion('哈哈哈哈')
  assert.equal(mild.label, '开心')
  assert.equal(wild.label, '开心')
  assert.ok(wild.level > mild.level, `狂笑强度应更高：${mild.level} vs ${wild.level}`)
  assert.equal(wild.level, 3)
})

test('强度：减弱词往下拉', () => {
  assert.equal(intensityOf('有点烦'), 1)
  const strong = analyzeEmotion('烦死了！！！')
  assert.equal(strong.level, 3)
})

test('混合情绪：气笑了同时保留生气与开心', () => {
  const r = analyzeEmotion('真是气笑了')
  assert.ok(r.label === '生气' || r.label === '开心')
  const pair = [r.label, r.secondary].filter(Boolean).sort().join('+')
  assert.equal(pair, '开心+生气')
  assert.ok(r.signals.some((s) => s.includes('混合情绪')))
})

test('标点信号：连问号 / 省略号 / 干笑都能读出来', () => {
  assert.equal(punctuationSignals('怎么办？？？').confused, true)
  assert.equal(punctuationSignals('算了……').trailing, true)
  assert.equal(punctuationSignals('哈哈').dryLaugh, true)
  assert.equal(punctuationSignals('哈哈哈哈').dryLaugh, false)

  const s = signalSummary('真的吗？？？……')
  assert.ok(s.includes('连问号'))
  assert.ok(s.includes('省略号（话没说完）'))
})

test('口是心非：退让词 + 短句 = hidden', () => {
  assert.equal(isHidden('随便吧'), true)
  assert.equal(isHidden('我没事'), true)
  assert.equal(isHidden('算了吧'), true)
  // 求哄的话不算退场
  assert.equal(isHidden('算了，抱抱我'), false)
  // 长句里的「随便」通常是真的随便
  assert.equal(isHidden('随便你怎么安排都行，我这周时间比较宽松'), false)
})

test('兜底：空输入与纯陈述句不该乱报情绪', () => {
  assert.equal(analyzeEmotion('').label, '平淡')
  assert.equal(analyzeEmotion('   ').label, '平淡')
  assert.equal(analyzeEmotion('把那个文件改一下').label, '认真工作')
})

test('向后兼容：hits 字段仍在', () => {
  const r = analyzeEmotion('太好了！')
  assert.equal(r.label, '开心')
  assert.ok(Array.isArray(r.hits) && r.hits.length > 0)
})

test('回归：「特别开心」不能被「别」误判成否定', () => {
  // 早期版本把「别」当否定词，于是「特别开心」判成难过——这是最刺眼的误判
  assert.equal(analyzeEmotion('今天特别开心！！！').label, '开心')
  assert.equal(analyzeEmotion('这差别也太大了').label, '平淡')
})

test('否定跨不过小句边界', () => {
  assert.equal(analyzeEmotion('不差，今天很开心').label, '开心')
  assert.equal(analyzeEmotion('我没生气，还挺高兴的').label, '开心')
})

test('标点重复不算「情绪外溢」', () => {
  const r = analyzeEmotion('怎么办？？？')
  assert.equal(r.label, '焦虑')
  assert.ok(!r.signals.some((s) => s.includes('重复字')), `？？？ 不该算重复字：${r.signals}`)
})

test('单说「累」也要判低落', () => {
  assert.equal(analyzeEmotion('有点累').label, '难过')
  assert.equal(analyzeEmotion('今天太累了').label, '难过')
})
