/**
 * 情感债测试。
 *
 * 它要证明的是「气是慢慢消的，不是开关」：
 * 强度够才挂账、同一种情绪会续账、换了情绪就盖掉、每轮消耗一点。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { INERTIA_DEFAULTS, accrueDebt, debtHint, decayDebt, inertiaHint } from '../luna-inertia.mjs'

test('强度不够就不挂账', () => {
  const s = {}
  assert.equal(accrueDebt(s, '生气', 2), null)
  assert.equal(s.debt, undefined)
  assert.ok(accrueDebt(s, '生气', 3) !== null)
})

test('正面情绪不挂账', () => {
  const s = {}
  assert.equal(accrueDebt(s, '开心', 3), null)
  assert.equal(accrueDebt(s, '撒娇', 3), null)
})

test('挂账轮数按情绪区分：生气最久', () => {
  const a = {}
  accrueDebt(a, '生气', 3)
  const b = {}
  accrueDebt(b, '难过', 3)
  assert.ok(a.debt.turnsLeft > b.debt.turnsLeft, `生气该记更久：${a.debt.turnsLeft} vs ${b.debt.turnsLeft}`)
})

test('同一种情绪再上头会续账，不会缩短', () => {
  const s = {}
  accrueDebt(s, '生气', 3)
  const first = s.debt.turnsLeft
  decayDebt(s)
  decayDebt(s)
  assert.ok(s.debt.turnsLeft < first)
  accrueDebt(s, '生气', 3)
  assert.equal(s.debt.turnsLeft, first, '再次被惹该续回满')
})

test('换了情绪就盖掉旧的', () => {
  const s = {}
  accrueDebt(s, '生气', 3)
  accrueDebt(s, '委屈', 3)
  assert.equal(s.debt.mood, '委屈')
})

test('每轮消耗一点，到零就清', () => {
  const s = {}
  accrueDebt(s, '难过', 3)
  let steps = 0
  let last = decayDebt(s)
  while (last !== null && !last.justCleared && steps < 20) {
    last = decayDebt(s)
    steps += 1
  }
  assert.ok(last.justCleared, '最后该清掉')
  assert.equal(s.debt, null)
  assert.ok(steps < 10)
})

test('没挂账时 decay 是安全的空操作', () => {
  assert.equal(decayDebt({}), null)
  assert.equal(decayDebt(null), null)
})

test('注入文本说清还剩几轮，也提醒别迁怒', () => {
  const s = {}
  accrueDebt(s, '生气', 3)
  const line = debtHint(s)
  assert.ok(line.includes('生气'), line)
  assert.ok(line.includes('轮'), line)
  assert.ok(line.includes('别迁怒'), '情绪残余不是让她迁怒的借口')
  assert.equal(debtHint({}), '')
})

test('情绪优先于工作：余温盖过「他在工作」', () => {
  const s = {}
  accrueDebt(s, '生气', 3)
  const line = inertiaHint({
    debt: debtHint(s),
    focus: { focus: true, hits: ['代码'] },
    praise: { owesTruth: true, threshold: 3 },
  })
  assert.ok(line.includes('余温'), `情绪该排在第一位：${line}`)
})

test('配置可覆盖', () => {
  const s = {}
  accrueDebt(s, '生气', 2, { debt: { threshold: 2, turns: { 生气: 1 }, defaultTurns: 1 } })
  assert.ok(s.debt !== null)
  assert.equal(s.debt.turnsLeft, 1)
  assert.equal(INERTIA_DEFAULTS.debt.threshold, 3, '默认值不该被改')
})
