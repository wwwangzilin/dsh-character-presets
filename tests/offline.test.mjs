/**
 * 不在场层测试。
 *
 * 最要紧的一条是**确定性**：同一个间隔必须每次派生出同一件事。
 * 如果每轮都变，「她刚才在睡觉」和「她刚才在翻你抽屉」会前后打架，
 * 那比不写还糟——所以这里用 200 次重复调用来钉死它。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  absenceLine,
  isLongAbsence,
  offlineGap,
  offscreenEvent,
  pickStable,
} from '../luna-offline.mjs'

const T0 = 1_700_000_000_000
const MIN = 60_000
const HOUR = 3_600_000

test('刚走开不值得编故事', () => {
  assert.equal(offscreenEvent(T0, T0 + 4 * MIN), null)
  assert.equal(absenceLine(T0, T0 + 4 * MIN), '')
})

test('分桶：一小时 / 半天 / 一天 / 几天 / 很久', () => {
  assert.equal(offlineGap(T0, T0 + 30 * MIN).key, 'short')
  assert.equal(offlineGap(T0, T0 + 4 * HOUR).key, 'half-day')
  assert.equal(offlineGap(T0, T0 + 20 * HOUR).key, 'day')
  assert.equal(offlineGap(T0, T0 + 3 * 24 * HOUR).key, 'days')
  assert.equal(offlineGap(T0, T0 + 30 * 24 * HOUR).key, 'long')
})

test('确定性：同一间隔调用 200 次，结果必须完全一致', () => {
  const now = T0 + 5 * HOUR
  const first = offscreenEvent(T0, now)
  assert.ok(first !== null && first.text.length > 0)
  for (let i = 0; i < 200; i += 1) {
    assert.equal(offscreenEvent(T0, now).text, first.text, `第 ${i} 次不一致`)
  }
})

test('确定性不靠时间：只有 lastSeenMs 参与种子', () => {
  const a = offscreenEvent(T0, T0 + 3 * HOUR)
  const b = offscreenEvent(T0, T0 + 3 * HOUR + 1000)  // now 抖一下，同桶
  assert.equal(a.text, b.text, '同一桶内不该因为多聊了几秒就换一件事')
})

test('不同间隔可以落在不同的事件上', () => {
  const texts = new Set()
  for (let i = 0; i < 40; i += 1) {
    const seen = T0 + i * 7919
    const ev = offscreenEvent(seen, seen + 3 * HOUR)
    if (ev !== null) texts.add(ev.text)
  }
  assert.ok(texts.size > 1, `种子该有分散性，实际只有 ${texts.size} 种`)
})

test('pickStable 的边界', () => {
  assert.equal(pickStable([], 1), null)
  assert.equal(pickStable(null, 1), null)
  assert.equal(pickStable(['only'], 12345), 'only')
  const list = ['a', 'b', 'c']
  const first = pickStable(list, 42)
  for (let i = 0; i < 50; i += 1) assert.equal(pickStable(list, 42), first)
})

test('absenceLine 的格式', () => {
  const line = absenceLine(T0, T0 + 5 * HOUR)
  assert.ok(line.startsWith('不在场：'), line)
  assert.ok(line.length > 4)
})

test('久别判定以 24 小时为界', () => {
  assert.equal(isLongAbsence(T0, T0 + 2 * HOUR), false)
  assert.equal(isLongAbsence(T0, T0 + 25 * HOUR), true)
})

test('缺失或倒退的输入不炸', () => {
  assert.equal(offlineGap(undefined, T0), null)
  assert.equal(offlineGap(0, T0), null)
  assert.equal(offlineGap(T0, T0 - 1000), null)
  assert.equal(offscreenEvent(null, T0), null)
  assert.equal(absenceLine('abc', T0), '')
})
