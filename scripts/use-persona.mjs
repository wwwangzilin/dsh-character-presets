#!/usr/bin/env node
// 露娜模式 · persona 语言切换
//
//   node scripts/use-persona.mjs          # 列出可用语言
//   node scripts/use-persona.mjs zh       # 把 persona/zh.md 注入 agent.cordis.yml
//   node scripts/use-persona.mjs ja --dry-run
//
// 做法：persona/<lang>.md 是唯一事实源；本脚本把它整段替换进
// agent.cordis.yml 里 `- id: persona` 的 `text: |-` 块，并保持原有缩进。
// 替换前会写一份 .bak-persona-<lang> 备份。

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AGENT = join(ROOT, 'agent.cordis.yml')
const PERSONA_DIR = join(ROOT, 'persona')
// DSH 0.1.5 起 dsh-persona 的键名是 `prefix:`，0.1.0 用 `text:`；两种都认。
const ANCHOR_RE = /^\s*(?:text|prefix): \|-\s*$/

function listLangs() {
  if (!existsSync(PERSONA_DIR)) return []
  return readdirSync(PERSONA_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort()
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const lang = args.find((a) => !a.startsWith('--'))

const langs = listLangs()
if (!lang) {
  console.log('可用语言：' + (langs.length ? langs.join(', ') : '（persona/ 目录为空）'))
  console.log('用法：node scripts/use-persona.mjs <lang> [--dry-run]')
  process.exit(langs.length ? 0 : 1)
}

const personaPath = join(PERSONA_DIR, `${lang}.md`)
if (!existsSync(personaPath)) {
  console.error(`✗ 找不到 persona/${lang}.md（可用：${langs.join(', ') || '无'}）`)
  process.exit(1)
}

const persona = readFileSync(personaPath, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '')
const yml = readFileSync(AGENT, 'utf8').replace(/\r\n/g, '\n')
const lines = yml.split('\n')

const anchorAt = lines.findIndex((l) => ANCHOR_RE.test(l))
if (anchorAt === -1) {
  console.error('✗ 在 agent.cordis.yml 里找不到 `prefix: |-` 或 `text: |-`')
  process.exit(1)
}

// block indent = indent of the first non-empty line after the anchor
let base = null
let j = anchorAt + 1
while (j < lines.length) {
  if (lines[j].trim()) {
    base = lines[j].length - lines[j].trimStart().length
    break
  }
  j++
}
if (base === null) {
  console.error('✗ persona 块看起来是空的')
  process.exit(1)
}

// find the end of the block (first non-empty line with a smaller indent)
let end = anchorAt + 1
while (end < lines.length) {
  const line = lines[end]
  if (!line.trim()) {
    end++
    continue
  }
  const indent = line.length - line.trimStart().length
  if (indent < base) break
  end++
}
// trailing blank lines belong to the separator, not the block
let blockEnd = end
while (blockEnd - 1 > anchorAt && !lines[blockEnd - 1].trim()) blockEnd--

const pad = ' '.repeat(base)
const newBlock = persona.split('\n').map((l) => (l.trim() ? pad + l : ''))
const out = [
  ...lines.slice(0, anchorAt + 1),
  ...newBlock,
  ...lines.slice(blockEnd),
].join('\n')

if (out === yml) {
  console.log(`= agent.cordis.yml 已经是 ${lang}，无需改动`)
  process.exit(0)
}

console.log(`persona/${lang}.md -> agent.cordis.yml`)
console.log(`  块行数  : ${blockEnd - anchorAt - 1} -> ${newBlock.length}`)
console.log(`  缩进    : ${base} 空格`)

if (dryRun) {
  console.log('  --dry-run：未写入')
  process.exit(0)
}

const backup = `${AGENT}.bak-persona-${lang}`
copyFileSync(AGENT, backup)
writeFileSync(AGENT, out)
console.log(`  ✓ 已写入（备份：${backup.split(/[\\/]/).pop()}）`)
console.log('  重启 DSH 后生效；改回去就再跑一次别的语言。')
