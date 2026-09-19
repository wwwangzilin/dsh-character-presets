/**
 * 露娜 · 情绪感知层（emotion）
 * ============================================================================
 * 从用户的一句话里读出：主情绪 + 强度 + 次情绪 + 标点信号 + 是否口是心非。
 *
 * 为什么单独成模块：原来这套规则塞在 luna-soul.mjs 里，判据只有「字面包含 +
 * 按词长累加」，于是有四个硬伤：
 *
 *   1. 否定不认 —— 「我不开心」命中了「开心」（长度 2），判成开心
 *   2. 强度丢失 —— 「哈哈哈哈」和「哈哈」同分，微喜与狂喜分不出来
 *   3. 混合情绪 —— 「气笑了」只取分数最高的那个，另一半分量消失
 *   4. 标点无视 —— 「？？？」「……」这些信号一个字都没用上
 *
 * 本模块补上这四件事，纯函数、零依赖，可单独 `node --test`。
 */

/** 情绪关键词表：比原来宽，且按「确定性」分层（强特征词权重更高）。 */
export const EXPLICIT_RULES = [
  {
    label: '开心',
    strong: ['太好', '好耶', '万岁', '笑死', '爱死', '超棒', '爽', '太好了', '绝了', '哈哈哈哈'],
    normal: ['开心', '高兴', '哈哈', '棒', '嘻嘻', '嘿嘿', '耶', '喜欢', '愉快', '不错', '舒服', '赞'],
  },
  {
    label: '难过',
    strong: ['想哭', '哭唧唧', '撑不住', '心碎', '崩了', '心痛', '绝望', '熬不住'],
    normal: ['难过', '伤心', '哭', '委屈', '呜呜', '唉', '悲伤', '沮丧', '失落', '难受', '好累', '累死了', '累了', '心累', '有点累', '太累', '真累', '疲惫', '低落', '提不起劲'],
  },
  {
    label: '生气',
    strong: ['气炸', '气死', '受够了', '忍无可忍', '无语死了', '火大'],
    normal: ['生气', '烦', '讨厌', '滚', '可恶', '气人', '烦躁', '恼火', '凭什么', '太过分', '无语', '受不了', '离谱', '好气', '真气', '气到', '气疯'],
  },
  {
    label: '焦虑',
    strong: ['来不及了', '完蛋了', 'deadline', '要死了', '撑不到'],
    normal: ['急', '赶', '来不及', '怎么办', '慌', '焦虑', '担心', '紧张', '压力', '悬', '心里没底', '睡不着', '坐立不安'],
  },
  {
    label: '撒娇',
    strong: ['求求', '撒娇娇', '抱抱', '亲亲', '陪我', '理我', '蹭蹭'],
    normal: ['喵', '嘛', '好不好', '撒娇', '摸摸', '黏', '哼哼'],
  },
  {
    label: '认真工作',
    strong: ['部署', '重构', '报错', '调试', '上线', '发版'],
    normal: ['代码', '改', '写', '修', 'bug', '文件', '实现', '测试', '编译', '仓库', '分支', '提交', '接口', '数据库', '需求', '脚本'],
  },
]

/**
 * 否定词。命中词**前面 4 个字内**出现它，就算被否定。
 * 「才不」「并不」这类双字否定要放在单字前面匹配。
 *
 * 刻意**不收单字「别」**：「特别开心」「别人」「差别」「个别」全都会误伤，
 * 而「别难过」这种句子多半是用户在安慰别人，判错无害。收益远小于代价。
 */
export const NEGATIONS = ['才不', '并不', '不算', '谈不上', '算不上', '没有', '不是', '不会', '不想', '没什么', '不', '没', '甭']

/** 小句边界：否定词跨过标点就管不到后面了（「不差，今天很开心」不该被翻）。 */
const CLAUSE_BREAK = /[，。、！？；：,.!?;:…～]/

/** 程度副词：把 intensity 往上推。 */
export const INTENSIFIERS = ['太', '超', '好', '特别', '非常', '巨', '极其', '真的', '简直', '死', '爆', '疯了']

/** 减弱词：把 intensity 往下拉。 */
export const DIMINISHERS = ['有点', '稍微', '还算', '还行', '一点点', '勉强', '大概', '可能']

/**
 * 退让 / 口是心非信号。这类词单独看都不像情绪，但配上短句就是「算了，不说了」。
 * 原来的 HiddenMarkers 只有 9 个，漏掉了「你忙吧」「不打扰了」这类真正的退场词。
 */
export const RETREAT_MARKERS = [
  '没事', '还好', '随便', '无所谓', '算了', '别管我', '不用了', '没怎么样', '还行',
  '我很好', '不用担心', '你忙吧', '不打扰', '我都行', '听你的', '你决定', '知道了', '哦',
]

/** 提要求 / 想被哄的信号——有这些就不算「退场」，是撒娇。 */
export const SEEKING_MARKERS = ['抱抱', '陪我', '理我', '哄', '安慰', '摸摸', '在吗', '别走']

/**
 * 中文里最典型的混合情绪是「A+B」结构的固定说法。这类词单看某一个字都不成情绪
 * （「气笑」既不在生气表也不在开心表），必须整词识别，否则一律漏成「平淡」。
 */
export const MIXED_PATTERNS = [
  { re: /气笑|又气又笑|气到笑/, primary: '生气', secondary: '开心' },
  { re: /苦笑|哭笑不得|笑不出来|想笑又|笑着笑着就/, primary: '难过', secondary: '开心' },
  { re: /又累又|累并快乐|痛并快乐/, primary: '难过', secondary: '开心' },
  { re: /又急又气|又气又急/, primary: '生气', secondary: '焦虑' },
  { re: /又委屈又|又难过又/, primary: '难过', secondary: '委屈' },
]

/** 命中最具体的混合情绪；没有则返回 null。 */
export function matchMixed(text) {
  const t = String(text ?? '')
  for (const p of MIXED_PATTERNS) {
    const m = t.match(p.re)
    if (m) return { matched: m[0], primary: p.primary, secondary: p.secondary }
  }
  return null
}


/**
 * 标点信号。
 * @returns {{ excited: boolean, confused: boolean, trailing: boolean, dryLaugh: boolean }}
 */
export function punctuationSignals(text) {
  const t = String(text ?? '')
  return {
    /** 连续感叹号：激动 / 恼火 */
    excited: /[!！]{2,}/.test(t),
    /** 连续问号：着急 / 不满 / 困惑 */
    confused: /[?？]{2,}/.test(t),
    /** 省略号或孤零零的句号：犹豫 / 低落 / 说不下去 */
    trailing: /(\.{3,}|。{2,}|…)/.test(t),
    /** 「哈」只有一两个且不成串：干笑 / 敷衍，不是真开心 */
    dryLaugh: /^哈{1,2}$|[^哈]哈{1,2}[^哈]/.test(t) && !/哈{3,}/.test(t),
  }
}

/**
 * 强度分档：1 = 轻，2 = 中，3 = 强。
 * 依据：标点爆发、字符重复、程度副词、减弱词，以及命中词的强度层级。
 *
 * 普通命中只记 1.2 分——「今天很开心」是淡淡的开心，不该直接顶到 2 档；
 * 要往上走，得靠惊叹号、重复字、程度副词这些**外溢**信号。
 */
export function intensityOf(text, { strongHits = 0, normalHits = 0 } = {}) {
  const t = String(text ?? '')
  let level = normalHits > 0 ? 1.2 : 1
  if (strongHits > 0) level += 1

  if (/[!！]{2,}/.test(t)) level += 0.8
  if (/[!！]{4,}/.test(t)) level += 0.3
  const runs = repeatedRun(t)
  if (runs.max >= 3) level += 1.0 // 哈哈哈 / 啊啊啊 / 呜呜呜
  if (runs.max >= 4) level += 0.5
  if (INTENSIFIERS.some((w) => t.includes(w))) level += 0.5
  if (DIMINISHERS.some((w) => t.includes(w))) level -= 0.6

  return clamp(Math.round(level), 1, 3)
}

/** 最长连续重复的**非标点**字符长度。「？？？」不算情绪外溢。 */
function repeatedRun(text) {
  const chars = [...String(text ?? '')]
  let max = 0
  let run = 1
  for (let i = 1; i <= chars.length; i += 1) {
    const same = i < chars.length && chars[i] === chars[i - 1] && !CLAUSE_BREAK.test(chars[i]) && !/\s/.test(chars[i])
    if (same) run += 1
    else {
      if (run > max) max = run
      run = 1
    }
  }
  return { max }
}

/** 命中统计：区分强特征词与普通词。 */
function collectHits(text, rule) {
  const strong = (rule.strong ?? []).filter((w) => text.includes(w))
  const normal = (rule.normal ?? []).filter((w) => text.includes(w))
  // 强特征词往往包含普通词（「哈哈哈哈」包含「哈哈」），去重避免重复计分
  const uniqueNormal = normal.filter((w) => !strong.some((s) => s.includes(w)))
  return { strong, normal: uniqueNormal }
}

/**
 * 命中词是否被否定。只看命中词**前面 4 个字**——中文里否定词几乎总在紧邻位置，
 * 放宽会误伤（「不问这个了，今天挺开心的」不该被翻）。
 * 另外跨过小句边界（逗号/句号）的否定词一律不算。
 */
function isNegated(text, word) {
  const at = text.indexOf(word)
  if (at <= 0) return false
  const before = text.slice(Math.max(0, at - 4), at)
  if (CLAUSE_BREAK.test(before)) return false
  return NEGATIONS.some((n) => before.includes(n))
}

/**
 * 主入口：分析一句话里的情绪。
 *
 * @returns {{
 *   label: string,          // 主情绪（与旧版同名，向后兼容）
 *   hits: string[],         // 命中的关键词（向后兼容）
 *   level: 1|2|3,           // 强度
 *   secondary: string|null, // 次情绪
 *   negated: boolean,       // 主情绪是否被否定过
 *   hidden: boolean,        // 是否口是心非（退让词 + 短句）
 *   signals: string[],      // 可读的信号摘要，供注入文本用
 * }}
 */
export function analyzeEmotion(text) {
  const t = String(text ?? '').trim()
  if (t.length === 0) return empty('平淡')

  // 混合情绪的固定说法最具体，优先级最高——「气笑」两边的词表都命中不了
  const mixed = matchMixed(t)
  if (mixed) {
    return {
      label: mixed.primary,
      hits: [mixed.matched],
      level: intensityOf(t, { strongHits: 1 }),
      secondary: mixed.secondary,
      negated: false,
      hidden: false,
      signals: [...signalSummary(t), `混合情绪（${mixed.primary}+${mixed.secondary}）`],
    }
  }

  /** 每条规则算分：强特征词 3 分，普通词 2 分；被否定的词按「反向」记。 */
  const scored = []
  let negatedPositive = 0
  let negatedNegative = 0

  for (const rule of EXPLICIT_RULES) {
    const { strong, normal } = collectHits(t, rule)
    let score = 0
    const hits = [...strong, ...normal]
    for (const w of strong) score += isNegated(t, w) ? 0 : 3
    for (const w of normal) score += isNegated(t, w) ? 0 : 2

    // 被否定的正向/负向词会往反方向推一把
    for (const w of [...strong, ...normal]) {
      if (!isNegated(t, w)) continue
      if (rule.label === '开心' || rule.label === '撒娇') negatedPositive += 1
      if (rule.label === '难过' || rule.label === '生气' || rule.label === '焦虑') negatedNegative += 1
    }

    if (score > 0) scored.push({ label: rule.label, score, hits, strong: strong.length })
  }

  scored.sort((a, b) => b.score - a.score)
  const signals = signalSummary(t)

  // 否定把正向情绪抹掉时，按「低落」处理——「我不开心」不该判成开心
  if (scored.length === 0 && negatedPositive > negatedNegative) {
    const level = intensityOf(t, { normalHits: 1 })
    return {
      ...empty('难过'),
      level,
      negated: true,
      signals: [...signals, '否定式表达'],
      hidden: false,
    }
  }
  // 否定掉负向情绪 → 松一口气，回到平淡偏正向
  if (scored.length === 0 && negatedNegative > 0) {
    return { ...empty('平淡'), level: 1, negated: true, signals: [...signals, '负面被否定（松了口气）'] }
  }
  if (scored.length === 0) {
    const hidden = isHidden(t)
    return { ...empty('平淡'), signals, hidden }
  }

  const top = scored[0]
  // 次情绪：分数达到主情绪 60% 才算，避免凑数
  const second = scored[1] !== undefined && scored[1].score >= top.score * 0.6 ? scored[1].label : null
  const level = intensityOf(t, { strongHits: top.strong, normalHits: top.hits.length })

  return {
    label: top.label,
    hits: top.hits,
    level,
    secondary: second,
    negated: false,
    hidden: false,
    signals: second === null ? signals : [...signals, `混合情绪（${top.label}+${second}）`],
  }
}

/** 口是心非：出现退让词，且整句不长（长句里的「随便」往往是真的随便）。 */
export function isHidden(text) {
  const t = String(text ?? '').trim()
  const hasRetreat = RETREAT_MARKERS.some((w) => t.includes(w))
  if (!hasRetreat) return false
  return t.length <= 12 && !SEEKING_MARKERS.some((w) => t.includes(w))
}

/** 把标点与结构信号转成可读摘要，供注入文本使用。 */
export function signalSummary(text) {
  const p = punctuationSignals(text)
  const out = []
  if (p.excited) out.push('连感叹号')
  if (p.confused) out.push('连问号')
  if (p.trailing) out.push('省略号（话没说完）')
  if (p.dryLaugh) out.push('干笑（不是真开心）')
  if (repeatedRun(text).max >= 3) out.push('重复字（情绪外溢）')
  return out
}

function empty(label) {
  return { label, hits: [], level: 1, secondary: null, negated: false, hidden: false, signals: [] }
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo
  return n < lo ? lo : n > hi ? hi : n
}
