/**
 * 露娜 · 检索管线：混合检索
 * ============================================================================
 * 目标（issue #8 第 3.1 节）：结果始终 ≤ maxResults 条，只进工具输出，
 * **注入成本不随检索方式增加**。
 *
 * 多路召回 → RRF 融合 → 截断：
 *
 *   1. 关键词路   —— 中英混合分词（中文 bigram + 英文词），命中率打分
 *   2. 情绪路     —— 当她情绪强烈时，优先想起情感上同频的经历
 *   3. 时近路     —— 最近发生的事更容易被想起
 *   ↓
 *   倒数排名融合（RRF, k=60）
 *
 * 与 issue 原文的差异（已在 #8 评论说明）：
 *   · 原文的 FTS5 全文检索 → 换成 JS 关键词路。实测 Node 24 的 FTS5 对中文无效
 *     （unicode61 把整段 CJK 当一个 token；trigram 要求查询 ≥3 字符），
 *     而记忆规模只有几十到几百条，JS 打分是微秒级。
 *   · 原文的语义检索（embeddings）→ 换成 bigram 相似度近似，保住零依赖。
 *
 * 另外提供「识别触发器索引」（第 3.4 节）：把记忆压成每行一条的索引文本，
 * 交给模型自己挑相关项——不依赖 embeddings，成本可控。默认**不注入**，
 * 由调用方决定（见 buildTriggerIndex）。
 *
 * 纯函数模块，不依赖 Cordis，可单独测试。
 */

import { visibleEpisodes, visibleClaims } from './luna-memory.mjs'

export const RECALL_DEFAULTS = {
  maxResults: 5,
  /** 情绪强度阈值：紧张度超过它才启用情绪路 */
  arousalThreshold: 0.7,
  /** RRF 平滑常数 */
  rrfK: 60,
  /** 时近路的半衰期（天） */
  recencyHalfLifeDays: 14,
  /** 每种记忆的权重（先验：稳定事实比一次经历更可信） */
  weights: { claim: 1.15, episode: 1.0, inference: 1.1 },
}

/* ============================== 分词 ================================== */

/**
 * 中英混合分词：中文切 bigram（FTS5 的中文失败就败在这儿），英文按单词。
 * 返回词元数组。
 */
export function tokenize(text) {
  const s = String(text ?? '').toLowerCase()
  const tokens = []
  // 英文/数字词
  for (const m of s.matchAll(/[a-z0-9_+#.]{2,}/g)) tokens.push(m[0])
  // 中文 bigram（含单字兜底）
  const cjk = s.replace(/[^\u4e00-\u9fa5]/g, ' ')
  for (const run of cjk.split(/\s+/)) {
    if (!run) continue
    if (run.length === 1) { tokens.push(run); continue }
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

/* ============================== 打分 ================================== */

/** 关键词命中率（命中词元 / 查询词元），0..1。 */
export function scoreKeyword(text, queryTokens) {
  if (queryTokens.length === 0) return 0
  const hay = new Set(tokenize(text))
  let hit = 0
  for (const t of queryTokens) if (hay.has(t)) hit++
  return hit / queryTokens.length
}

/** 情绪同频度：效价越接近，越容易被想起（issue 第 3.3 节）。 */
export function scoreValence(item, currentValence) {
  const v = Number(item?.valence ?? 0)
  const cur = Number(currentValence ?? 0)
  return 1 - Math.abs(v - cur) / 2
}

/** 时近度：半衰期衰减，0..1。 */
export function scoreRecency(item, nowMs, halfLifeDays = RECALL_DEFAULTS.recencyHalfLifeDays) {
  const ts = Date.parse(item?.createdAt ?? item?.lastSeenAt ?? '')
  if (!Number.isFinite(ts)) return 0.5
  const days = Math.max(0, (nowMs - ts) / 86400000)
  return Math.pow(0.5, days / halfLifeDays)
}

/** episode 的检索文本：evidence 已经包含 summary 时不重复拼接。 */
function episodeText(ep) {
  const summary = String(ep?.summary ?? '')
  const evidence = (ep?.evidence ?? []).join(' ')
  if (!summary) return evidence
  return evidence.includes(summary) ? evidence : `${summary} ${evidence}`
}

/** 把三类记忆统一成可检索的条目。 */
export function collectItems(memory) {
  const items = []
  for (const c of visibleClaims(memory)) {
    items.push({
      id: c.id, kind: 'claim',
      text: `${c.predicate} ${JSON.stringify(c.value)} ${c.evidence ?? ''}`,
      valence: 0, createdAt: c.updatedAt ?? c.createdAt, raw: c,
    })
  }
  for (const e of visibleEpisodes(memory)) {
    items.push({
      id: e.id, kind: 'episode',
      text: episodeText(e),
      valence: Number(e.valence ?? 0), createdAt: e.lastSeenAt ?? e.createdAt, raw: e,
    })
  }
  for (const i of memory?.inferences ?? []) {
    items.push({
      id: i.id, kind: 'inference',
      text: `${i.statement ?? ''} ${i.pattern ?? ''}`,
      valence: 0, createdAt: i.updatedAt ?? i.createdAt, raw: i,
    })
  }
  return items
}

/* ============================== RRF =================================== */

/**
 * 倒数排名融合（Reciprocal Rank Fusion）。
 * 每路各给一个有序列表，融合成统一排名：score = Σ 1/(k + rank)。
 */
export function reciprocalRankFusion(lists, k = RECALL_DEFAULTS.rrfK) {
  const scores = new Map()
  const best = new Map()
  for (const { name, items } of lists) {
    items.forEach((item, idx) => {
      const rank = idx + 1
      const prev = scores.get(item.id) ?? 0
      scores.set(item.id, prev + 1 / (k + rank))
      if (!best.has(item.id)) best.set(item.id, { item, sources: [] })
      const entry = best.get(item.id)
      if (!entry.sources.includes(name)) entry.sources.push(name)
    })
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ ...best.get(id).item, score, sources: best.get(id).sources }))
    .sort((a, b) => b.score - a.score)
}

/* ============================== 主入口 ================================ */

/**
 * 混合检索。
 *
 * @param {string} query  当前这轮的话（或问题）
 * @param {object} memory v2 记忆
 * @param {object} state  情绪状态（用 tension 当情绪强度、mood 影响效价）
 * @param {object} config 覆盖 RECALL_DEFAULTS
 */
export function retrieve(query, memory, state = {}, config = {}) {
  const cfg = { ...RECALL_DEFAULTS, ...config }
  const nowMs = config.nowMs ?? Date.now()
  const queryTokens = tokenize(query)
  const items = collectItems(memory)
  if (items.length === 0) return []

  // 路 1：关键词
  const keywordRanked = items
    .map((it) => ({ ...it, s: scoreKeyword(it.text, queryTokens) }))
    .filter((it) => it.s > 0)
    .sort((a, b) => b.s - a.s)

  // 路 2：情绪（仅当情绪够强）
  const arousal = Number(state.tension ?? 30) / 100
  const currentValence = valenceOfMood(state.mood)
  const emotionalRanked = arousal >= cfg.arousalThreshold
    ? items
      .map((it) => ({ ...it, s: scoreValence(it, currentValence) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, cfg.maxResults * 2)
    : []

  // 路 3：时近
  const recencyRanked = items
    .map((it) => ({ ...it, s: scoreRecency(it, nowMs, cfg.recencyHalfLifeDays) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, cfg.maxResults * 2)

  const lists = [
    { name: 'keyword', items: keywordRanked },
    ...(emotionalRanked.length ? [{ name: 'emotional', items: emotionalRanked }] : []),
    { name: 'recency', items: recencyRanked },
  ]

  const fused = reciprocalRankFusion(lists, cfg.rrfK)
  const weighted = fused
    .map((it) => ({ ...it, score: it.score * (cfg.weights[it.kind] ?? 1) }))
    .sort((a, b) => b.score - a.score)

  // 没有关键词命中的话，只保留时近的结果（避免答非所问）
  const relevant = keywordRanked.length > 0
    ? weighted.filter((it) => it.sources.includes('keyword') || it.sources.includes('emotional'))
    : weighted

  return (relevant.length > 0 ? relevant : weighted).slice(0, cfg.maxResults)
}

/** 粗粒度：心情 → 效价，用于情绪路。 */
export function valenceOfMood(mood) {
  const map = {
    开心: 0.8, 撒娇: 0.6, 平淡: 0, 认真工作: 0.3,
    委屈: -0.4, 难过: -0.7, 生气: -0.6, 焦虑: -0.5,
  }
  return map[mood] ?? 0
}

/* ======================== 识别触发器索引（3.4）========================= */

/**
 * 把记忆压成「每行一条」的索引文本，交给模型自己挑相关项。
 * 不依赖 embeddings，成本可控；**默认不注入**，由调用方按需使用。
 */
export function buildTriggerIndex(memory, limit = 50) {
  const items = collectItems(memory)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, limit)
  if (items.length === 0) return ''
  return items.map((it) => `${it.id}: ${it.text.replace(/\s+/g, ' ').slice(0, 60)}`).join('\n')
}

/** 把检索结果渲染成注入文本（精简，一行一条）。 */
export function formatRecall(results) {
  if (!results || results.length === 0) return ''
  return results
    .map((r) => `- [${r.kind}] ${r.text.replace(/\s+/g, ' ').slice(0, 60)}（${r.sources.join('+')}）`)
    .join('\n')
}
