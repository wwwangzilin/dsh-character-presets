/**
 * 时刻层测试。
 *
 * 核心主张是**粘滞**——工作的「劲头」不该被一句「嗯」「继续」打断，
 * 也不该在活干到一半时被一句闲话立刻切走。所以这里盯三件事：
 *   · 进入：贴代码/路径/报错/追问都能上劲
 *   · 粘住：粘滞期内的短消息不退出
 *   · 退出：要明确的闲聊信号，且粘滞期已过
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MODE_DEFAULTS,
  WORK_GUARD,
  WORK_STYLE,
  chatScore,
  modeLine,
  nextMode,
  recallBias,
  workScore,
} from '../luna-mode.mjs'

/** 连续喂若干条消息，返回最后的状态与全部轨迹。 */
function feed(messages, opts = {}) {
  let state = null
  const trail = []
  let t = 1_000_000
  for (const msg of messages) {
    state = nextMode(state, msg.text, msg.explicit ?? '平淡', { ...opts, now: (t += 60_000) })
    trail.push(state.reason)
  }
  return { state, trail }
}

test('工作信号：贴代码、路径、报错、追问都算上劲', () => {
  assert.ok(workScore('```js\nconst a = 1\n```') >= 2, '代码块')
  assert.ok(workScore('看下 D:\\projects\\tool\\a.mjs') >= 2, '路径')
  assert.ok(workScore('报错是 ERR_MODULE_NOT_FOUND') >= 2, '报错')
  assert.ok(workScore('继续') >= 2, '「继续」是干活时的追问')
  assert.ok(workScore('把那个函数改一下') >= 2, '祈使句')
  assert.equal(workScore(''), 0)
})

test('闲聊信号：撒娇、问候、求陪', () => {
  assert.ok(chatScore('陪我聊会嘛') >= 3)
  assert.ok(chatScore('你在干嘛呀') >= 2)
  assert.ok(chatScore('抱抱') >= 1)
})

test('技术语境里的「你觉得」不算闲聊', () => {
  const plain = chatScore('你觉得我可爱吗')
  const tech = chatScore('你觉得这个接口的设计怎么样')
  assert.ok(tech < plain, `技术语境该打折：${tech} vs ${plain}`)
})

test('进入工作：一条明确的活就上劲', () => {
  const { state } = feed([{ text: '把 luna-soul.mjs 里的报错修一下' }])
  assert.equal(state.mode, 'work')
  assert.ok(state.sticky > 0, '刚进入该有粘滞额度')
})

test('粘滞：进去之后「嗯」「继续」不把人拽出来', () => {
  const { state, trail } = feed([
    { text: '帮我把那个部署脚本改一下' },
    { text: '嗯' },
    { text: '继续' },
    { text: '好了吗' },
  ])
  assert.equal(state.mode, 'work', `中间不该退出，轨迹：${trail.join(' → ')}`)
})

test('退出：粘滞期过后，明确的闲聊才放行', () => {
  const msgs = [{ text: '把那个脚本重构一下' }]
  // 把粘滞额度耗完
  for (let i = 0; i < MODE_DEFAULTS.stickTurns; i += 1) msgs.push({ text: '嗯' })
  msgs.push({ text: '陪我聊会嘛' })
  const { state } = feed(msgs)
  assert.equal(state.mode, 'chat')
})

test('强力打断：「陪我聊会」不必等粘滞期', () => {
  const { state } = feed([
    { text: '把那个脚本重构一下' },
    { text: '陪我聊会嘛' },
  ])
  assert.equal(state.mode, 'chat', '明确要走人时该放行')
})

test('粘滞期过了但仍在干活 → 继续待在工作时刻', () => {
  const msgs = [{ text: '把那个脚本重构一下' }]
  for (let i = 0; i < MODE_DEFAULTS.stickTurns + 2; i += 1) msgs.push({ text: '接着改这个文件' })
  const { state } = feed(msgs)
  assert.equal(state.mode, 'work')
})

test('长时间没说话 → 重置回闲聊', () => {
  let state = nextMode(null, '把那个脚本重构一下', '认真工作', { now: 1_000_000 })
  assert.equal(state.mode, 'work')
  // 隔了 8 小时再说一句闲话
  state = nextMode(state, '在吗', '平淡', { now: 1_000_000 + 8 * 3_600_000 })
  assert.equal(state.mode, 'chat')
  assert.equal(state.reason, 'idle-reset')
})

test('空闲后第一句就是活 → 直接上劲', () => {
  let state = nextMode(null, '嗯', '平淡', { now: 1_000_000 })
  assert.equal(state.mode, 'chat')
  state = nextMode(state, '把备份脚本修一下', '认真工作', { now: 1_000_000 + 8 * 3_600_000 })
  assert.equal(state.mode, 'work')
})

test('轮数在同一个时刻里累加，切回闲聊后归 1', () => {
  const { state } = feed([
    { text: '把那个脚本重构一下' },
    { text: '接着改' },
    { text: '再往下' },
  ])
  assert.ok(state.turns >= 3, `该累计轮数：${state.turns}`)

  const after = feed([
    { text: '把那个脚本重构一下' },
    { text: '陪我聊会嘛' },
  ])
  assert.equal(after.state.turns, 1)
})

test('工作档位：给的是「铆足劲」，不是卖萌', () => {
  assert.ok(WORK_STYLE.style.includes('铆足劲'))
  assert.ok(WORK_STYLE.style.includes('不猜着编'), '不许瞎猜——这是工作守则的底线')
  assert.ok(WORK_GUARD.includes('不打岔'))
  assert.equal(modeLine('chat', 3), '')
  assert.ok(modeLine('work', 1).includes('铆足劲'))
  assert.ok(modeLine('work', 4).includes('4 轮'))
})

test('工作时刻抬高情感路门槛，闲聊时不干预', () => {
  const cfg = { arousalThreshold: 0.7, maxResults: 6 }
  const work = recallBias('work', cfg)
  assert.ok(work.arousalThreshold > cfg.arousalThreshold, '工作时刻该更难启用情感路')
  assert.equal(work.maxResults, undefined, '不该顺手改别的配置')
  assert.deepEqual(recallBias('chat', cfg), {}, '闲聊时什么都不覆盖')
  assert.deepEqual(recallBias('work', {}), {}, '检索没配阈值时不猜默认值')
})

test('缺失输入不炸', () => {
  assert.equal(workScore(''), 0)
  assert.equal(chatScore(null), 0)
  assert.equal(nextMode(null, '', undefined, { now: 1 }).mode, 'chat')
  assert.equal(nextMode(undefined, '嗯', '平淡', { now: 1 }).mode, 'chat')
})
