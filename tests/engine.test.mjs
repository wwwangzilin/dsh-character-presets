// 引擎级集成测试：真的 apply 一次，跑一轮对话，看记忆有没有按 v2 落库、能不能跨会话读回。
//
//   node --test tests/engine.test.mjs
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { apply, __resetHeartMemory, inject } from '../luna-soul.mjs'

// 记忆缓存在模块级（真实运行时的有意设计），测试之间必须显式隔离。
beforeEach(() => { __resetHeartMemory() })

/** 记忆文件落点：工作区根优先（沙箱内唯一稳可写的位置）。 */
const WORKSPACE_MEMORY = 'D:/fake-workspace/.luna-heart.json'

/**
 * 最小 ctx 替身：只要 tools.register / fs / get / logger。
 *
 * 替身必须跟真机一致 —— 这是踩过的坑：早期版本这里给 `ctx.get('dshHome')` 编了一个
 * 返回值，可真实环境里 **dshHome 根本不是 cordis 服务**，于是生产代码里那条候选永远
 * 抛错、被 catch 吞掉，记忆一次都没落过盘，而测试全程绿灯。现在只提供真实存在的
 * `sandboxPolicy`；`workspaceRoot: null` 用来模拟「拿不到工作区根」的场景。
 */
function makeCtx(options = {}) {
  const tools = []
  const files = new Map()
  const workspaceRoot = options.workspaceRoot === undefined ? 'D:/fake-workspace' : options.workspaceRoot
  const ctx = {
    tools: { register: (def) => tools.push(def) },
    fs: {
      resolve: async (raw) => ({ path: raw }),
      readText: async (target) => {
        if (!files.has(target.path)) throw new Error('ENOENT')
        return files.get(target.path)
      },
      writeText: async (target, text) => { files.set(target.path, text) },
    },
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

test('inject 声明了记忆落盘所需的全部服务', () => {
  assert.ok(inject.includes('tools'), 'inject 应含 tools')
  assert.ok(inject.includes('fs'), 'inject 应含 fs')
  // 少了它，ctx.get('sandboxPolicy') 会抛错 → 记忆定位失败 → 永不落盘。
  assert.ok(inject.includes('sandboxPolicy'), 'inject 应含 sandboxPolicy')
})

test('一轮对话：六层文本 + 身体事实，且记忆按 v2 落库', async () => {
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

  const written = files.get(WORKSPACE_MEMORY)
  assert.ok(written, '应写出记忆文件')
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
  const mem = JSON.parse(files.get(WORKSPACE_MEMORY))
  assert.equal(mem.__location, undefined, '__location 是运行时句柄，不该落盘')
  assert.equal(mem.__persist, undefined, '__persist 是运行时状态，不该落盘')
})

test('拿不到工作区根时退回 DSH_HOME，仍然落盘', async () => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = 'C:/fake-home/.dsh'
  try {
    const { ctx, tools, files } = makeCtx({ workspaceRoot: null })
    apply(ctx)
    const value = await tools[0].execute({ message: '在吗' }, { agent: { id: 'agent-home' } })
    assert.ok(files.has('C:/fake-home/.dsh/.luna-heart.json'), '应退回 DSH_HOME 落盘')
    assert.match(value.memory, /持久化 ✓/)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('跨会话：重启后从磁盘读回记忆（露娜真的记得主人）', async () => {
  const first = makeCtx()
  apply(first.ctx)
  await first.tools[0].execute({ message: '叫我阿伟，我是做嵌入式的' }, { agent: { id: 'agent-old' } })
  const onDisk = first.files.get(WORKSPACE_MEMORY)
  assert.ok(onDisk, '第一轮应落盘')

  // 模拟进程重启：磁盘文件还在，模块级缓存清空。
  __resetHeartMemory()
  const second = makeCtx()
  second.files.set(WORKSPACE_MEMORY, onDisk)
  apply(second.ctx)
  const value = await second.tools[0].execute({ message: '在吗' }, { agent: { id: 'agent-new' } })

  assert.match(value.memory, /阿伟/, '重启后应记得主人自称阿伟')
  // 摘要只展示部分字段，所以到磁盘上查 claim 全量。
  const reloaded = JSON.parse(second.files.get(WORKSPACE_MEMORY))
  assert.ok(
    reloaded.claims.some((c) => c.predicate === 'occupation' && String(c.value).includes('嵌入式')),
    '重启后应记得主人的行当',
  )
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
  files.set(WORKSPACE_MEMORY, JSON.stringify(legacy))
  apply(ctx)
  const tool = tools[0]

  const value = await tool.execute({ message: '在吗' }, { agent: { id: 'agent-3' } })
  assert.match(value.memory, /老王/, '迁移后的称呼应出现在摘要里')
  assert.match(value.memory, /已从 v1 迁移/, '摘要应标出迁移')

  const after = JSON.parse(files.get(WORKSPACE_MEMORY))
  assert.equal(after.version, '2.0.0')
  assert.ok(after.claims.some((c) => c.predicate === 'name' && c.value === '老王'))
})

test('编造的内容进不了记忆（门控在引擎里生效）', async () => {
  const { ctx, tools, files } = makeCtx()
  apply(ctx)
  const tool = tools[0]

  await tool.execute({ message: '今天天气不错' }, { agent: { id: 'agent-4' } })
  const mem = JSON.parse(files.get(WORKSPACE_MEMORY))
  assert.equal(mem.claims.length, 0, '没有明说的字段不该凭空产生 claim')
})
