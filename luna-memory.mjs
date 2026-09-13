/**
 * 露娜 · 记忆层 v2
 * ============================================================================
 * 解决 v1 的五个问题（issue #8 背景）：
 *   1. 存原始事件而非蒸馏知识   2. 写入无校验   3. 无置信度
 *   4. 遗忘只能删、下游推断不重算   5. 稳定事实与临时状态混在一起
 *
 * 本模块负责 v2 的**数据模型**：schema、谓词注册表、v1→v2 迁移、版本检测。
 * 写入管线（证据门控）与检索管线是后续批次，接口已在此预留。
 *
 * 纯函数模块，不依赖 Cordis，可单独测试。
 *
 * 与 issue #8 原文的两点差异（已实测/已核对，非偷懒）：
 *   · 检索管线不使用 FTS5：实测 Node 24 的 FTS5 对中文无效（unicode61 把整段中文当作
 *     单个 token；trigram 分词器要求查询至少 3 个字符，「调试」这类两字词匹配不到）。
 *     且记忆规模只有几十到几百条，JS 打分扫描是微秒级。详见 #8 评论。
 *   · 迁移按**真实 v1 结构**实现：issue 示例写的是 userProfile / recentEvents，
 *     而 luna-soul.mjs 里实际是 profile / experiences / relationship。
 */

/** v2 版本号。 */
export const MEMORY_VERSION = '2.0.0'

/**
 * 谓词注册表：限制能写进 claims 的字段。
 * predicate 不在表内 → 候选被拒绝（防止模型往记忆里塞任意字段）。
 */
export const PREDICATE_REGISTRY = {
  name: { type: 'string', label: '称呼' },
  occupation: { type: 'string', label: '职业' },
  language: { type: 'array', label: '常用语言' },
  preference: { type: 'object', label: '偏好' },
  boundary: { type: 'string', label: '边界' },
  timezone: { type: 'string', label: '时区' },
}

/** 来源分类（写入管线的第二道闸；也决定一条信息能授权什么）。 */
export const SOURCES = {
  /** 主人自己的话 —— 「他决定了」「他问了」 */
  USER: '[USER]',
  /** 机器输出 —— 数字的唯一合法来源 */
  TOOL: '[TOOL]',
  /** 被调用的工具 —— 「这件事做了」 */
  ACT: '[ACT]',
  /** 露娜自己的文本 —— 第一人称判断，永远不是裸事实 */
  SELF: '[SELF]',
  /** 露娜的推断（要累积证据，不一次下结论） */
  INFERRED: '[INFERRED]',
  /** 系统 / 环境 */
  SYSTEM: '[SYSTEM]',
}

/** v1 的情感标签 → v2 的效价（valence, -1..1）。 */
const EMOTION_VALENCE = {
  开心: 0.8, 撒娇: 0.6, 平淡: 0, 认真工作: 0.3,
  委屈: -0.4, 难过: -0.7, 生气: -0.6, 焦虑: -0.5,
}

/* ============================== 基础构造 ================================= */

/** 生成带前缀的 id（时间有序，便于排查）。 */
export function generateId(prefix) {
  const now = new Date()
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${prefix}_${stamp}_${rand}`
}

/** 一份空的 v2 记忆。 */
export function emptyMemory(now = new Date()) {
  return {
    version: MEMORY_VERSION,
    updatedAt: now.toISOString(),
    claims: [],
    episodes: [],
    inferences: [],
    runtimeState: {},
    suppressions: [],
  }
}

/* ============================== 版本检测 ================================= */

/** 判断是否 v1（无 version，或 1.x）。 */
export function isV1(raw) {
  if (!raw || typeof raw !== 'object') return false
  const v = raw.version
  return v === undefined || v === null || String(v).startsWith('1')
}

/** 判断是否当前 v2。 */
export function isV2(raw) {
  return !!raw && typeof raw === 'object' && String(raw.version ?? '').startsWith('2.')
}

/**
 * 版本检测入口：任何来源都归一成一份可用的 v2。
 *   v2 → 原样返回（并补齐缺失字段）
 *   v1 → 迁移
 *   其它/损坏 → 空记忆（宁可从零开始，也不要带着脏数据跑）
 *
 * @returns {{memory: object, migrated: boolean, reason: string}}
 */
export function createMemory(raw) {
  if (isV2(raw)) {
    return { memory: normalizeV2(raw), migrated: false, reason: 'v2' }
  }
  if (isV1(raw)) {
    return { memory: migrateV1toV2(raw), migrated: true, reason: 'v1->v2' }
  }
  return { memory: emptyMemory(), migrated: false, reason: raw ? 'unknown-version' : 'empty' }
}

/** 补齐 v2 缺失的顶层字段（防止手改文件后崩）。 */
export function normalizeV2(raw) {
  const base = emptyMemory()
  return {
    ...base,
    ...raw,
    version: MEMORY_VERSION,
    claims: Array.isArray(raw.claims) ? raw.claims : [],
    episodes: Array.isArray(raw.episodes) ? raw.episodes : [],
    inferences: Array.isArray(raw.inferences) ? raw.inferences : [],
    suppressions: Array.isArray(raw.suppressions) ? raw.suppressions : [],
    runtimeState: raw.runtimeState && typeof raw.runtimeState === 'object' ? raw.runtimeState : {},
  }
}

/* ============================== v1 → v2 ================================= */

/**
 * 把真实 v1 结构迁移成 v2。
 *
 * v1: { version: 1, profile: { nickname, preferences[], observations[] },
 *       relationship: { stage, closeness }, experiences: [ { topic, date, emotion } ] }
 */
export function migrateV1toV2(v1, now = new Date()) {
  const v2 = emptyMemory(now)
  const stamp = now.toISOString()
  const migratedAt = v1?.createdAt ?? stamp

  // profile.nickname → claim(name)
  const nickname = v1?.profile?.nickname
  if (nickname) {
    v2.claims.push({
      id: generateId('claim'),
      predicate: 'name',
      value: String(nickname),
      source: SOURCES.USER,
      evidence: '（从 v1 迁移，无原始证据）',
      createdAt: migratedAt,
      updatedAt: stamp,
      confidence: 0.8,          // 迁移数据降置信度：没留下原话
    })
  }

  // profile.preferences[] → claim(preference)
  for (const pref of v1?.profile?.preferences ?? []) {
    v2.claims.push({
      id: generateId('claim'),
      predicate: 'preference',
      value: typeof pref === 'object' && pref !== null ? pref : { note: String(pref) },
      source: SOURCES.USER,
      evidence: '（从 v1 迁移，无原始证据）',
      createdAt: migratedAt,
      updatedAt: stamp,
      confidence: 0.7,
    })
  }

  // profile.observations[] → inference（露娜自己的观察，本来就该是慢速推断）
  const observations = Array.isArray(v1?.profile?.observations) ? v1.profile.observations : []
  if (observations.length > 0) {
    v2.inferences.push({
      id: generateId('inf'),
      statement: observations.map((o) => (typeof o === 'string' ? o : JSON.stringify(o))).join('；'),
      source: SOURCES.INFERRED,
      evidenceCount: 1,              // v1 只留了结论，没有逐条证据
      status: 'accumulating',
      createdAt: migratedAt,
      updatedAt: stamp,
    })
  }

  // experiences[] → episode
  for (const exp of v1?.experiences ?? []) {
    const emotion = exp?.emotion ?? ''
    v2.episodes.push({
      id: generateId('ep'),
      summary: String(exp?.topic ?? exp?.summary ?? ''),
      valence: EMOTION_VALENCE[emotion] ?? 0,
      arousal: emotion === '生气' || emotion === '难过' ? 0.6 : 0.3,
      evidence: exp?.evidence ? [String(exp.evidence)] : [],
      entities: [],
      createdAt: exp?.date ?? migratedAt,
      accessCount: 0,
      migratedFrom: 'v1',
    })
  }

  // relationship → runtimeState（临时状态，不当作长期事实）
  const rel = v1?.relationship ?? {}
  v2.runtimeState = {
    stage: rel.stage ?? '新客',
    closeness: Number(rel.closeness ?? 0),
    expiresAt: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
  }

  return v2
}

/* ============================== 写入辅助 ================================= */

/**
 * 追加一条 claim。谓词不在注册表内直接拒绝；同谓词同值视为「再次确认」，
 * 提升置信度而不是堆重复条目。
 */
export function appendClaim(memory, {
  predicate, value, source = SOURCES.INFERRED, evidence = '', confidence = 0.6, now = new Date(),
}) {
  const check = validatePredicate(predicate, value)
  if (!check.ok) return { ok: false, reason: check.reason }

  const stamp = now.toISOString()
  const existing = memory.claims.find(
    (c) => c.predicate === predicate && JSON.stringify(c.value) === JSON.stringify(value),
  )
  if (existing) {
    existing.confidence = Math.min(1, Number(existing.confidence ?? 0.5) + 0.1)
    existing.updatedAt = stamp
    return { ok: true, merged: true, claim: existing }
  }

  const claim = {
    id: generateId('claim'),
    predicate,
    value,
    source,
    evidence,
    createdAt: stamp,
    updatedAt: stamp,
    confidence,
  }
  memory.claims.push(claim)
  return { ok: true, merged: false, claim }
}

/** 追加一条 episode（去重、限量、按情绪写效价）。 */
export function appendEpisode(memory, {
  summary, emotion = '', date = null, evidence = [], limit = 50, now = new Date(),
}) {
  const text = String(summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!text) return { ok: false, reason: 'summary 为空' }

  const day = date ?? now.toISOString().slice(0, 10)
  const head = memory.episodes[0]
  if (head && head.summary === text && String(head.createdAt).slice(0, 10) === day) {
    return { ok: true, duplicate: true, episode: head }
  }

  const episode = {
    id: generateId('ep'),
    summary: text,
    valence: EMOTION_VALENCE[emotion] ?? 0,
    arousal: emotion === '生气' || emotion === '难过' ? 0.6 : 0.3,
    evidence: Array.isArray(evidence) ? evidence : [String(evidence)].filter(Boolean),
    entities: [],
    createdAt: date ?? now.toISOString(),
    accessCount: 0,
  }
  memory.episodes = [episode, ...memory.episodes].slice(0, limit)
  return { ok: true, duplicate: false, episode }
}

/** 关系阶段：按可见经历 + 主张数量与亲密度推进。 */
export function stageFromMemory(memory) {
  const closeness = Number(memory?.runtimeState?.closeness ?? 0)
  const count = visibleEpisodes(memory).length + visibleClaims(memory).length
  if (closeness >= 60 || count >= 15) return '长期主人'
  if (count >= 5 || closeness >= 30) return '熟客'
  return '新客'
}

/** 一句话记忆摘要（注入用，保持精简）。 */
export function summarize(memory) {
  const lines = []
  const ep = visibleEpisodes(memory)[0]
  const nameClaim = visibleClaims(memory).find((c) => c.predicate === 'name')
  if (ep) lines.push(`最近聊过：「${ep.summary}」（${String(ep.createdAt).slice(0, 10)}）`)
  if (nameClaim) lines.push(`主人自称「${nameClaim.value}」`)
  const stage = memory?.runtimeState?.stage
  if (stage && stage !== '新客') lines.push(`关系：${stage}`)
  if (lines.length === 0) lines.push('你们刚开始相处，还没有太多共同经历')
  return lines.join('；')
}

/* ============================ 预留接口（后续批次）========================= */

/** 谓词校验：注册表内 + 类型匹配。批次 2 的门控第一道闸。 */
export function validatePredicate(predicate, value) {
  const spec = PREDICATE_REGISTRY[predicate]
  if (!spec) return { ok: false, reason: `predicate "${predicate}" 不在注册表内` }
  if (value === undefined || value === null || value === '') {
    return { ok: false, reason: 'value 为空' }
  }
  const okType =
    (spec.type === 'string' && typeof value === 'string') ||
    (spec.type === 'array' && Array.isArray(value)) ||
    (spec.type === 'object' && typeof value === 'object' && !Array.isArray(value))
  return okType ? { ok: true } : { ok: false, reason: `predicate "${predicate}" 需要 ${spec.type}` }
}

/** 某个 id 是否被抑制（遗忘机制，批次 4）。 */
export function isSuppressed(memory, id) {
  return (memory?.suppressions ?? []).some((s) => s.targetId === id)
}

/**
 * 过滤掉不该再注入的 episodes：被抑制的、以及已老化 / 已墓碑的。
 * 老化与墓碑都不真删——数据留在文件里，只是不再进上下文。
 */
export function visibleEpisodes(memory) {
  return (memory?.episodes ?? []).filter(
    (ep) => !isSuppressed(memory, ep.id) && ep.status !== 'deleted' && ep.status !== 'stale',
  )
}

/** 过滤掉被抑制的 claims。 */
export function visibleClaims(memory) {
  return (memory?.claims ?? []).filter((c) => !isSuppressed(memory, c.id))
}
