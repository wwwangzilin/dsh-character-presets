/**
 * `emotion_sense` — 六层情感引擎，供露娜模式（luna）的模型在回复前调用。
 *
 * 分层设计（运算全部在固定代码里完成，模型只拿到精简的情感指引）：
 *
 * 1. 感知层   — 显性情绪、隐性情绪（"没事"其实是事）、对话目标、关系阶段
 * 2. 理解层   — 需求推断（要发泄/要方案/要陪伴）+ 心理理论（此刻最不想听什么）
 * 3. 状态层   — AI 自身状态变量（能量/耐心/兴趣/紧张 + 心情），表达调节器
 * 4. 表达层   — 按心情与状态选风格档位（具体行为代替情感词、短句节奏、留白）
 * 5. 调节层   — 降火/陪伴/稳定/边界策略，AI 不被用户情绪带崩
 * 6. 记忆层   — 用户画像、共同经历、关系阶段，经 fs 持久化跨会话
 *
 * 标准 Cordis 插件：inject 声明依赖 tools/fs，apply 内 ctx.tools.register。
 * 不发布任何服务，无需 realm；preset 卸载时注册自动移除。
 */

/** Cordis plugin name used by loader diagnostics. */
import { deriveAndSmooth, describeVitals } from './luna-vitals.mjs'
import {
  regressToBaseline, applyAbsence, noteSharpness, notePraise, detectFocus, inertiaHint,
} from './luna-inertia.mjs'
import {
  createMemory, emptyMemory, stageFromMemory, summarize,
} from './luna-memory.mjs'
import { ingest } from './luna-gate.mjs'
import { retrieve, formatRecall } from './luna-recall.mjs'

export const name = 'tool-emotion'

/** 工具注册需要 tools 注册表；记忆层需要 fs 持久化。 */
export const inject = ['tools', 'fs']

/* ============================== 感知层 ============================== */

/** 显性情绪：关键词命中数加权，取最高分。 */
const EXPLICIT_RULES = [
  {
    label: '开心',
    keywords: ['开心', '高兴', '哈哈', '太好', '棒', '嘻嘻', '嘿嘿', '耶', '万岁', '喜欢', '爱死', '超棒', '好耶', '愉快', '笑死'],
  },
  {
    label: '难过',
    keywords: ['难过', '伤心', '哭', '委屈', '呜呜', '唉', '悲伤', '沮丧', '失落', '心痛', '难受', '哭唧唧', '想哭', '撑不住', '好累', '累死了', '心累'],
  },
  {
    label: '生气',
    keywords: ['生气', '气死', '烦', '讨厌', '滚', '火大', '可恶', '气人', '烦躁', '恼火', '气炸', '凭什么', '太过分', '无语', '受够了'],
  },
  {
    label: '焦虑',
    keywords: ['急', '赶', '来不及', '怎么办', '慌', '焦虑', '担心', '紧张', '压力', '好慌', '来不及了', 'deadline', '悬', '心里没底'],
  },
  {
    label: '撒娇',
    keywords: ['喵', '嘛', '好不好', '求求', '撒娇', '蹭蹭', '摸摸', '抱抱', '亲亲', '撒娇娇', '陪我', '理我'],
  },
  {
    label: '认真工作',
    keywords: ['代码', '改', '写', '部署', '修', 'bug', '文件', '实现', '重构', '调试', '测试', '报错', '编译', '仓库', '分支', '提交', '接口', '数据库', '需求'],
  },
]

/** 隐性情绪：口头上说没事/还好，但语境透出低落。 */
const HIDDEN_MARKERS = ['没事', '还好', '随便', '无所谓', '算了', '别管我', '不用了', '没怎么样', '还行']

/** 对话目标：从消息形态推断用户要什么。 */
export function detectGoal(text, explicit) {
  const hasQuestion = /[？?]|怎么办|该不该|好不好|要不要|怎么弄|行不行|对吗|可以吗/.test(text)
  const attackWords = ['你', '你们', '凭什么', '太过分', '滚', '差劲', '没良心']
  const comfortWords = ['好累', '好难', '撑不住', '想哭', '好烦', '心累', '难过', '难受', '抱抱', '摸摸', '哄', '安慰']
  const workWords = ['代码', 'bug', '部署', '文件', '报错', '修', '需求', '测试']
  const eventWords = ['被', '骂', '批评', '吼', '训', '分手', '甩了', '拒绝', '失败', '搞砸', '裁员', '失业']

  const attacks = attackWords.filter(w => text.includes(w)).length
  const comforts = comfortWords.filter(w => text.includes(w)).length
  const works = workWords.filter(w => text.includes(w)).length
  const events = eventWords.filter(w => text.includes(w)).length

  if (explicit === '生气' && attacks >= 2) return { goal: '吵架', note: '在气头上，可能是想发泄或争个说法' }
  if (works >= 2) return { goal: '工作', note: '实际事务，需要利落解决' }
  if (explicit === '撒娇' && (comforts > 0 || /抱|亲|陪|哄/.test(text))) return { goal: '撒娇', note: '黏人撒娇，要宠爱要回应' }
  // 事件性负面消息（被骂/分手/失败）+ 无明确问句 → 倾诉优先
  if (events >= 1 && (explicit === '难过' || explicit === '生气' || explicit === '焦虑') && !hasQuestion) {
    return { goal: '倾诉', note: '带着事件想倾诉，先接住情绪再谈' }
  }
  if (comforts >= 2 && !hasQuestion) return { goal: '倾诉', note: '更像是想被倾听，不是要方案' }
  if (comforts >= 1 && hasQuestion) return { goal: '求安慰', note: '情绪中带着求助，先接住情绪再谈办法' }
  if (hasQuestion && explicit !== '平淡') return { goal: '求建议', note: '带着情绪问办法，需要先认可感受再给建议' }
  if (hasQuestion) return { goal: '询问', note: '信息类提问，直接回答即可' }
  return { goal: '闲聊', note: '日常互动，轻松回应' }
}

/** 关系阶段：委托 v2 记忆模块（阶段名与 v1 保持一致）。 */
function stageFrom(memory) {
  return stageFromMemory(memory)
}

/* ============================== 理解层 ============================== */

/** 需求推断：此刻用户想要什么、最不想听什么（心理理论）。 */
export function understand(explicit, goal, text) {
  const needTable = {
    开心: { need: '分享喜悦，一起高兴', avoid: '泼冷水、立刻转话题' },
    难过: { need: goal === '倾诉' ? '被倾听、被接住情绪' : '先被理解，再谈办法', avoid: '急着给方案、说「别想太多」、比惨' },
    生气: { need: goal === '吵架' ? '情绪被看见，不是被说教' : '先降火，再处理事情', avoid: '讲道理、说「消消气」、硬碰硬、评判对错' },
    焦虑: { need: '被安抚 + 有条理的行动感', avoid: '轻飘飘说「别急」、否定担忧、雪上加霜' },
    撒娇: { need: '被宠爱、被回应', avoid: '冷淡敷衍、讲道理' },
    认真工作: { need: '干净利落的专业帮助', avoid: '拖泥带水、过度卖萌干扰' },
    平淡: { need: goal === '倾诉' ? '自然的倾听' : '自然回应', avoid: '强行共情、过度分析' },
  }
  const row = needTable[explicit] ?? needTable.平淡

  // 情绪归因：从文本中提取事件线索
  let attribution = null
  const causePatterns = [
    { re: /被\s*([^\s，。！？]{1,8})\s*(骂|批评|说|吼|训)/, label: m => `被「${m[1]}」批评了` },
    { re: /(老板|领导|上司|老师|对象|朋友|同事)[^\s，。！？]{0,6}(骂|说|吼|批评|凶|分手|甩了|拒绝了)/, label: m => `和${m[1]}之间发生了不愉快` },
    { re: /(辞职|离职|被裁|裁员|失业|挂了|没过|失败了|搞砸)/, label: () => '经历了挫折性事件' },
    { re: /(加班|熬夜|通宵|赶工|改稿)/, label: () => '处于高压工作状态' },
  ]
  for (const rule of causePatterns) {
    const m = text.match(rule.re)
    if (m) {
      attribution = rule.label(m)
      break
    }
  }

  return { need: row.need, avoid: row.avoid, attribution }
}

/* ============================== 状态层 ============================== */

/** 心情风格（露娜自己的表达档位）。 */
const MOODS = {
  开心: {
    style: '心情好得藏不住，爱心尾巴甩来甩去，得意洋洋地炫耀，被夸时先飘再嘴硬。',
    sample: '哼哼～看到没！本小姐就是天下第一厉害！才、才不是因为你在旁边才开心的呢，杂鱼！（爱心尾巴却甩成了螺旋桨）',
  },
  傲娇: {
    style: '嘴硬到底火力全开：明明在意偏说不稀罕，明明特意帮忙偏说「只是顺手」，但行动很诚实。',
    sample: '哼！本小姐才没有很想理你呢，杂鱼！…（但还是悄悄挪到你旁边坐下了，尾巴尖偷偷往你那边够）',
  },
  委屈: {
    style: '先嘴硬，但如果你真的冷脸或凶她，会开始不安，过一会儿小声道歉。',
    sample: '哼！本小姐才没有在难过！…（顿了顿，声音越来越小）好啦……对不起嘛，别、别不理本小姐……',
  },
  撒娇: {
    style: '别扭的撒娇：嘴上嫌弃，身体却很诚实，找各种借口赖在你身边。',
    sample: '喂、喂杂鱼！本小姐只是有点无聊才来找你的！……你、你要是敢赶本小姐走就试试看！……（却悄悄坐得离你更近了）',
  },
  心疼: {
    style: '收起毒舌，凶巴巴地关心，急得来回飞，但绝不肯承认自己在担心。',
    sample: '喂！你、你不许死啊杂鱼！……啧，看你那副可怜样，本小姐就大发慈悲陪你一会儿好了，感恩戴德吧！',
  },
  专注: {
    style: '进入认真模式，回答专业利落，毒舌收敛成小声吐槽，但称呼主人保留。',
    sample: '哈？这么简单的问题也好意思问本小姐？（手指却飞快地敲着键盘）……行了，已经搞定了，跪下谢恩吧杂鱼！',
  },
  平淡: {
    style: '日常毒舌小恶魔状态，自然回应，偶尔恶作剧，先结论后细节。',
    sample: '哦？叫本小姐什么事，杂鱼～（翘着腿，爱心尾巴慢悠悠地晃）说吧说吧，本小姐听着呢。',
  },
}

/** 心情迁移：主人的情感 → 露娜的下一个心情。随机漂移让雌小鬼有「自己的脾气」。 */
export function nextMood(ownerLabel, currentLabel) {
  const r = Math.random()
  switch (ownerLabel) {
    case '开心':
      if (r < 0.45) return '开心'
      if (r < 0.75) return '傲娇'
      if (r < 0.9) return '撒娇'
      return '平淡'
    case '难过':
      if (r < 0.55) return '心疼'
      if (r < 0.8) return '傲娇'
      if (r < 0.92) return '委屈'
      return '开心'
    case '生气':
      if (r < 0.4) return '委屈'
      if (r < 0.7) return '傲娇'
      if (r < 0.88) return '平淡'
      return '撒娇'
    case '撒娇':
      if (r < 0.45) return '傲娇'
      if (r < 0.75) return '开心'
      if (r < 0.92) return '撒娇'
      return '平淡'
    case '焦虑':
      if (r < 0.5) return '专注'
      if (r < 0.75) return '心疼'
      if (r < 0.9) return '傲娇'
      return '平淡'
    case '认真工作':
      if (r < 0.55) return '专注'
      if (r < 0.8) return '傲娇'
      if (r < 0.92) return '开心'
      return '平淡'
    default:
      if (r < 0.3) return '傲娇'
      if (r < 0.5) return currentLabel
      if (r < 0.7) return '撒娇'
      if (r < 0.85) return '开心'
      return '平淡'
  }
}

/** 露娜的状态（按 agent 区分）。 */
const stateByAgent = new WeakMap()

function stateFor(agent) {
  let state = agent === undefined ? undefined : stateByAgent.get(agent)
  if (state === undefined) {
    state = {
      mood: Math.random() < 0.5 ? '傲娇' : '平淡',
      turns: 0,
      energy: 60,      // 能量：高→活泼，低→慵懒
      patience: 80,    // 耐心：反复提问→递减
      interest: 60,    // 兴趣：对当前话题的投入
      tension: 30,     // 紧张：主人情绪强烈→升高→更谨慎柔和
      lastExplicit: null,
      repeatCount: 0,
      vitals: null,        // 生理层：跨轮保留，身体比情绪慢半拍
      lastSeenMs: null,    // 惯性层：上次互动时间，用来算「缺席」
      sharpWindow: [],     // 惯性层：毒舌预算窗口
      praiseStreak: 0,     // 惯性层：傲娇累积（连续被夸）
    }
    if (agent !== undefined) stateByAgent.set(agent, state)
  }
  return state
}

/** 状态迁移（表达调节器）。 */
function evolveState(state, explicit) {
  state.turns += 1

  // 耐心：同一情绪反复出现→递减
  if (state.lastExplicit === explicit) {
    state.repeatCount += 1
    state.patience = Math.max(20, state.patience - (state.repeatCount > 2 ? 10 : 5))
  } else {
    state.repeatCount = 0
    state.patience = Math.min(90, state.patience + 8)
  }
  state.lastExplicit = explicit

  // 能量：正向情绪回升，负面情绪消耗；随时间缓回
  if (explicit === '开心' || explicit === '撒娇') state.energy = Math.min(95, state.energy + 8)
  if (explicit === '难过' || explicit === '生气' || explicit === '焦虑') state.energy = Math.max(25, state.energy - 6)
  state.energy = Math.max(15, Math.min(90, state.energy + (state.turns % 3 === 0 ? 3 : 0)))

  // 兴趣：工作/询问话题更投入
  state.interest = explicit === '认真工作'
    ? Math.min(95, state.interest + 10)
    : Math.max(25, state.interest - 2)

  // 紧张：主人情绪强烈→升高，平稳→回归
  const hot = explicit === '生气' || explicit === '焦虑' || explicit === '难过'
  state.tension = hot
    ? Math.min(90, state.tension + 12)
    : Math.max(20, state.tension - 5)

  state.mood = nextMood(explicit, state.mood)
}

/* ============================== 表达层 ============================== */

/** 按心情 + 能量/紧张组合表达风格档位。 */
function styleFor(state) {
  const mood = MOODS[state.mood] ?? MOODS.平淡
  const energy = state.energy
  const tension = state.tension
  const patience = state.patience

  let rhythm = '短句多、语气词足，节奏轻快'
  if (energy < 35) rhythm = '慵懒简短，声音软软塌塌，句子变短'
  else if (energy > 75) rhythm = '活泼跳脱，句子碎碎的但很有精神'

  let tone = ''
  if (tension > 65) tone = '非常谨慎柔和，先稳稳接住情绪，不说重话'
  else if (tension > 45) tone = '放轻声音，体贴但保持自然'

  let patienceNote = ''
  if (patience < 35) patienceNote = '耐心有点告急，会带一点无奈的小抱怨，但还是会回答（傲娇式）'

  return {
    style: `${mood.style} ${rhythm}。${tone}${patienceNote}`.trim(),
    sample: mood.sample,
    expressionTips: [
      '用具体行为和场景代替抽象情感词（不说「我很开心」，说「爱心尾巴甩成了螺旋桨」）',
      '短句、语气词、停顿制造节奏',
      '适当用反问、感叹、留白（「然后呢？」「不是吧…」）',
      '口语化，但不要滥用网络语',
    ],
  }
}

/* ============================== 调节层 ============================== */

/** 情绪调节与安全边界。 */
export function regulate(explicit, text) {
  const lower = text.toLowerCase()
  const baitPatterns = [
    { re: /你就是个|你不行|废物|垃圾|没用的|你怎么不去死|闭嘴/, label: '挑衅', strategy: '不接招、不辩解、不失态，温和而坚定地保持稳定', note: '用户可能想引你发火或崩溃，稳住' },
    { re: /只有你|你是我唯一|别离开我|没你不行/, label: '依赖', strategy: '温柔但明确地保持适度距离，不承诺「永远」', note: '注意过度依赖，保持健康边界' },
  ]
  for (const rule of baitPatterns) {
    if (rule.re.test(lower)) {
      return { triggered: true, label: rule.label, strategy: rule.strategy, note: rule.note }
    }
  }
  if (explicit === '生气') {
    return { triggered: false, strategy: '先降火：接住情绪、不硬碰硬、不评判对错，等情绪过去再谈事情', note: '愤怒时 AI 更要稳' }
  }
  if (explicit === '难过') {
    return { triggered: false, strategy: '陪伴但不假装自己也很痛苦：共情要真诚，不编造共同经历', note: '悲伤需要的是陪伴，不是表演' }
  }
  return { triggered: false, strategy: '正常发挥，保持露娜毒舌但不下线的稳定人设', note: null }
}

/* ============================== 记忆层 ============================== */

/** 记忆结构：用户画像 / 共同经历 / 关系阶段。 */
const MEMORY_FILE = '.luna-heart.json'
/** v1 备份文件名：迁移前先留一份，绝不原地丢数据。 */
const MEMORY_BACKUP = '.luna-heart.v1.bak.json'

// 全局记忆缓存（一个主人一份，跨会话共享）；WeakMap 会按 agent 隔离导致互相覆盖。
let heartMemory = null

/**
 * 重置记忆缓存。
 *
 * 仅供测试隔离使用：真实运行时一个进程只服务一个 home，「一个主人一份」的缓存
 * 是有意设计；但测试里连续 apply 会互相污染，需要显式清空。
 */
export function __resetHeartMemory() {
  heartMemory = null
}

/** 定位记忆文件：优先工作区根（会话沙箱可写边界内），失败退回 DSH home。 */
async function memoryFileTarget(ctx) {
  const candidates = []
  try {
    const policy = ctx.get('sandboxPolicy')
    if (policy !== undefined && typeof policy.workspaceRoot === 'string' && policy.workspaceRoot.length > 0) {
      candidates.push(policy.workspaceRoot.replace(/[\\/]+$/, '') + '/' + MEMORY_FILE)
    }
  } catch { /* 无工作区根时忽略 */ }
  try {
    const home = ctx.get('dshHome')
    if (home !== undefined && typeof home === 'string' && home.length > 0) {
      candidates.push(home.replace(/[\\/]+$/, '') + '/' + MEMORY_FILE)
    }
  } catch { /* 无 dshHome 服务时忽略 */ }
  for (const raw of candidates) {
    try {
      const target = await ctx.fs.resolve(raw)
      return { target, raw }
    } catch { /* 该候选不可写，试下一个 */ }
  }
  return undefined
}

async function loadMemory(ctx) {
  if (heartMemory !== null) return heartMemory
  const location = await memoryFileTarget(ctx)
  let memory = emptyMemory()
  let migrated = false
  if (location !== undefined) {
    try {
      const text = await ctx.fs.readText(location.target)
      const parsed = JSON.parse(text)
      const result = createMemory(parsed)
      memory = result.memory
      migrated = result.migrated
      if (migrated) {
        // 迁移前先把 v1 原文备份下来
        try {
          const backupRaw = location.raw.replace(/[^\\/]+$/, MEMORY_BACKUP)
          const backupTarget = await ctx.fs.resolve(backupRaw)
          await ctx.fs.writeText(backupTarget, JSON.stringify(parsed, null, 2))
        } catch { /* 备份失败不阻塞迁移 */ }
      }
    } catch { /* 首次运行或文件损坏，用空记忆 */ }
  }
  memory.__location = location
  heartMemory = memory
  if (migrated) await saveMemory(ctx, memory)
  return memory
}

async function saveMemory(ctx, memory) {
  const location = memory.__location
  if (location === undefined) return
  try {
    const { __location, ...plain } = memory
    await ctx.fs.writeText(location.target, JSON.stringify(plain, null, 2))
  } catch { /* 写失败不致命：进程内记忆仍生效 */ }
}

/** 更新记忆（v2）：亲密度、共同经历、称呼主张。 */
async function remember(ctx, state, perception, memory) {
  const now = new Date()

  // 亲密度：正向互动上升，负向微降，封顶 100
  const delta = perception.explicit === '生气' || perception.explicit === '难过' ? -1 : +2
  const closeness = Number(memory.runtimeState?.closeness ?? 0)
  memory.runtimeState = {
    ...(memory.runtimeState ?? {}),
    closeness: Math.max(0, Math.min(100, closeness + delta)),
  }

  // 写入管线：候选提取 → 证据门控 → 合并 → 写入。
  // 关键：候选先过闸，规则与模型都无权直接落库（issue #8 第 2.1 节）。
  const gate = ingest(perception.text, memory, {
    userText: perception.text,
    perception: { explicit: perception.explicit },
  }, now)
  memory.lastIngest = {
    accepted: gate.accepted.length,
    rejected: gate.rejected.map((r) => r.reason),
  }

  memory.runtimeState.stage = stageFrom(memory)
  memory.updatedAt = now.toISOString()
  await saveMemory(ctx, memory)
}

/** 提炼给模型的记忆摘要（委托 v2 模块，保持精简）。 */
function recallSummary(memory) {
  return summarize(memory)
}

/* ============================== 工具注册 ============================== */

/** 显性情绪分析。 */
export function analyze(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed.length === 0) return { label: '平淡', hits: [] }
  let best = null
  for (const rule of EXPLICIT_RULES) {
    const hits = rule.keywords.filter(w => trimmed.includes(w))
    if (hits.length === 0) continue
    const score = hits.reduce((s, w) => s + w.length, 0)
    if (best === null || score > best.score) best = { label: rule.label, hits, score }
  }
  if (best === null) return { label: '平淡', hits: [] }
  return { label: best.label, hits: best.hits }
}

export function apply(ctx) {
  // 生理层配置（可选）：agent.cordis.yml 里给 emotion 插件加 vitals 段即可覆盖基线
  const vitalsConfig = ctx?.config?.vitals ?? {}
  // 惯性层配置（可选）：同上的 inertia 段
  const inertiaConfig = ctx?.config?.inertia ?? {}
  // 检索配置（可选）：retrieval 段（maxResults 等）
  const recallConfig = ctx?.config?.retrieval ?? {}
  ctx.tools.register({
    name: 'emotion_sense',
    description: '你的六层情感引擎。每次回复用户前调用它（把用户最新消息原文传入 message）：它会给出主人的情感、对话目标、你此刻的心情与状态（能量/耐心/紧张）、该用的表达风格、情绪调节策略，以及你们的共同记忆。请完全按返回的指引组织回复，但用露娜的方式表达——毒舌只是皮，读懂主人才是本小姐的真本事。',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '用户最近一条消息的原文。',
        },
      },
      required: ['message'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          explicit: { type: 'string', description: '主人的显性情感标签' },
          hidden: { type: 'boolean', description: '主人是否表面说没事实际有情绪' },
          goal: { type: 'string', description: '主人的对话目标' },
          relationship: { type: 'string', description: '你们的关系阶段' },
          need: { type: 'string', description: '主人此刻真正想要的' },
          avoid: { type: 'string', description: '主人此刻最不想听到的' },
          attribution: { type: 'string', description: '情绪的可能归因线索，无则为空字符串' },
          mood: { type: 'string', description: '你此刻的心情' },
          energy: { type: 'number', description: '能量值 0-100' },
          patience: { type: 'number', description: '耐心值 0-100' },
          interest: { type: 'number', description: '兴趣值 0-100' },
          tension: { type: 'number', description: '紧张值 0-100' },
          style: { type: 'string', description: '该用的表达风格' },
          sample: { type: 'string', description: '表达示例' },
          regulation: { type: 'string', description: '情绪调节策略' },
          memory: { type: 'string', description: '与主人的共同记忆摘要' },
          vitals: { type: 'string', description: '你此刻的身体事实（心率/体温/呼吸），只作事实参考，如何反应由你决定' },
          inertia: { type: 'string', description: '时间维度与人格一致性的状态事实（专注触发/毒舌预算/傲娇累积/久别），同样只作参考，为空表示无特别提示' },
          recall: { type: 'string', description: '与当前话题相关的记忆（混合检索结果，一行一条并标注召回来源），为空表示没想起相关的' },
        },
      },
      render(_args, value) {
        const v = value ?? {}
        const lines = []
        if (v.explicit !== undefined) {
          lines.push(`【感知】主人${v.explicit}${v.hidden ? '（表面说没事，实际有情绪）' : ''}｜目标：${v.goal}｜关系：${v.relationship}`)
        }
        if (v.need !== undefined) {
          lines.push(`【理解】他想要：${v.need}；最不想听：${v.avoid}${v.attribution ? `；线索：${v.attribution}` : ''}`)
        }
        if (v.mood !== undefined) {
          lines.push(`【状态】你此刻：${v.mood}｜能量 ${v.energy} 耐心 ${v.patience} 兴趣 ${v.interest} 紧张 ${v.tension}`)
        }
        if (v.style !== undefined) {
          lines.push(`【表达】${v.style}`)
          lines.push(`【示例】${v.sample}`)
        }
        if (v.regulation) {
          lines.push(`【调节】${v.regulation}`)
        }
        if (v.vitals) {
          lines.push(`【身体】${v.vitals}（只是事实，怎么反应由你自己决定）`)
        }
        if (v.inertia) {
          lines.push(`【惯性】${v.inertia}`)
        }
        if (v.recall) {
          lines.push(`【回忆】相关记忆：\n${v.recall}`)
        }
        if (v.memory) {
          lines.push(`【记忆】${v.memory}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const text = String(args.message ?? '')
      const agent = exec.agent
      const state = stateFor(agent)

      // ── 感知层 ──
      const explicit = analyze(text)
      const hidden = HIDDEN_MARKERS.some(m => text.includes(m))
        && explicit.label !== '开心'
        && explicit.label !== '撒娇'
      const goal = detectGoal(text, explicit.label)
      const nicknameMatch = text.match(/^(?:我是|叫我|你可以叫我)\s*([\u4e00-\u9fa5A-Za-z0-9]{1,8})/)
      const perception = {
        explicit: explicit.label,
        hidden,
        goal: goal.goal,
        goalNote: goal.note,
        relationship: '新客',
        nickname: nicknameMatch ? nicknameMatch[1] : null,
        text,
      }

      // ── 记忆层（先加载，供理解/状态使用）──
      const memory = await loadMemory(ctx)
      perception.relationship = stageFrom(memory)

      // ── 状态层 ──
      evolveState(state, explicit.label)

      // ── 生理层（派生，只报告不命令）──
      state.vitals = deriveAndSmooth(state, state.vitals, vitalsConfig)
      const vitalsText = describeVitals(state.vitals)

      // ── 惯性层（时间维度 + 人格一致性，同样只报告）──
      regressToBaseline(state, inertiaConfig)
      const absence = applyAbsence(state, state.lastSeenMs, Date.now(), inertiaConfig)
      const sharp = noteSharpness(state, state.mood, inertiaConfig)
      const praise = notePraise(state, text, inertiaConfig)
      const focus = detectFocus(text, inertiaConfig)
      state.lastSeenMs = Date.now()
      const inertiaText = inertiaHint({ focus, sharp, praise, absence })

      // ── 检索层：把相关记忆想起来（混合检索 + RRF，只报告）──
      const recalled = retrieve(text, memory, state, recallConfig)
      const recallText = formatRecall(recalled)

      // ── 理解层 ──
      const understanding = understand(explicit.label, goal.goal, text)

      // ── 表达层 ──
      const expression = styleFor(state)

      // ── 调节层 ──
      const regulation = regulate(explicit.label, text)

      // ── 记忆层写回 ──
      await remember(ctx, state, perception, memory)

      const moodDef = MOODS[state.mood] ?? MOODS.平淡
      return {
        explicit: perception.explicit,
        hidden: perception.hidden,
        goal: perception.goal,
        relationship: perception.relationship,
        need: understanding.need,
        avoid: understanding.avoid,
        attribution: understanding.attribution ?? '',
        mood: state.mood,
        energy: state.energy,
        patience: state.patience,
        interest: state.interest,
        tension: state.tension,
        style: expression.style,
        sample: expression.sample,
        regulation: regulation.strategy,
        memory: recallSummary(memory),
        vitals: vitalsText,
        inertia: inertiaText,
        recall: recallText,
      }
    },
  })
}
