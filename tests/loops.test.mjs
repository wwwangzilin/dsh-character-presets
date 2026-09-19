/**
 * 牵挂层测试。
 *
 * 三条规矩各有一条硬断言：
 *   · 冷却 —— 刚说完不许立刻追问（那是复读机）
 *   · 问满两次就收手（第三次变成烦人）
 *   · 工作时刻不问（干活别打岔）
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LOOP_DEFAULTS,
  dueLoop,
  extractLoop,
  loopLine,
  looksResolved,
  markAsked,
  mergeLoops,
} from '../luna-loops.mjs'

const T0 = 1_700_000_000_000
const HOUR = 3_600_000

test('抽取：「我在改那个备份脚本」', () => {
  const l = extractLoop('我在改那个备份脚本', T0)
  assert.ok(l !== null)
  assert.equal(l.kind, 'doing')
  assert.ok(l.text.includes('备份脚本'))
  assert.equal(l.asks, 0)
})

test('抽取：「明天要发版」', () => {
  const l = extractLoop('明天要发版，还得再测一轮', T0)
  assert.ok(l !== null)
  assert.equal(l.kind, 'plan')
})

test('抽取：「那个 bug 还没修」', () => {
  const l = extractLoop('那个 bug 还没修', T0)
  assert.ok(l !== null, '「还没修」也是没完的事')
  assert.equal(l.kind, 'stuck')
})

test('普通闲聊不该被当成牵挂', () => {
  assert.equal(extractLoop('今天天气不错', T0), null)
  assert.equal(extractLoop('哈哈', T0), null)
  assert.equal(extractLoop('', T0), null)
})

test('了结识别', () => {
  assert.equal(looksResolved('搞定了'), true)
  assert.equal(looksResolved('已经跑通了'), true)
  assert.equal(looksResolved('还在弄'), false)
})

test('冷却：刚说完不许立刻追问', () => {
  const { loops } = mergeLoops([], '我在改那个备份脚本', T0, {})
  assert.equal(loops.length, 1)
  // 轮数不够 → 不问
  assert.equal(dueLoop(loops, { turns: 3, now: T0 + 5 * HOUR }), null)
  // 时间不够 → 不问
  assert.equal(dueLoop(loops, { turns: 20, now: T0 + 5 * 60_000 }), null)
  // 两个都够 → 问
  assert.ok(dueLoop(loops, { turns: 20, now: T0 + 2 * HOUR }) !== null)
})

test('工作时刻不问——干活别打岔', () => {
  const { loops } = mergeLoops([], '我在改那个备份脚本', T0, {})
  const ready = { turns: 20, now: T0 + 2 * HOUR }
  assert.ok(dueLoop(loops, ready) !== null)
  assert.equal(dueLoop(loops, { ...ready, mode: 'work' }), null)
})

test('问满两次就收手', () => {
  let { loops } = mergeLoops([], '我在改那个备份脚本', T0, {})
  const ready = { turns: 20, now: T0 + 2 * HOUR }
  const first = dueLoop(loops, ready)
  assert.ok(first !== null)
  loops = markAsked(loops, first.text)
  const second = dueLoop(loops, ready)
  assert.ok(second !== null, '第二次还可以问')
  loops = markAsked(loops, second.text)
  assert.equal(dueLoop(loops, ready), null, `问满 ${LOOP_DEFAULTS.maxAsks} 次就该收手`)
})

test('说「搞定了」就把最旧的一条划掉', () => {
  let { loops } = mergeLoops([], '我在改那个备份脚本', T0, {})
  assert.equal(loops.length, 1)
  const r = mergeLoops(loops, '搞定了！', T0 + HOUR, {})
  assert.equal(r.loops.length, 0)
  assert.equal(r.closed, 1)
})

test('同一件事不重复记', () => {
  let { loops } = mergeLoops([], '我在改那个备份脚本', T0, {})
  const again = mergeLoops(loops, '我在改那个备份脚本', T0 + 1000, {})
  assert.equal(again.loops.length, 1, '重复提同一件事不该攒两条')
})

test('上限：只留最近的若干条', () => {
  let loops = []
  for (let i = 0; i < 30; i += 1) {
    loops = mergeLoops(loops, `我在改第 ${i} 个脚本文件`, T0 + i * 1000, {}).loops
  }
  assert.ok(loops.length <= LOOP_DEFAULTS.maxLoops, `实际 ${loops.length} 条`)
})

test('loopLine 说清是多久前提的', () => {
  const { loops } = mergeLoops([], '我在改那个备份脚本', T0, {})
  const due = dueLoop(loops, { turns: 20, now: T0 + 5 * HOUR })
  const line = loopLine(due)
  assert.ok(line.includes('5 小时前'), line)
  assert.ok(line.includes('备份脚本'), line)
  assert.equal(loopLine(null), '')

  const days = loopLine({ text: '发版', ageMs: 3 * 24 * HOUR })
  assert.ok(days.includes('3 天前'), days)
})

test('缺失输入不炸', () => {
  assert.equal(dueLoop(null, {}), null)
  assert.equal(dueLoop([], {}), null)
  assert.deepEqual(markAsked(null, 'x'), [])
  assert.equal(mergeLoops(null, '', T0).loops.length, 0)
})
