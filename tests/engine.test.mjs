// 引擎级集成测试：真的 apply 一次，跑一轮对话，看记忆有没有按 v2 落库、能不能跨会话读回。
//
//   node --test tests/engine.test.mjs
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { apply, __resetHeartMemory, __setFileBackend, inject } from '../luna-soul.mjs'

/** 首选落点（DSH home）：固定位置 —— 换启动目录、换工作区都还是同一份记忆。 */
const HOME_MEMORY = 'C:/fake-home/.dsh/.luna-heart.json'
/** 兜底落点（工作区根）：沙箱不许写 home 时才用。 */
const WORKSPACE_MEMORY = 'D:/fake-workspace/.luna-heart.json'

const ORIGINAL_DSH_HOME = process.env.DSH_HOME

beforeEach(() => {
  // 记忆缓存在模块级（真实运行时的有意设计），测试之间必须显式隔离。
  __resetHeartMemory()
  // home 必须可控，否则落点会跟着真机的 ~/.dsh 跑。
  process.env.DSH_HOME = 'C:/fake-home/.dsh'
})

afterEach(() => {
  if (ORIGINAL_DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = ORIGINAL_DSH_HOME
  // 后端是模块级的，测试之间必须还原，否则下一个测试会往上一个的文件表里写
  __setFileBackend(null)
})

/**
 * 最小 ctx 替身：只要 tools.register / get / logger。
 *
 * 替身必须跟真机一致 —— 这是踩过的坑：早期版本这里给 `ctx.get('dshHome')` 编了一个
 * 返回值，可真实环境里 **dshHome 根本不是 cordis 服务**，于是生产代码里那条候选永远
 * 抛错、被 catch 吞掉，记忆一次都没落过盘，而测试全程绿灯。现在只提供真实存在的
 * `sandboxPolicy`；`denyWrite` 用来模拟沙箱拒绝某个落点。
 *
 * 记忆层现在走 `node:fs/promises` **直写**（绕开沙箱对 ctx.fs 的限制，那正是记忆
 * 长期存不下去的根因），所以文件替身挂在「文件后端」上而不是 ctx.fs 上——
 * 不换的话，测试会真的往磁盘写文件。
 */
function makeCtx(options = {}) {
  const tools = []
  const files = new Map()
  const workspaceRoot = options.workspaceRoot === undefined ? 'D:/fake-workspace' : options.workspaceRoot
  const denyWrite = options.denyWrite ?? []

  __setFileBackend({
    readText: async (file) => {
      if (!files.has(file)) throw new Error('ENOENT')
      return files.get(file)
    },
    writeText: async (file, text) => {
      if (denyWrite.some((prefix) => file.startsWith(prefix))) {
        throw new Error('EACCES: sandbox denies this path')
      }
      files.set(file, text)
    },
  })

  const ctx = {
    tools: { register: (def) => tools.push(def) },
    get: (name) => (name === 'sandboxPolicy' && workspaceRoot !== null ? { workspaceRoot } : undefined),
    logger: { warn: () => {} },
    on: () => {},
  }
  return { ctx, tools, files }
}

test('emotion_sense 注册成功，schema 含生理层与惯性层', () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  assert.equal(tools.length, 1)
  const tool = tools[0]
  assert.equal(tool.name, 'emotion_sense')
  const props = tool.output.schema.properties
  assert.ok(props.vitals, 'schema 应有 vitals')
  assert.ok(props.inertia, 'schema 应有 inertia')
  assert.ok(props.memory, 'schema 应有 memory')
})

/**
 * 这条测试是补出来的教训。
 *
 * 真实事故：往 execute 的返回值里加了 `secondary`（混合情绪的次情绪），
 * 却忘了在 output.schema.properties 里声明它。schema 是
 * `additionalProperties: false`——于是工具每次调用都被判为「输出不合法」，
 * 整个 emotion_sense 直接罢工。而当时 180 项测试全绿，因为没有任何一条
 * 检查过「返回的字段」和「声明的字段」是不是同一套。
 */
test('输出字段必须全部在 schema 里声明（多一个就会被拒）', async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  const tool = tools[0]
  const declared = new Set(Object.keys(tool.output.schema.properties))

  // 用一句能触发混合情绪的话，尽量让可选字段都有值
  const value = await tool.execute({ message: '真是气笑了，那个 bug 还没修' }, { agent: { id: 'agent-shape' } })

  const extra = Object.keys(value).filter((k) => !declared.has(k))
  assert.deepEqual(
    extra,
    [],
    `这些字段没在 output.schema.properties 里声明，工具会被判为输出不合法：${extra.join('、')}`,
  )
  // 反向：每个返回的 key 都得是可序列化的基本类型，别塞对象进 schema 说 string 的位置
  for (const [k, v] of Object.entries(value)) {
    assert.ok(
      v === null || ['string', 'number', 'boolean'].includes(typeof v),
      `${k} 的类型是 ${typeof v}，schema 只声明了基本类型`,
    )
  }
})

test('inject 声明了记忆落盘所需的全部服务', () => {
  assert.ok(inject.includes('tools'), 'inject 应含 tools')
  // 少了它，ctx.get('sandboxPolicy') 会抛错 → 记忆定位失败 → 永不落盘。
  assert.ok(inject.includes('sandboxPolicy'), 'inject 应含 sandboxPolicy')
  // 记忆改走 node:fs/promises 直写之后不再需要 ctx.fs；多声明会让人误以为它还有用，
  // 而「inject 必须与实际用到的服务严格对齐」是这个模块用血换来的教训。
  assert.ok(!inject.includes('fs'), 'inject 不该再声明 fs')
})

test('一轮对话：六层文本 + 身体事实，且记忆按 v2 落库到 DSH home', async () => {
  const { ctx, tools, files } = makeCtx()
  apply(ctx)
  const tool = tools[0]
  const exec = { agent: { id: 'agent-1' } }

  const value = await tool.execute({ message: '叫我阿伟，我是做嵌入式的' }, exec)

  assert.ok(value.explicit, '应有显性情绪标签')
  assert.ok(value.vitals, '应有身体事实')
  assert.ok(value.memory, '应有记忆摘要')

  const rendered = tool.output.render({}, value)[0].text
  assert.match(rendered, /【感知】/)
  assert.match(rendered, /【状态】/)
  assert.match(rendered, /【身体】/)
  assert.match(rendered, /【记忆】/)

  const written = files.get(HOME_MEMORY)
  assert.ok(written, '应写到 DSH home（首选落点）')
  const mem = JSON.parse(written)
  assert.equal(mem.version, '2.0.0', '必须写 v2')
  assert.ok(mem.claims.some((c) => c.predicate === 'name'), '称呼应作为 claim 落库')
  assert.ok(mem.episodes.length >= 1, '应记录 episode')
  assert.ok(mem.runtimeState.stage, '应推进关系阶段')
  assert.ok(mem.lastIngest, '应记录本轮写入管线的结果')
})

test('持久化状态会写进摘要，且内部字段不落进文件', async () => {
  const { ctx, tools, files } = makeCtx()
  apply(ctx)
  const value = await tools[0].execute({ message: '你好' }, { agent: { id: 'agent-badge' } })

  assert.match(value.memory, /持久化 ✓/, '摘要应报告持久化成功')
  const mem = JSON.parse(files.get(HOME_MEMORY))
  assert.equal(mem.__location, undefined, '__location 是运行时句柄，不该落盘')
  assert.equal(mem.__persist, undefined, '__persist 是运行时状态，不该落盘')
})

test('DSH home 写不进时退回工作区根（沙箱只放行工作区）', async () => {
  const { ctx, tools, files } = makeCtx({ denyWrite: ['C:/fake-home'] })
  apply(ctx)
  const value = await tools[0].execute({ message: '在吗' }, { agent: { id: 'agent-ws' } })

  assert.ok(files.has(WORKSPACE_MEMORY), '应退回工作区根落盘')
  assert.ok(!files.has(HOME_MEMORY), 'home 被拒时不该留下半截文件')
  assert.match(value.memory, /持久化 ✓/)
})

test('跨会话：重启后从磁盘读回记忆（露娜真的记得主人）', async () => {
  const first = makeCtx()
  apply(first.ctx)
  await first.tools[0].execute({ message: '叫我阿伟，我是做嵌入式的' }, { agent: { id: 'agent-old' } })
  const onDisk = first.files.get(HOME_MEMORY)
  assert.ok(onDisk, '第一轮应落盘')

  // 模拟进程重启：磁盘文件还在，模块级缓存清空。
  __resetHeartMemory()
  const second = makeCtx()
  second.files.set(HOME_MEMORY, onDisk)
  apply(second.ctx)
  const value = await second.tools[0].execute({ message: '在吗' }, { agent: { id: 'agent-new' } })

  assert.match(value.memory, /阿伟/, '重启后应记得主人自称阿伟')
  // 摘要只展示部分字段，所以到磁盘上查 claim 全量。
  const reloaded = JSON.parse(second.files.get(HOME_MEMORY))
  assert.ok(
    reloaded.claims.some((c) => c.predicate === 'occupation' && String(c.value).includes('嵌入式')),
    '重启后应记得主人的行当',
  )
})

test('旧档在工作区根时会被搬到 DSH home（且不删旧数据）', async () => {
  // 第一程：home 写不进 → 记忆落到工作区根。
  const first = makeCtx({ denyWrite: ['C:/fake-home'] })
  apply(first.ctx)
  await first.tools[0].execute({ message: '叫我阿伟' }, { agent: { id: 'agent-move-1' } })
  const legacyText = first.files.get(WORKSPACE_MEMORY)
  assert.ok(legacyText, '先在工作区根落档')

  // 第二程：home 可写了 → 读旧档、写新档。
  __resetHeartMemory()
  const second = makeCtx()
  second.files.set(WORKSPACE_MEMORY, legacyText)
  apply(second.ctx)
  const value = await second.tools[0].execute({ message: '在吗' }, { agent: { id: 'agent-move-2' } })

  assert.match(value.memory, /阿伟/, '搬家途中不能丢记忆')
  assert.ok(second.files.has(HOME_MEMORY), '应写进 DSH home')
  assert.ok(second.files.has(WORKSPACE_MEMORY), '旧档保留，不删数据')
})

test('睡眠整合按节拍触发（每 20 轮老化 + 合并一次）', async () => {
  const { ctx, tools, files } = makeCtx()
  apply(ctx)
  const tool = tools[0]
  const exec = { agent: { id: 'agent-sleep' } }

  for (let i = 1; i <= 19; i += 1) await tool.execute({ message: `第 ${i} 轮` }, exec)
  assert.equal(JSON.parse(files.get(HOME_MEMORY)).lastSleep, undefined, '19 轮还不该整合')

  await tool.execute({ message: '第 20 轮' }, exec)
  const mem = JSON.parse(files.get(HOME_MEMORY))
  assert.ok(mem.lastSleep, '第 20 轮应触发睡眠整合')
  assert.equal(mem.lastSleep.turns, 20)
})

test('第二轮状态延续（生理层与惯性层跨轮，不是每轮重置）', async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  const tool = tools[0]
  const exec = { agent: { id: 'agent-2' } }

  const first = await tool.execute({ message: '你好呀' }, exec)
  const second = await tool.execute({ message: '今天天气不错' }, exec)

  assert.ok(second.vitals, '第二轮也应有身体事实')
  assert.ok(typeof second.energy === 'number')
  assert.ok(typeof second.tension === 'number')
  assert.notEqual(second.memory, undefined)
  assert.notEqual(first.style, undefined)
})

test('旧版 v1 记忆文件会被自动迁移并覆盖成 v2', async () => {
  const { ctx, tools, files } = makeCtx()
  const legacy = {
    version: 1,
    profile: { nickname: '老王', preferences: ['早睡'], observations: [] },
    relationship: { stage: '熟客', closeness: 30 },
    experiences: [{ date: '2026-09-01', topic: '聊过备份', emotion: '开心' }],
  }
  files.set(HOME_MEMORY, JSON.stringify(legacy))
  apply(ctx)
  const tool = tools[0]

  const value = await tool.execute({ message: '在吗' }, { agent: { id: 'agent-3' } })
  assert.match(value.memory, /老王/, '迁移后的称呼应出现在摘要里')
  assert.match(value.memory, /已从 v1 迁移/, '摘要应标出迁移')

  const after = JSON.parse(files.get(HOME_MEMORY))
  assert.equal(after.version, '2.0.0')
  assert.ok(after.claims.some((c) => c.predicate === 'name' && c.value === '老王'))
})

test('编造的内容进不了记忆（门控在引擎里生效）', async () => {
  const { ctx, tools, files } = makeCtx()
  apply(ctx)
  const tool = tools[0]

  await tool.execute({ message: '今天天气不错' }, { agent: { id: 'agent-4' } })
  const mem = JSON.parse(files.get(HOME_MEMORY))
  assert.equal(mem.claims.length, 0, '没有明说的字段不该凭空产生 claim')
})
