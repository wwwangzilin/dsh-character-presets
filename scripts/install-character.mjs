import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 被复制的引擎模块：露娜的六层情感引擎 + 记忆系统，与角色无关，原样搬运。 */
const ENGINE_FILES = [
  'luna-soul.mjs', 'luna-emotion.mjs', 'luna-vitals.mjs', 'luna-inertia.mjs',
  'luna-mode.mjs', 'luna-offline.mjs', 'luna-loops.mjs', 'luna-siblings.mjs',
  'luna-memory.mjs', 'luna-gate.mjs', 'luna-recall.mjs', 'luna-forget.mjs',
]

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))
const say = (msg) => console.log(msg)

async function loadCatalog() {
  return readJson(join(ROOT, 'characters', 'characters.json'))
}

async function requireMeta(id) {
  if (id === undefined) {
    const catalog = await loadCatalog()
    say(`缺少角色 id。\n可用：${catalog.characters.map((c) => c.id).join(', ')}`)
    process.exit(1)
  }
  const catalog = await loadCatalog()
  const meta = catalog.characters.find((c) => c.id === id)
  if (meta === undefined) {
    say(`未知角色：${id}\n可用：${catalog.characters.map((c) => c.id).join(', ')}`)
    process.exit(1)
  }
  return meta
}

/** 可选：多角色合集（extras）带过来的引擎模块，原样覆盖。 */
async function engineSource(sourceDir) {
  if (sourceDir === undefined) return null
  const dir = resolve(sourceDir)
  if (!existsSync(join(dir, 'luna-soul.mjs'))) {
    say(`--engine 指向的目录里没有 luna-soul.mjs：${dir}`)
    process.exit(1)
  }
  return dir
}

/** 把生成出来的插件包拷到 --out（默认就在 dist/<id>，不拷）。 */
async function copyOut(from, out) {
  const to = resolve(out)
  if (to === from) return to
  await rm(to, { recursive: true, force: true })
  await cp(from, to, { recursive: true })
  return to
}

/**
 * 把 agent.cordis.yml 里 `prefix: |-` 整段换成新角色的人设。只动那一段——
 * 工具面、引擎挂载等全部原样保留，所以加角色永远不用碰工具配置。
 */
export function replacePersonaPrefix(yaml, personaText) {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((line) => /^\s+prefix:\s*\|-?\s*$/.test(line))
  if (start === -1) throw new Error('agent.cordis.yml 里找不到 `prefix: |-` 段')
  const baseIndent = (lines[start].match(/^\s*/) ?? [''])[0]
  const bodyIndent = `${baseIndent}  `
  let end = start + 1
  while (end < lines.length && (lines[end].trim() === '' || lines[end].startsWith(bodyIndent))) end += 1
  const block = personaText
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => (line.trim() === '' ? '' : bodyIndent + line))
  return [...lines.slice(0, start + 1), ...block, ...lines.slice(end)].join('\n')
}

/** 换掉 persona 之后，把同一层里紧跟其后的其它配置键（如 emotion 段）留在原处。 */
function setPresetMeta(meta, patchYaml) {
  const id = meta.id
  const name = meta.presetName ?? meta.displayName ?? id
  const description = meta.description ?? meta.tagline ?? ''
  const escaped = description.replace(/'/g, "''")
  return patchYaml
    .replace(/(- id: preset-)[\w-]+/, `$1${id}`)
    .replace(/^(\s+)id: (?!preset)[\w-]+$/m, `$1id: ${id}`)
    .replace(/^(\s+)name: 露娜模式$/m, `$1name: ${name}`)
    .replace(/^(\s+)description: '.*'$/m, `$1description: '${escaped}'`)
}

async function install(id, outDir, engineDir) {
  const meta = await requireMeta(id)
  const personaText = await readFile(join(ROOT, 'characters', id, 'persona.md'), 'utf8')
  const target = join(ROOT, 'dist', id)
  const engine = await engineSource(engineDir)

  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })

  for (const file of ENGINE_FILES) {
    await cp(join(ROOT, file), join(target, file))
  }
  if (engine !== null) {
    for (const file of await readdir(engine)) {
      if (/^luna-.*\.mjs$/.test(file)) await cp(join(engine, file), join(target, file))
    }
  }

  const yaml = await readFile(join(ROOT, 'agent.cordis.yml'), 'utf8')
  await writeFile(join(target, 'agent.cordis.yml'), replacePersonaPrefix(yaml, personaText), 'utf8')

  // 角色包自己的清单与补丁：与仓库根同一套生成物，只是人设和元信息换了。
  const pkg = await readJson(join(ROOT, 'package.json'))
  pkg.name = `dsh-character-preset-${id}`
  delete pkg.repository
  delete pkg.bin
  pkg.files = [
    'agent.cordis.yml', 'cordis.patch.yml', ...ENGINE_FILES,
    'cards/', 'characters/', 'persona/', 'rules/', 'NOTICE',
  ]
  pkg.dsh.preset = {
    id,
    name: meta.presetName ?? meta.displayName,
    description: meta.description ?? meta.tagline,
    order: (pkg.dsh.preset.order ?? 2) + 1,
  }
  delete pkg.scripts.build

  const patch = setPresetMeta(
    meta,
    await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8'),
  )
  await writeFile(join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  await writeFile(join(target, 'cordis.patch.yml'), patch, 'utf8')

  say(`[ok] ${meta.displayName} → ${outDir === undefined ? target : await copyOut(target, outDir)}`)
  say(`     下一步：dsh plugin add <上面那个目录>`)
  return target
}

async function main() {
  const [command, arg] = process.argv.slice(2)
  const flag = (name) => {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? undefined : process.argv[i + 1]
  }

  if (command === 'list' || command === undefined) {
    const catalog = await loadCatalog()
    say('可用角色：')
    for (const c of catalog.characters) say(`  ${c.id.padEnd(10)} ${c.displayName}　${c.tagline}`)
    say('\n用法：node scripts/install-character.mjs build <id> [--out <dir>]')
    say('其余角色：git checkout extras && node scripts/install-character.mjs list')
    return
  }

  if (command === 'build') {
    await install(arg, flag('out'), flag('engine'))
    return
  }

  say(`未知命令：${command}`)
  say('用法：node scripts/install-character.mjs list | build <id> [--out <dir>] [--engine <extras仓库>]')
  process.exit(1)
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`)
  process.exit(1)
})
