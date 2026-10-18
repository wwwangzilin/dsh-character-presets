// bundle 校验：cordis.patch.yml 必须与 agent.cordis.yml + package.json 一致。
//
// 这个文件是**生成物**——手改会被下一次 sync-bundle 冲掉，而在 DSH 0.2 里
// 手改 `$DSH_HOME/.agent-presets/` 已经不再被读取。所以真正要守的是：生成物与源
// 始终同步，且清单（package.json）里声明的东西确实存在。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { build, bodyOf, render } from '../scripts/sync-bundle.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFile(join(ROOT, file), 'utf8')

test('cordis.patch.yml 与 agent.cordis.yml / package.json 同步', async () => {
  assert.equal(await read('cordis.patch.yml'), await build(ROOT))
})

test('正文缩进后仍是合法的列表续行（YAML 对缩进敏感）', async () => {
  const source = await read('agent.cordis.yml')
  const body = bodyOf(source)
  for (const line of body.split('\n')) {
    if (line.trim() === '') continue
    assert.ok(line.startsWith('        '), `正文行缩进不足：${line.slice(0, 40)}`)
  }
  // 每一条顶层插件行（- id: ...）都跟着一条同样缩进的 name:。
  const rows = body.split('\n').filter((line) => /^        - id: /.test(line))
  const names = body.split('\n').filter((line) => /^          name: /.test(line))
  assert.ok(rows.length > 10, `顶层插件行只有 ${rows.length} 条`)
  assert.ok(names.length >= rows.length, '有插件行没有 name')
})

test('preset 声明与清单一致', async () => {
  const meta = JSON.parse(await read('package.json'))
  const { id, name, description } = meta.dsh.preset
  const patch = await read('cordis.patch.yml')
  assert.ok(patch.includes(`- id: preset-${id}`))
  assert.ok(patch.includes('name: \'@deepseek-ai/dsh-agent-preset\''))
  assert.ok(patch.includes(`        id: ${id}\n`))
  assert.ok(patch.includes(`        name: ${name}\n`))
  assert.ok(patch.includes(description.replace(/'/g, "''")), 'description 没有原样带进补丁')
})

test('清单声明的文件与模块都在仓库里', async () => {
  const meta = JSON.parse(await read('package.json'))
  assert.equal(meta.dsh.bundle.patch, './cordis.patch.yml')
  for (const entry of meta.files) {
    // npm 会把目录也列进 files，这里只校验具体文件。
    if (entry.endsWith('/')) continue
    assert.ok(existsSync(join(ROOT, entry)), `package.json files 里有不存在的文件：${entry}`)
  }
  // 引擎模块：agent.cordis.yml 用相对路径引用，必须与它同目录。
  const source = await read('agent.cordis.yml')
  for (const match of source.matchAll(/name: '\.\/([\w.-]+)'/g)) {
    assert.ok(existsSync(join(ROOT, match[1])), `相对路径插件不存在：${match[1]}`)
  }
})

test('不再生成已废弃的 .agent-presets 目录式 preset', async () => {
  const source = await read('agent.cordis.yml')
  assert.ok(!/name:\s*preset\.yml/i.test(source))
  // render() 不接受没有 id 的元信息——缺字段要在生成时就炸，而不是装好后才炸。
  assert.throws(() => render({ dsh: { preset: { name: 'x', description: 'y' } } }, ''))
  assert.throws(() => render({ dsh: { preset: { name: 'x', description: '' } } }, ''))
})
