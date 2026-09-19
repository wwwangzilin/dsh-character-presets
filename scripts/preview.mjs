#!/usr/bin/env node
/**
 * 效果预览：把感知层 + 生理层对若干典型句子的判断打出来。
 *
 * 用法：node scripts/preview.mjs
 * 改完 luna-emotion.mjs / luna-vitals.mjs 后跑一下，比读代码快。
 */
import { analyzeEmotion } from '../luna-emotion.mjs'
import { deriveAndSmooth, describeVitals, rhythmLine } from '../luna-vitals.mjs'
import { nextMode } from '../luna-mode.mjs'
import { absenceLine } from '../luna-offline.mjs'
import { dueLoop, loopLine, mergeLoops } from '../luna-loops.mjs'
import { accrueDebt, debtHint, decayDebt } from '../luna-inertia.mjs'

const SAMPLES = [
  '我不开心',
  '今天特别开心！！！',
  '哈哈哈哈这也太好笑了',
  '哈哈',
  '真是气笑了',
  '烦死了！！！',
  '算了，随便吧',
  '我没事',
  '怎么办？？？来不及了……',
  '有点累',
  '把那个文件的报错修一下',
  '抱抱我嘛',
]

console.log('情绪感知层')
console.log('─'.repeat(72))
for (const text of SAMPLES) {
  const r = analyzeEmotion(text)
  const tag = [r.label, r.secondary ? `+${r.secondary}` : ''].join('')
  const flags = [
    `强度${r.level}`,
    r.negated ? '否定' : '',
    r.hidden ? '口是心非' : '',
    (r.signals ?? []).join('/'),
  ].filter(Boolean).join(' ')
  console.log(`${text.padEnd(22, '　')} → ${tag.padEnd(8)} ${flags}`)
}

console.log('')
console.log('生理层（同一句话在不同心情下的身体事实）')
console.log('─'.repeat(72))
const moods = ['平淡', '傲娇', '开心', '撒娇', '生气', '委屈', '心疼', '焦虑', '认真工作']
for (const mood of moods) {
  const state = {
    mood,
    tension: mood === '生气' || mood === '焦虑' ? 75 : 30,
    energy: 65,
    interest: 65,
    patience: mood === '生气' ? 40 : 80,
  }
  // 每档独立派生（不复用上一档的平滑结果），否则惯性会把差异抹平
  console.log(`${mood.padEnd(4, '　')} → ${describeVitals(deriveAndSmooth(state, null, {}))}`)
}

console.log('')
console.log('时刻层（工作 / 闲聊的粘滞——注意「嗯」「继续」不打断干活）')
console.log('─'.repeat(72))
const CONVO = [
  '帮我把那个备份脚本改一下',
  '嗯',
  '继续',
  '好了吗',
  '陪我聊会嘛',
  '你在干嘛呀',
]
let ms = null
let clock = 1_000_000
for (const text of CONVO) {
  ms = nextMode(ms, text, '平淡', { now: (clock += 60_000) })
  const tag = ms.mode === 'work' ? '工作' : '闲聊'
  console.log(`${text.padEnd(24, '　')} → ${tag.padEnd(4, '　')}（${ms.reason}）`)
}

const T = 1_700_000_000_000

console.log('')
console.log('不在场层（同一间隔内恒定，不会每轮变）')
console.log('─'.repeat(72))
for (const [label, span] of [
  ['3 分钟', 3 * 60_000], ['40 分钟', 40 * 60_000], ['5 小时', 5 * 3_600_000],
  ['20 小时', 20 * 3_600_000], ['3 天', 3 * 86_400_000],
]) {
  console.log(`${label.padEnd(10, '　')} → ${absenceLine(T, T + span) || '（太短，不交代行踪）'}`)
}

console.log('')
console.log('牵挂层（冷却够了才问一句）')
console.log('─'.repeat(72))
let loops = mergeLoops([], '我在改那个备份脚本', T).loops
loops = mergeLoops(loops, '明天要发版', T + 1000).loops
console.log(`记下 ${loops.length} 件：${loops.map((l) => l.text).join('；')}`)
const ready = { turns: 20, now: T + 2 * 3_600_000 }
console.log(`冷却够了 → ${loopLine(dueLoop(loops, ready)) || '（还没有该问的）'}`)
console.log(`工作时刻 → ${dueLoop(loops, { ...ready, mode: 'work' }) === null ? '不问（干活别打岔）' : '还是会问'}`)

console.log('')
console.log('情感债（先消一点，再看这轮要不要续）')
console.log('─'.repeat(72))
const debtState = {}
accrueDebt(debtState, '生气', 3)
console.log(`刚被惹 → ${debtHint(debtState)}`)
for (let i = 1; i <= 5; i += 1) {
  decayDebt(debtState)
  console.log(`第 ${i} 轮没再被惹 → ${debtHint(debtState) || '（气消了）'}`)
}

console.log('')
console.log('昼夜节律')
console.log('─'.repeat(72))
for (const h of [3, 7, 10, 13, 16, 19, 23]) {
  console.log(`${String(h).padStart(2, '0')}:00 → ${rhythmLine(h) || '（不困不饿，不占字）'}`)
}
