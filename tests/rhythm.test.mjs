/**
 * 昼夜节律测试。
 *
 * 它便宜是因为不用记任何东西——只用一个钟点就能让「今天的她」和昨天不一样。
 * 所以这里盯两件事：钟点映射对不对（别把凌晨算成清醒），
 * 以及它不该让缺失 hour 的旧调用方出问题。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  deriveVitals,
  describeVitals,
  rhythmLine,
  rhythmOf,
  rhythmSensation,
} from '../luna-vitals.mjs'

test('凌晨最困，上午最清醒', () => {
  assert.ok(rhythmOf(3).sleepiness >= 0.8, '凌晨该很困')
  assert.ok(rhythmOf(10).sleepiness <= 0.1, '上午该最清醒')
  assert.ok(rhythmOf(3).sleepiness > rhythmOf(10).sleepiness)
})

test('时段名按钟点走', () => {
  assert.equal(rhythmOf(2).label, '深夜')
  assert.equal(rhythmOf(7).label, '清晨')
  assert.equal(rhythmOf(10).label, '上午')
  assert.equal(rhythmOf(13).label, '中午')
  assert.equal(rhythmOf(16).label, '下午')
  assert.equal(rhythmOf(19).label, '傍晚')
  assert.equal(rhythmOf(23).label, '夜里')
})

test('饭点前最饿', () => {
  assert.ok(rhythmOf(11).hunger > rhythmOf(8).hunger)
  assert.ok(rhythmOf(19).hunger > rhythmOf(15).hunger)
  assert.ok(rhythmOf(19).hunger >= 0.7)
})

test('小时数绕回：25 点等于凌晨 1 点', () => {
  assert.equal(rhythmOf(25).hour, 1)
  assert.equal(rhythmOf(-1).hour, 23)
  assert.equal(rhythmOf(25).sleepiness, rhythmOf(1).sleepiness)
})

test('困倦让身体整体慢下来', () => {
  const state = { mood: '平淡', tension: 25, energy: 60, interest: 60, patience: 80 }
  const night = deriveVitals(state, { hour: 3 })
  const morning = deriveVitals(state, { hour: 10 })
  assert.ok(night.rhythm !== null)
  assert.ok(night.breath < morning.breath, `夜里呼吸该更慢：${night.breath} vs ${morning.breath}`)
  assert.ok(night.bodyTemp < morning.bodyTemp, '夜里体温该更低')
})

test('不给 hour 就完全不启用，旧调用方不受影响', () => {
  const v = deriveVitals({ mood: '平淡' })
  assert.equal(v.rhythm, null)
  assert.equal(rhythmSensation(null), '')
  assert.equal(rhythmLine(undefined), '')
})

test('节律体感：困优先于饿，一次只出一条', () => {
  assert.equal(rhythmSensation(rhythmOf(3)), '眼皮发沉')
  assert.equal(rhythmSensation(rhythmOf(19)), '肚子在叫')
  assert.equal(rhythmSensation({ sleepiness: 0.35, hunger: 0 }), '打了个哈欠')
  assert.equal(rhythmSensation({ sleepiness: 0.05, hunger: 0.2 }), '')
})

test('节律注入文本说清「想不想硬撑你自己决定」', () => {
  const line = rhythmLine(3)
  assert.ok(line.includes('深夜'), line)
  assert.ok(line.includes('你自己决定'), '只报告不命令——这是这个模块的底线')
  assert.equal(rhythmLine(15), '', '下午不困不饿时不该占字')
})

test('输出长度仍然可控：节律只占一条', () => {
  const line = describeVitals({
    heartRate: 70, bodyTemp: 36.4, breath: 14, mood: '难过', intensity: 3, rhythm: rhythmOf(3),
  })
  assert.ok(line.split('，').length <= 5, `太长了：${line}`)
  assert.equal((line.match(/眼皮发沉/g) ?? []).length, 1)
})
