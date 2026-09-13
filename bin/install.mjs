#!/usr/bin/env node
// 露娜模式 · npx 安装入口
//
//   npx github:wwwangzilin/dsh-character-presets
//   npx github:wwwangzilin/dsh-character-presets --ref dev --dir /custom/presets
//
// 跨平台（Windows / macOS / Linux），只依赖 git 与 node。
// 逻辑与 install.sh / install.ps1 一致：装到 <presets>/luna，已存在则更新。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

const REPO = process.env.LUNA_REPO || 'https://github.com/wwwangzilin/dsh-character-presets.git'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const ref = arg('ref', process.env.LUNA_REF || 'main')
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const presetsDir =
  arg('dir', null) || process.env.DSH_PRESETS_DIR || join(dshHome, '.agent-presets')
const target = join(presetsDir, 'luna')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`)
  return r.status ?? 1
}

function git(args, opts) {
  return run('git', args, opts)
}

console.log('露娜模式 · 安装')
console.log(`  源仓库 : ${REPO} (${ref})`)
console.log(`  安装到 : ${target}`)

if (git(['--version'], { stdio: 'ignore' }) !== 0) {
  console.error('✗ 未找到 git，请先安装 git')
  process.exit(1)
}

if (existsSync(target) && !existsSync(join(target, '.git'))) {
  console.error(`✗ ${target} 已存在且不是 git 仓库 —— 请先移走它，或用 --dir 指定别处`)
  process.exit(1)
}

mkdirSync(presetsDir, { recursive: true })

if (existsSync(join(target, '.git'))) {
  console.log('  → 已安装过，执行更新')
  git(['-C', target, 'fetch', '--depth', '1', 'origin', ref])
  git(['-C', target, 'checkout', '-q', ref])
  git(['-C', target, 'pull', '--ff-only', 'origin', ref])
} else {
  if (git(['clone', '--depth', '1', '--branch', ref, REPO, target]) !== 0) {
    console.error('✗ git clone 失败')
    process.exit(1)
  }
}

if (basename(target) !== 'luna') {
  console.error(`✗ 目录名必须是 luna（当前：${basename(target)}）`)
  process.exit(1)
}
for (const f of ['preset.yml', 'agent.cordis.yml', 'luna-soul.mjs']) {
  if (!existsSync(join(target, f))) {
    console.error(`✗ 安装不完整：缺少 ${f}`)
    process.exit(1)
  }
}

console.log(`
✅ 露娜已就位（${target}）

下一步：
  1. 重启 DSH
  2. 新建会话 → preset 选择器里选「露娜模式」
     或「设置 → Agent 预设」把它设为默认

卸载：删掉该目录即可；她的记忆文件 .luna-heart.json 在工作区或 $DSH_HOME 下。
`)
