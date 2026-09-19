/**
 * 生理层测试。
 *
 * v2 的核心主张是「报告能演出来的事实」，所以这里盯的是三件事：
 *   · 平静时不给数字（数字一多就变成噪音）
 *   · 局部体感按心情走（露娜的破绽在耳朵和尾巴上）
 *   · 抖动带方向（傲娇偏高、委屈偏低，不是纯随机）
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  VITALS_DEFAULTS,
  breathWord,
  deriveVitals,
  deriveAndSmooth,
  describeVitals,
  hrWord,
  intensityOf,
  sensationsFor,
  smoothVitals,
  tempWord,
  worthNumber,
} from '../luna-vitals.mjs'

test('平静时不给数字，激动时才给', () => {
  const calm = describeVitals({ heartRate: 72, bodyTemp: 36.5, breath: 16, mood: '平淡', intensity: 1 })
  assert.ok(!/\d/.test(calm), `平静时不该出现数字：${calm}`)
  assert.equal(calm, '心跳和呼吸都很稳', '两个「平稳」该合并成一句')

  const wild = describeVitals({ heartRate: 112, bodyTemp: 36.9, breath: 28, mood: '生气', intensity: 3 })
  assert.ok(wild.includes('112'), `激动时该报数字：${wild}`)
  assert.ok(wild.includes('快得藏不住'))
})

test('体温不再报小数点，只报身体哪一处有温度', () => {
  assert.equal(tempWord(36.5), '体温正常')
  assert.equal(tempWord(36.9), '耳根发烫')
  assert.equal(tempWord(36.3), '指尖发凉')
  const line = describeVitals({ heartRate: 72, bodyTemp: 36.5, breath: 16, mood: '平淡', intensity: 1 })
  assert.ok(!line.includes('℃'), '正常体温不该占字')
})

test('局部体感按心情走：傲娇在耳朵和尾巴上', () => {
  const mild = sensationsFor('傲娇', 1)
  const strong = sensationsFor('傲娇', 3)
  assert.equal(mild.length, 1)
  assert.ok(strong.length >= 3, '强度高时给的细节更多')
  assert.ok(mild.join().includes('耳朵'))
  assert.ok(strong.join().includes('尾巴'), '傲娇破绽要落在尾巴上')

  assert.ok(sensationsFor('生气', 3).join().includes('后颈'))
  assert.ok(sensationsFor('委屈', 3).join().includes('尾巴'))
  // 平静时不该硬塞反应
  assert.deepEqual(sensationsFor('平淡', 1), [])
})

test('未知心情走兜底表，不炸', () => {
  assert.ok(Array.isArray(sensationsFor('莫名其妙', 2)))
  const line = describeVitals({ heartRate: 88, bodyTemp: 36.5, breath: 20, mood: '莫名其妙', intensity: 2 })
  assert.ok(line.length > 0)
})

test('呼吸与心情挂钩：生气急、心疼缓', () => {
  const base = { tension: 25, energy: 60, interest: 60, patience: 80 }
  const angry = deriveVitals({ ...base, mood: '生气' })
  const tender = deriveVitals({ ...base, mood: '心疼' })
  const plain = deriveVitals({ ...base, mood: '平淡' })
  assert.ok(angry.breath > plain.breath, `生气呼吸该更快：${angry.breath} vs ${plain.breath}`)
  assert.ok(tender.breath < plain.breath, `心疼呼吸该更缓：${tender.breath} vs ${plain.breath}`)
  assert.equal(breathWord(32), '很急促')
  assert.equal(breathWord(11), '轻得几乎听不见')
})

test('抖动带方向：傲娇整体偏高，委屈整体偏低', () => {
  const base = { tension: 25, energy: 60, interest: 60, patience: 80 }
  const avg = (mood) => {
    let sum = 0
    for (let i = 0; i < 400; i += 1) sum += deriveVitals({ ...base, mood }).heartRate
    return sum / 400
  }
  const proud = avg('傲娇')
  const sad = avg('委屈')
  const plain = avg('平淡')
  assert.ok(proud > plain, `傲娇该偏高：${proud} vs ${plain}`)
  assert.ok(sad < plain, `委屈该偏低：${sad} vs ${plain}`)
})

test('久别重逢：心跳先快一步', () => {
  const state = { tension: 25, energy: 60, interest: 60, patience: 80, mood: '平淡' }
  const now = Date.now()
  const fresh = deriveVitals({ ...state, lastSeenMs: now - 60_000 }, { now })
  const reunion = deriveVitals({ ...state, lastSeenMs: now - 72 * 3_600_000 }, { now })
  // 抖动 ±1.6，久别加成 4，平均值必然分开
  assert.ok(reunion.heartRate > fresh.heartRate, `久别该更快：${reunion.heartRate} vs ${fresh.heartRate}`)
})

test('强度分档：1 平静、3 激动', () => {
  assert.equal(intensityOf({ tension: 10, energy: 55, interest: 55, mood: '平淡' }), 1)
  assert.equal(intensityOf({ tension: 90, energy: 85, interest: 80, mood: '生气' }), 3)
})

test('平滑：身体慢半拍，但心情与强度当轮生效', () => {
  const prev = { heartRate: 72, bodyTemp: 36.5, breath: 16, mood: '平淡', intensity: 1 }
  const target = { heartRate: 112, bodyTemp: 36.9, breath: 30, mood: '生气', intensity: 3 }
  const next = smoothVitals(prev, target, 0.5)
  assert.ok(next.heartRate > 72 && next.heartRate < 112, `该落在中间：${next.heartRate}`)
  assert.equal(next.mood, '生气', '心情不该被平滑拖慢')
  assert.equal(next.intensity, 3)
})

test('派生产物自带 mood 与 intensity，供体感表使用', () => {
  const v = deriveVitals({ tension: 70, energy: 70, interest: 70, mood: '生气', patience: 40 })
  assert.equal(v.mood, '生气')
  assert.ok(v.intensity >= 2)
  assert.equal(typeof v.bodyTemp, 'number')
  const line = describeVitals(deriveAndSmooth({ mood: '傲娇', tension: 30, energy: 60, interest: 60 }, null))
  assert.ok(line.includes('心跳'))
})

test('缺失输入不炸', () => {
  assert.equal(describeVitals(null), '')
  assert.equal(describeVitals({}), '')
  assert.ok(describeVitals(deriveVitals({})).length > 0)
  assert.equal(worthNumber(72), false)
  assert.equal(worthNumber(101), true)
  assert.equal(hrWord(VITALS_DEFAULTS.baseline.heartRate), '平稳')
})

test('体感表里不许出现「呼吸」——呼吸由 breathWord 统一说', () => {
  const moods = ['傲娇', '开心', '生气', '撒娇', '委屈', '心疼', '焦虑', '难过', '认真工作', '平淡']
  for (const mood of moods) {
    for (const level of [1, 2, 3]) {
      const text = sensationsFor(mood, level).join('，')
      assert.ok(!text.includes('呼吸'), `${mood} 强度${level} 的体感混进了呼吸：${text}`)
    }
  }
})

test('输出不重复同一件事', () => {
  for (const mood of ['生气', '焦虑', '傲娇', '难过']) {
    const line = describeVitals({
      heartRate: 96, bodyTemp: 36.9, breath: 26, mood, intensity: 3,
    })
    const 呼吸数 = (line.match(/呼吸/g) ?? []).length
    assert.equal(呼吸数, 1, `${mood} 的呼吸说了 ${呼吸数} 遍：${line}`)
    const 心跳数 = (line.match(/心跳/g) ?? []).length
    assert.equal(心跳数, 1, `${mood} 的心跳说了 ${心跳数} 遍：${line}`)
  }
})

test('长度可控：最多五段，不会滚成一长串', () => {
  const line = describeVitals({ heartRate: 108, bodyTemp: 36.9, breath: 28, mood: '生气', intensity: 3 })
  assert.ok(line.split('，').length <= 5, `太长了：${line}`)
})
