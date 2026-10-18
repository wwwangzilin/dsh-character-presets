#!/usr/bin/env node
// 露娜模式 · 安装入口
//
//   npx github:wwwangzilin/dsh-character-presets
//   npx github:wwwangzilin/dsh-character-presets --ref extras --out D:/my-luna
//
// 跨平台（Windows / macOS / Linux），只依赖 git 与 node。
//
// DSH 0.2 起不再扫描 `<dshHome>/.agent-presets/<id>/`：agent preset 现在是一条
// bundle patch 里的 `@deepseek-ai/dsh-agent-preset` 行。所以这里做的事是把仓库里
// 的插件包（package.json + cordis.patch.yml + 引擎模块）取到本地目录，再交给官方的
// `dsh plugin add <dir>` 安装——不做任何手写的 profile 改动。

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, cp, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const REPO = process.env.DSH_PRESET_REPO || 'https://github.com/wwwangzilin/dsh-character-presets.git'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const ref = arg('ref', process.env.DSH_PRESET_REF || 'main')
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const target = resolve(arg('out', process.env.DSH_PRESET_DIR || join(dshHome, 'presets', 'luna')))
const skipInstall = process.argv.includes('--no-install')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`)
  return r.status ?? 1
}

console.log('露娜模式 · 安装')
console.log(`  源仓库 : ${REPO} (${ref})`)
console.log(`  安装到 : ${target}`)

if (run('git', ['--version'], { stdio: 'ignore' }) !== 0) {
  console.error('✗ 未找到 git，请先安装 git')
  process.exit(1)
}

// 先浅克隆到临时目录，再把插件包拷出来：目标目录必须是干净的包目录，
// 不能带 .git（`dsh plugin add` 装的是目录本身）。
const tmp = await mkdtemp(join(tmpdir(), 'dsh-preset-'))
const clone = join(tmp, 'repo')
if (run('git', ['clone', '--depth', '1', '--branch', ref, REPO, clone]) !== 0) {
  console.error('✗ git clone 失败')
  process.exit(1)
}

const pkgPath = join(clone, 'package.json')
if (!existsSync(pkgPath)) {
  console.error(`✗ 仓库里没有 package.json：${pkgPath}`)
  process.exit(1)
}
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
if (pkg.dsh?.bundle?.patch === undefined) {
  console.error(`✗ ${ref} 分支还不是可安装的插件包（package.json 缺 dsh.bundle）`)
  process.exit(1)
}

await mkdir(dirname(target), { recursive: true })
await cp(clone, target, { recursive: true, filter: (src) => basename(src) !== '.git' })

console.log(`
✅ 插件包已就位：${target}
   preset：${pkg.dsh?.preset?.name ?? pkg.dsh?.preset?.id ?? 'luna'}`)

if (skipInstall) {
  console.log(`\n下一步：dsh plugin add ${target}`)
  process.exit(0)
}

console.log('\n正在通过官方 CLI 安装到当前 profile…')
if (run('dsh', ['plugin', 'add', target]) !== 0) {
  console.error(`✗ \`dsh plugin add\` 失败 —— 检查 dsh 是否在 PATH，或手动执行：\n   dsh plugin add ${target}`)
  process.exit(1)
}

console.log(`
✅ 完成

下一步：
  1. 重启 DSH
  2. 新建会话 → preset 选择器里选「${pkg.dsh.preset.name}」
     或「设置 → Agent 预设」把它设为默认

记忆文件：$DSH_HOME/.luna-heart.json（删除即重置关系）
`)
