#!/usr/bin/env node
/**
 * install-character.mjs —— 把 characters/<id>/ 里的角色装成一个 DSH agent preset。
 *
 *   node scripts/install-character.mjs list              # 看有哪些角色
 *   node scripts/install-character.mjs install <id>       # 装到 ~/.dsh/.agent-presets/<id>
 *   node scripts/install-character.mjs install --all      # 全装
 *   node scripts/install-character.mjs card <id>          # 生成 cards/<id>.card.json（chara_card_v2）
 *
 * 设计要点：**引擎与角色解耦**。引擎模块（luna-*.mjs）原样复制，角色差异全部落在
 * persona 文本、preset.yml 元信息与角色卡里 —— 所以加角色永远不需要改引擎。
 */
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CHARACTERS_DIR = join(ROOT, 'characters')
const CARDS_DIR = join(ROOT, 'cards')

/** 被复制的引擎模块（与角色无关，原样搬运）。 */
const ENGINE_FILES = [
  'luna-soul.mjs', 'luna-memory.mjs', 'luna-gate.mjs',
  'luna-recall.mjs', 'luna-forget.mjs', 'luna-vitals.mjs', 'luna-inertia.mjs',
]

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))
const say = (msg) => console.log(msg)

async function loadCatalog() {
  return readJson(join(CHARACTERS_DIR, 'characters.json'))
}

/** 找一个 id 的元数据；找不到就列出可选项后退出。 */
async function requireMeta(id) {
  const catalog = await loadCatalog()
  const meta = catalog.characters.find((c) => c.id === id)
  if (meta === undefined) {
    say(`未知角色：${id}\n可用：${catalog.characters.map((c) => c.id).join(', ')}`)
    process.exit(1)
  }
  return meta
}

/**
 * 把 agent.cordis.yml 里的 `prefix: |-` 块整段换成新的 persona。
 * 只动那一段 —— 其余（工具、shell、emotion 插件挂载等）原样保留。
 */
export function replacePersonaPrefix(yaml, personaText) {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((line) => /^\s+prefix:\s*\|-?\s*$/.test(line))
  if (start === -1) throw new Error('agent.cordis.yml 里找不到 `prefix: |-` 段')
  const baseIndent = (lines[start].match(/^\s*/) ?? [''])[0]
  const bodyIndent = `${baseIndent}  `
  let end = start + 1
  while (end < lines.length && (lines[end].trim() === '' || lines[end].startsWith(bodyIndent))) end += 1
  const block = personaText.trimEnd().split(/\r?\n/).map((line) => (line.trim() === '' ? '' : bodyIndent + line))
  return [...lines.slice(0, start + 1), ...block, ...lines.slice(end)].join('\n')
}

/** 从 persona 文本里抠出一段（【身份】到下一个【】之前）。 */
function section(personaText, name) {
  const re = new RegExp(`【${name}】([\\s\\S]*?)(?=\\n【|$)`)
  const m = re.exec(personaText)
  return m === null ? '' : m[1].trim()
}

/** 由 persona + 元数据生成 chara_card_v2。 */
export function buildCard(meta, personaText) {
  const identity = section(personaText, '身份')
  const persona = section(personaText, '人设')
  const behaviours = section(personaText, '行为模式')
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: meta.displayName,
      description: `${meta.tagline}。\n\n${identity}\n\n⚠️ 本卡片只是人设精简版：**不含** luna-soul.mjs 六层情感引擎与 DSH 工具链。完整角色请用 DSH + dsh-luna-preset。`,
      personality: `${persona}\n\n行为模式：\n${behaviours}`,
      scenario: `你在用户的工作目录里陪着他。日常按上面的人设相处；一旦他进入正经工作（编码 / 调试 / 部署 / 写文档），自动收敛成可靠的技术搭档。`,
      first_mes: `（${meta.tagline}）\n\n……嗯，我在这里。有什么要做的？`,
      mes_example: meta.catchphrases.map((line) => `<START>\n{{char}}: ${line}`).join('\n\n'),
      creator_notes: `源于 DeepSeek Harness 的 agent preset「${meta.presetName}」。\n本卡片为精简人设版，供 SillyTavern / RisuAI 等前端使用；完整版（六层情感引擎）见 https://github.com/wwwangzilin/dsh-luna-preset`,
      system_prompt: `你现在的完整人设如下，请严格保持：\n\n${personaText.trim()}`,
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [...meta.tags, '中文'],
      creator: 'wwwangzilin',
      character_version: '1.0.0',
      extensions: {
        'dsh-luna-preset': {
          homepage: 'https://github.com/wwwangzilin/dsh-luna-preset',
          character_id: meta.id,
          accent: meta.accent,
          full_engine: 'luna-soul.mjs（六层情感引擎，仅 DSH 预设提供）',
          card_scope: 'persona + examples only',
        },
      },
    },
  }
}

/** 找引擎模块的来源目录：优先本机已装的 luna preset，其次仓库根。 */
function engineSource(homeDir) {
  const installed = join(homeDir, '.agent-presets', 'luna')
  if (existsSync(join(installed, 'luna-soul.mjs'))) return installed
  if (existsSync(join(ROOT, 'luna-soul.mjs'))) return ROOT
  throw new Error('找不到引擎模块：请先安装 luna preset，或在仓库根执行')
}

async function install(id, homeDir) {
  const meta = await requireMeta(id)
  const personaText = await readFile(join(CHARACTERS_DIR, id, 'persona.md'), 'utf8')
  const source = engineSource(homeDir)
  const target = join(homeDir, '.agent-presets', id)
  await mkdir(target, { recursive: true })

  // 1. 引擎模块原样复制（角色差异不体现在引擎里）。
  for (const file of ENGINE_FILES) {
    await cp(join(source, file), join(target, file)).catch(() => {})
  }

  // 2. agent.cordis.yml：照抄 luna 的，只把 persona 那一段换掉。
  const baseYml = join(source, 'agent.cordis.yml')
  if (existsSync(baseYml)) {
    const yaml = await readFile(baseYml, 'utf8')
    await writeFile(join(target, 'agent.cordis.yml'), replacePersonaPrefix(yaml, personaText), 'utf8')
  } else {
    throw new Error(`缺少模板 ${baseYml} —— 先装好 luna preset 再装角色`)
  }

  // 3. preset.yml：选择器里显示的名字与描述。
  const presetYml = `name: ${meta.presetName}\ndescription: ${meta.description}\n`
  await writeFile(join(target, 'preset.yml'), presetYml, 'utf8')

  // 4. 顺带把角色卡写进仓库 cards/（前端与 GAL 共用同一份）。
  await mkdir(CARDS_DIR, { recursive: true })
  const cardPath = join(CARDS_DIR, `${id}.card.json`)
  await writeFile(cardPath, `${JSON.stringify(buildCard(meta, personaText), null, 2)}\n`, 'utf8')

  say(`[ok] ${meta.displayName} → ${target}`)
  say(`     引擎: ${source}`)
  say(`     角色卡: ${cardPath}`)
}

async function main() {
  const [command, arg] = process.argv.slice(2)
  const homeDir = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : homedir()

  if (command === 'list' || command === undefined) {
    const catalog = await loadCatalog()
    say('可用角色：')
    for (const c of catalog.characters) say(`  ${c.id.padEnd(10)} ${c.displayName}　${c.tagline}`)
    say('\n用法：node scripts/install-character.mjs install <id> | install --all | card <id>')
    return
  }

  if (command === 'install') {
    const catalog = await loadCatalog()
    const ids = arg === '--all' ? catalog.characters.map((c) => c.id) : [arg]
    if (!arg) { say('用法：install <id> 或 install --all'); process.exit(1) }
    for (const id of ids) await install(id, homeDir)
    say('\n装完记得重启 DSH，新角色才会出现在选择器里。')
    return
  }

  if (command === 'card') {
    const meta = await requireMeta(arg)
    const personaText = await readFile(join(CHARACTERS_DIR, arg, 'persona.md'), 'utf8')
    await mkdir(CARDS_DIR, { recursive: true })
    const cardPath = join(CARDS_DIR, `${arg}.card.json`)
    await writeFile(cardPath, `${JSON.stringify(buildCard(meta, personaText), null, 2)}\n`, 'utf8')
    say(`[ok] ${cardPath}`)
    return
  }

  const files = await readdir(CHARACTERS_DIR).catch(() => [])
  say(`未知命令：${command}\n角色目录：${files.filter((f) => f !== 'README.md' && f !== 'characters.json').join(', ')}`)
  process.exit(1)
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`)
  process.exit(1)
})
