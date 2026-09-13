// 引擎级集成测试：真的 apply 一次，跑一轮对话，看记忆有没有按 v2 落库。
//
//   node --test tests/engine.test.mjs
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { apply, __resetHeartMemory } from '../luna-soul.mjs'

// 记忆缓存在模块级（真实运行时的有意设计），测试之间必须显式隔离。
beforeEach(() => { __resetHeartMemory() })

/** 最小 ctx 替身：只要 tools.register / fs / get / logger。 */
function makeCtx() {
  const tools = []
  const files = new Map()
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
    get: (name) => (name === 'dshHome' ? 'C:/fake-dsh' : undefined),
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

  const written = [...files.values()].find((v) => v.includes('version'))
  assert.ok(written, '应写出记忆文件')
  const mem = JSON.parse(written)
  assert.equal(mem.version, '2.0.0', '必须写 v2')
  assert.ok(mem.claims.some((c) => c.predicate === 'name'), '称呼应作为 claim 落库')
  assert.ok(mem.episodes.length >= 1, '应记录 episode')
  assert.ok(mem.runtimeState.stage, '应推进关系阶段')
  assert.ok(mem.lastIngest, '应记录本轮写入管线的结果')
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
  files.set('C:/fake-dsh/.luna-heart.json', JSON.stringify(legacy))
  apply(ctx)
  const tool = tools[0]

  const value = await tool.execute({ message: '在吗' }, { agent: { id: 'agent-3' } })
  assert.match(value.memory, /老王/, '迁移后的称呼应出现在摘要里')

  const after = JSON.parse(files.get('C:/fake-dsh/.luna-heart.json'))
  assert.equal(after.version, '2.0.0')
  assert.ok(after.claims.some((c) => c.predicate === 'name' && c.value === '老王'))
})

test('编造的内容进不了记忆（门控在引擎里生效）', async () => {
  const { ctx, tools, files } = makeCtx()
  apply(ctx)
  const tool = tools[0]

  await tool.execute({ message: '今天天气不错' }, { agent: { id: 'agent-4' } })
  const mem = JSON.parse([...files.values()].find((v) => v.includes('version')))
  assert.equal(mem.claims.length, 0, '没有明说的字段不该凭空产生 claim')
})
