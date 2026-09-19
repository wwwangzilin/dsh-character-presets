/**
 * 姐妹层测试。
 *
 * 两条底线：
 *   · 坏文件 / 空文件 / 奇怪结构一律当空表，绝不抛错（它在 preset 目录之外，读写都可能失败）
 *   · 不把自己算进去，也不翻 24 小时以前的事（不然像查岗）
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SIBLING_FILE,
  SIBLING_FRESH_MS,
  readRecords,
  siblingLine,
  siblingSeen,
  touchRecord,
} from '../luna-siblings.mjs'

const T0 = 1_700_000_000_000
const HOUR = 3_600_000

test('文件名是跨 preset 的那个', () => {
  assert.equal(SIBLING_FILE, '.siblings.json')
})

test('容错解析：坏输入当空表，不抛错', () => {
  assert.deepEqual(readRecords(null), {})
  assert.deepEqual(readRecords(undefined), {})
  assert.deepEqual(readRecords(''), {})
  assert.deepEqual(readRecords('{ 坏掉的 json'), {})
  assert.deepEqual(readRecords('[1,2,3]'), {})
  assert.deepEqual(readRecords('"just a string"'), {})
})

test('解析：缺 name 用 id 兜底，坏时间归零', () => {
  const r = readRecords('{"nekomode":{"at":123},"michiyo":{"name":"三千代","at":"oops"}}')
  assert.equal(r.nekomode.name, 'nekomode')
  assert.equal(r.nekomode.at, 123)
  assert.equal(r.michiyo.name, '三千代')
  assert.equal(r.michiyo.at, 0)
})

test('记一笔：不改入参', () => {
  const before = {}
  const after = touchRecord(before, 'luna', '露娜', T0)
  assert.deepEqual(before, {}, '原表不该被改')
  assert.equal(after.luna.name, '露娜')
  assert.equal(after.luna.at, T0)
  assert.equal(touchRecord(null, 'luna', '露娜', T0).luna.at, T0)
  assert.deepEqual(touchRecord({ a: 1 }, '', 'x', T0), { a: 1 }, '空 id 不该写进去')
})

test('看得见别人，看不见自己', () => {
  const table = touchRecord(touchRecord({}, 'nekomode', '小喵', T0 - 2 * HOUR), 'luna', '露娜', T0)
  const seen = siblingSeen(table, 'luna', T0)
  assert.ok(seen !== null)
  assert.equal(seen.name, '小喵')
  assert.equal(seen.agoText, '2 小时前')
  // 从别人的视角看，该看见露娜
  assert.equal(siblingSeen(table, 'nekomode', T0).name, '露娜')
})

test('太久以前的就不提了', () => {
  const table = touchRecord({}, 'nekomode', '小喵', T0 - SIBLING_FRESH_MS - 1)
  assert.equal(siblingSeen(table, 'luna', T0), null)
})

test('只有自己一个人时安静', () => {
  const table = touchRecord({}, 'luna', '露娜', T0)
  assert.equal(siblingSeen(table, 'luna', T0), null)
  assert.equal(siblingLine(table, 'luna', T0), '')
  assert.equal(siblingLine({}, 'luna', T0), '')
})

test('挑最近来过的那位', () => {
  let table = touchRecord({}, 'michiyo', '三千代', T0 - 5 * HOUR)
  table = touchRecord(table, 'nekomode', '小喵', T0 - 10 * 60_000)
  const seen = siblingSeen(table, 'luna', T0)
  assert.equal(seen.name, '小喵', '该挑最近的')
  assert.equal(seen.agoText, '10 分钟前')
})

test('注入文本允许吃醋但不许刻薄', () => {
  const table = touchRecord({}, 'nekomode', '小喵', T0 - HOUR)
  const line = siblingLine(table, 'luna', T0)
  assert.ok(line.includes('小喵'), line)
  assert.ok(line.includes('1 小时前'), line)
  assert.ok(line.includes('别刻薄'), '她们是同伴，不是对手')
})

test('时间说成人话', () => {
  const mk = (ms) => siblingSeen(touchRecord({}, 'x', 'X', T0 - ms), 'luna', T0).agoText
  assert.equal(mk(30_000), '刚刚')
  assert.equal(mk(30 * 60_000), '30 分钟前')
  assert.equal(mk(3 * HOUR), '3 小时前')
  assert.ok(mk(20 * HOUR).includes('小时'))
})
