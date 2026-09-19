/**
 * 露娜 · 时刻层（mode）
 * ============================================================================
 * 区分「工作时刻」与「闲聊时刻」，并让它在轮次之间**粘住**。
 *
 * 为什么单独成模块：感知层是**逐条消息**判的——这条像工作就认真，下一条像闲聊
 * 就飘回来。但真实的工作不是这样：一旦开始干活，人就在那个劲头上。
 * 中途一句「嗯」「继续」「还有呢」不该把人拽出状态；反过来，活干到一半时
 * 一句「陪我聊会」也不该被无视。
 *
 * 所以这里是一个**粘滞状态机**：
 *   进入工作 → 至少粘住 6 轮（这期间只有明确的走人信号才放行）
 *   退出工作 → 需要闲聊信号，且这条消息里一点工作痕迹都没有
 *   长时间没说话（>6h）→ 重置回闲聊（第二天来是新的开始，不该接着昨天的火）
 *
 * 纯函数、零依赖，状态由调用方持有（和 luna-vitals / luna-inertia 一样）。
 */

/** 默认参数，可在 agent.cordis.yml 的 `mode` 段覆盖。 */
export const MODE_DEFAULTS = {
  /** 工作信号达到这个分就进入工作 */
  enterWork: 2,
  /** 闲聊信号达到这个分可以**强行**打断工作（「陪我聊会」） */
  forceChat: 3,
  /** 进入工作后至少粘住的轮数 */
  stickTurns: 6,
  /** 粘滞期过后，退出工作所需的闲聊分 */
  exitChat: 2,
  /** 多久没说话就重置回闲聊 */
  idleResetMs: 6 * 60 * 60 * 1000,
}

/** 工作信号：强特征（正则）——命中即 2 分。 */
const WORK_STRONG = [
  /```/,                                   // 贴代码块
  /[A-Za-z]:\\[^\s]|[^\s/]\/[\w.-]+\/[\w.-]+/, // Windows / POSIX 路径
  // 注意别用 \b 包住 ERR_：下划线是 word 字符，ERR_MODULE_NOT_FOUND 里没有词边界
  /ERR_[A-Z_]+|Cannot find|is not defined|Command failed|non-fast-forward/,
  /\b(error|exit code|stack trace|traceback|TS\d{4}|ENOENT|EACCES|EPERM)\b/i,
  /\b(commit|push|merge|rebase|build|deploy|install|npm|pnpm|yarn|git|api|json|sql)\b/i,
  /继续|接着|然后呢|还有呢|下一个|再来|往下/,        // 追问 = 还在干活
  /改一下|跑一下|试一下|看一下|查一下|修一下|补上|加上|去掉|换成|改成/,
]

/** 工作信号：普通词——每个 1 分。不含单字（「改天」「写生」会误伤）。 */
const WORK_WORDS = [
  '代码', '函数', '接口', '测试', '编译', '部署', '重构', '调试', '报错', '日志',
  '配置', '脚本', '仓库', '分支', '提交', '数据库', '需求', '实现', '文件', '模块',
  '插件', '版本', '依赖', '构建', '打包', '排查', '排错', '性能', '文档', '注释',
]

/** 闲聊信号：强特征——命中即 2 分。 */
const CHAT_STRONG = [
  /陪我聊|聊会天|聊聊天|在吗|在干嘛|干嘛呢|无聊|没事干|陪我说说话/,
  /今天(过得)?(怎么样|开心吗|累不累|还好吗)|你(累不累|困不困|饿不饿|想我吗)/,
  /你(觉得|想|喜欢|会|是不是).{0,6}(我|本小姐|露娜)/,
]

/** 闲聊信号：普通词——每个 1 分。 */
const CHAT_WORDS = ['哈哈', '嘿嘿', '嘻嘻', '呜', '唉', '哼', '陪我', '抱抱', '摸摸', '可爱', '乖']

/** 工作语境下会被误当闲聊的词，命中时给闲聊分打折。 */
const WORK_CONTEXT_HINT = /```|路径|报错|代码|函数|接口|文件|脚本|配置/

/** 一条消息的工作信号分。 */
export function workScore(text, explicit) {
  const t = String(text ?? '')
  if (t.length === 0) return 0
  let score = 0
  for (const re of WORK_STRONG) if (re.test(t)) score += 2
  for (const w of WORK_WORDS) if (t.includes(w)) score += 1
  if (explicit === '认真工作') score += 1
  return score
}

/** 一条消息的闲聊信号分。 */
export function chatScore(text, explicit) {
  const t = String(text ?? '')
  if (t.length === 0) return 0
  // 技术语境里「你觉得这个方案怎么样」不是闲聊——有工作痕迹时打折
  const discount = WORK_CONTEXT_HINT.test(t) ? 0.5 : 1
  let score = 0
  for (const re of CHAT_STRONG) if (re.test(t)) score += 2
  for (const w of CHAT_WORDS) if (t.includes(w)) score += 1
  if (explicit === '撒娇' || explicit === '开心') score += 1
  return Math.round(score * discount)
}

/**
 * 推进时刻状态机。
 *
 * @param {object|null} prev 上一轮的 { mode, turns, sticky, lastAt }
 * @param {string} text 用户最新消息
 * @param {string} explicit 感知层的情绪标签
 * @param {object} [opts] { now, config }
 * @returns {{mode:'work'|'chat', turns:number, sticky:number, lastAt:number,
 *            work:number, chat:number, reason:string}}
 */
export function nextMode(prev, text, explicit, opts = {}) {
  const cfg = { ...MODE_DEFAULTS, ...(opts.config ?? {}) }
  const now = Number(opts.now ?? Date.now())
  const w = workScore(text, explicit)
  const c = chatScore(text, explicit)

  const make = (mode, turns, sticky, reason) => ({ mode, turns, sticky, lastAt: now, work: w, chat: c, reason })

  // 没有前态：从这条消息起判
  if (!prev || (prev.mode !== 'work' && prev.mode !== 'chat')) {
    return w >= cfg.enterWork
      ? make('work', 1, cfg.stickTurns - 1, 'init-work')
      : make('chat', 1, 0, 'init-chat')
  }

  // 长时间没说话 → 重置：第二天来是新的开始，不该接着昨天的劲头
  const idle = Number(prev.lastAt) > 0 ? now - Number(prev.lastAt) : 0
  if (idle >= cfg.idleResetMs) {
    return w >= cfg.enterWork
      ? make('work', 1, cfg.stickTurns - 1, 'idle-work')
      : make('chat', 1, 0, 'idle-reset')
  }

  const turns = (Number(prev.turns) || 0) + 1
  const sticky = Math.max(0, Number(prev.sticky) || 0)

  if (prev.mode === 'work') {
    // 明确要走人（「陪我聊会」）——哪怕还在粘滞期也放行，但门槛高
    if (c >= cfg.forceChat) return make('chat', 1, 0, 'chat-pull')
    // 粘滞期内：不因为一句「嗯」「继续」就退出
    if (sticky > 0) return make('work', turns, sticky - 1, 'sticky')
    // 粘滞期过了：要闲聊信号，且这条一点工作痕迹都没有
    if (c >= cfg.exitChat && w === 0) return make('chat', 1, 0, 'chat')
    return make('work', turns, 0, 'work')
  }

  // 闲聊中：有工作信号就上劲
  if (w >= cfg.enterWork) return make('work', 1, cfg.stickTurns - 1, 'work')
  return make('chat', turns, 0, 'chat')
}

/** 工作时刻的表达档位——「铆足劲干」。 */
export const WORK_STYLE = {
  style: '工作时刻，铆足劲干：直接上结论，不铺垫、不卖萌、不绕弯；毒舌收成一句小声吐槽，称呼「主人」保留。'
    + '不确定就直说不确定，绝不猜着编；错了立刻认，改完再邀功。',
  sample: '行，本小姐看看。（凑近屏幕，尾巴都不晃了）找到了——maxBuffer 默认 1MB，子进程被杀返回 status=null，'
    + '代码里 `status ?? -1` 把它当成了「干净」直接跳过提交。改完了，去试。',
}

/** 工作时刻的调节约束——给调节层拼一句话。 */
export const WORK_GUARD = '工作时刻不打岔：不主动撒娇、不主动翻旧事、不插入无关话题；有问题直说，干完再邀功。'

/** 工作时刻的表达要点（覆盖卖萌那套）。 */
export const WORK_TIPS = [
  '直接上结论，不铺垫、不绕弯',
  '不确定就直说不确定，绝不猜着编',
  '错了立刻认，改完再邀功',
  '毒舌收成一句小声吐槽，别抢戏',
]

/**
 * 检索偏好：工作时刻抬高「情感路」的启用门槛，别把无关的旧温情翻出来干扰干活。
 *
 * 返回的是**可直接 spread 进 recall 配置的覆盖片段**——检索模块的阈值可被配置覆盖，
 * 这里不去猜它的默认值，没配就什么都不返回，避免两边各写一份默认值。
 *
 * @param {'work'|'chat'} mode
 * @param {object} [recallConfig] 当前检索配置
 */
export function recallBias(mode, recallConfig = {}) {
  if (mode !== 'work') return {}
  const base = Number(recallConfig.arousalThreshold)
  if (!Number.isFinite(base)) return {}
  return { arousalThreshold: base * 1.6 }
}

/** 给注入文本用的一行说明。 */
export function modeLine(mode, turns) {
  if (mode !== 'work') return ''
  const n = Number(turns) || 1
  return n <= 1 ? '工作时刻——铆足劲干，别打岔' : `工作时刻（已连着干了 ${n} 轮）——别松劲，也别打岔`
}
