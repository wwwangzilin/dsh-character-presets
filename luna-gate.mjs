/**
 * 露娜 · 写入管线：证据门控
 * ============================================================================
 * 核心原则（issue #8 第 2.1 节）：
 *   **模型只能提出候选，不能自行决定它最终是否进入记忆。**
 *
 * 流程：
 *   对话轮次结束 → 候选提取（规则） → 证据门控（确定性代码）
 *   → 谓词校验 / 类型校验 / 原文引用校验 → 合并 / 替代 / 拒绝 → 写入
 *
 * 五道闸（全部是确定性代码，可复现、可测试）：
 *   1. 逐字引用校验 —— evidence 必须真的出现在原文里（防编造）
 *   2. 来源标注     —— 分不出 [USER]/[TOOL]/[ACT]/[SELF] 的一律拒绝
 *   3. claims 必须来自 [USER]（露娜不能自己给主人下定义）
 *   4. 谓词注册表校验（模型塞不进任意字段）
 *   5. 数字必须来自 [USER] 或 [TOOL]（防幻觉数字）
 *
 * 纯函数模块，不依赖 Cordis，可单独测试。
 */

import {
  SOURCES, PREDICATE_REGISTRY, appendClaim, appendEpisode, generateId,
} from './luna-memory.mjs'

/* ============================ 1. 来源分类 =============================== */

/**
 * 判断一条证据出自谁。
 *
 * @param {string} evidence   候选自带的原文引用
 * @param {object} ctx        { userText, toolText, selfText }
 * @returns {string|null}     来源标签，判不出则 null（调用方会拒绝）
 */
export function classifySource(evidence, ctx = {}) {
  const quote = String(evidence ?? '').trim()
  if (!quote) return null

  const userText = String(ctx.userText ?? '')
  const toolText = String(ctx.toolText ?? '')
  const selfText = String(ctx.selfText ?? '')

  if (userText && userText.includes(quote)) return SOURCES.USER
  if (toolText && toolText.includes(quote)) return SOURCES.TOOL
  if (selfText && selfText.includes(quote)) return SOURCES.SELF
  return null
}

/* ============================ 2. 辅助判断 =============================== */

/** 值里是否含数字（含中文数字）。 */
export function containsNumber(value) {
  if (value === null || value === undefined) return false
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return /\d/.test(text) || /[一二三四五六七八九十百千万零两]/.test(text)
}

/** 候选是否带工具证据（evidence 数组里至少一条来自 [TOOL]）。 */
export function hasToolEvidence(candidate, ctx = {}) {
  const items = Array.isArray(candidate?.evidence)
    ? candidate.evidence
    : [candidate?.evidence].filter(Boolean)
  return items.some((item) => classifySource(item, ctx) === SOURCES.TOOL)
}

/* ============================ 3. 门控主体 =============================== */

/**
 * 证据门控：决定一条候选能否进入记忆。
 * @returns {{accepted: boolean, reason: string, source?: string}}
 */
export function gateCandidate(candidate, ctx = {}) {
  if (!candidate || typeof candidate !== 'object') {
    return { accepted: false, reason: 'candidate_invalid' }
  }
  const type = candidate.type ?? 'episode'

  // 闸 1：逐字引用校验
  const quotes = Array.isArray(candidate.evidence)
    ? candidate.evidence
    : [candidate.evidence].filter(Boolean)
  if (quotes.length === 0) {
    return { accepted: false, reason: 'evidence_missing' }
  }
  const source = classifySource(quotes[0], ctx)
  if (!source) {
    return { accepted: false, reason: 'evidence_not_found' }
  }

  // 闸 2：来源必须分得清（上面已保证），且不能是露娜自己的话当事实
  if (source === SOURCES.SELF && type === 'claim') {
    return { accepted: false, reason: 'self_claim_not_allowed' }
  }

  // 闸 3：claims 必须来自 [USER]
  if (type === 'claim' && source !== SOURCES.USER) {
    return { accepted: false, reason: 'claim_requires_user_source' }
  }

  // 闸 4：谓词注册表（模型塞不进任意字段）
  if (type === 'claim') {
    if (!candidate.predicate || typeof candidate.predicate !== 'string') {
      return { accepted: false, reason: 'predicate_missing' }
    }
    if (!PREDICATE_REGISTRY[candidate.predicate]) {
      return { accepted: false, reason: 'predicate_not_registered' }
    }
  }

  // 闸 5：数字不能凭空出现
  const numeric = type === 'claim' ? containsNumber(candidate.value) : containsNumber(candidate.summary)
  if (numeric && source !== SOURCES.USER && !hasToolEvidence(candidate, ctx)) {
    return { accepted: false, reason: 'number_requires_user_or_tool_source' }
  }

  return { accepted: true, reason: 'ok', source }
}

/* ============================ 4. 候选提取 =============================== */

const CLAIM_RULES = [
  { predicate: 'name', re: /^(?:我是|叫我|你可以叫我)\s*([\u4e00-\u9fa5A-Za-z0-9]{1,8})/ },
  { predicate: 'occupation', re: /我是(?:做|搞|干)?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)(?:的|开发|工程师|程序员)/ },
  { predicate: 'occupation', re: /我(?:主要)?(?:写|用)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)(?:开发|写代码)/ },
  { predicate: 'language', re: /我(?:主要)?用\s*([A-Za-z+#]{1,12})\s*(?:写|开发)/ },
  { predicate: 'boundary', re: /(?:我)?(?:不喜炊|不喜欢|讨厌|别|不要)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,16})/ },
  { predicate: 'timezone', re: /(?:我(?:在|这边是))\s*(UTC[+-]?\d{1,2}|GMT[+-]?\d{1,2})/i },
]

/**
 * 从一轮对话里抽候选（规则版，不调用 LLM —— 保持零依赖与可复现）。
 * episode 候选总是生成（summary 为这轮摘要），它也要过门控。
 */
export function extractCandidates(userText, perception = {}) {
  const text = String(userText ?? '').trim()
  const candidates = []
  if (!text) return candidates

  for (const rule of CLAIM_RULES) {
    const m = text.match(rule.re)
    if (!m) continue
    candidates.push({
      type: 'claim',
      predicate: rule.predicate,
      value: m[1],
      evidence: text.slice(0, 120),
    })
  }

  // 共同经历：整轮当作一条 episode（summary 取前 24 字，evidence 留原文）
  const summary = text.replace(/\s+/g, ' ').slice(0, 24)
  if (summary) {
    candidates.push({
      type: 'episode',
      summary,
      emotion: perception.explicit ?? '',
      valence: 0,
      arousal: 0.3,
      evidence: text.slice(0, 120),
    })
  }

  return candidates
}

/* ============================ 5. 合并 / 替代 ============================ */

/** 摘要相似度（字符 bigram 的 Jaccard），用于 episode 去重。 */
export function similarity(a, b) {
  const grams = (s) => {
    const t = String(s ?? '').replace(/\s+/g, '')
    const out = new Set()
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
    if (out.size === 0 && t) out.add(t)
    return out
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  return inter / (ga.size + gb.size - inter)
}

/**
 * 决定一条候选与既有记忆的关系。
 * @returns {{action: 'insert'|'replace'|'touch'|'merge'|'reinforce', target?: object, old?: object}}
 */
export function planMerge(candidate, memory, threshold = 0.85) {
  if (candidate?.type === 'claim') {
    const same = (memory.claims ?? []).filter((c) => c.predicate === candidate.predicate)
    const exact = same.find((c) => JSON.stringify(c.value) === JSON.stringify(candidate.value))
    if (exact) return { action: 'touch', target: exact }
    // 同谓词的新值取代旧值（旧值留在 history 里，不直接抹掉）
    if (same.length > 0) return { action: 'replace', old: same[same.length - 1] }
    return { action: 'insert' }
  }

  if (candidate?.type === 'episode') {
    const hit = (memory.episodes ?? []).find((e) => similarity(e.summary, candidate.summary) > threshold)
    if (hit) return { action: 'merge', target: hit }
    return { action: 'insert' }
  }

  if (candidate?.type === 'inference') {
    const hit = (memory.inferences ?? []).find((i) => i.pattern && i.pattern === candidate.pattern)
    if (hit) return { action: 'reinforce', target: hit }
    return { action: 'insert' }
  }

  return { action: 'insert' }
}

/** 把一条候选真正写进记忆（已过门控）。 */
export function commitCandidate(candidate, memory, now = new Date()) {
  const plan = planMerge(candidate, memory)
  const stamp = now.toISOString()

  if (candidate.type === 'claim') {
    if (plan.action === 'touch') {
      plan.target.updatedAt = stamp
      plan.target.confidence = Math.min(1, Number(plan.target.confidence ?? 0.5) + 0.1)
      return { action: 'touch', id: plan.target.id }
    }
    if (plan.action === 'replace') {
      // 旧值归档到 history，而不是直接消失
      plan.old.history = [...(plan.old.history ?? []), { value: plan.old.value, replacedAt: stamp }]
      plan.old.value = candidate.value
      plan.old.evidence = candidate.evidence
      plan.old.updatedAt = stamp
      return { action: 'replace', id: plan.old.id }
    }
    const r = appendClaim(memory, {
      predicate: candidate.predicate,
      value: candidate.value,
      source: SOURCES.USER,
      evidence: candidate.evidence,
      confidence: 0.9,
      now,
    })
    return { action: r.ok ? 'insert' : 'rejected', id: r.claim?.id, reason: r.reason }
  }

  if (candidate.type === 'episode') {
    if (plan.action === 'merge') {
      plan.target.accessCount = Number(plan.target.accessCount ?? 0) + 1
      plan.target.lastSeenAt = stamp
      return { action: 'merge', id: plan.target.id }
    }
    const r = appendEpisode(memory, {
      summary: candidate.summary,
      emotion: candidate.emotion ?? '',
      evidence: Array.isArray(candidate.evidence) ? candidate.evidence : [candidate.evidence],
      now,
    })
    return { action: r.ok ? 'insert' : 'rejected', id: r.episode?.id, reason: r.reason }
  }

  if (candidate.type === 'inference') {
    if (plan.action === 'reinforce') {
      plan.target.evidenceCount = Number(plan.target.evidenceCount ?? 0) + 1
      plan.target.updatedAt = stamp
      if (plan.target.evidenceCount >= 3) plan.target.status = 'confirmed'
      return { action: 'reinforce', id: plan.target.id }
    }
    const inference = {
      id: generateId('inf'),
      statement: String(candidate.statement ?? candidate.summary ?? '').slice(0, 120),
      pattern: candidate.pattern ?? null,
      source: SOURCES.INFERRED,
      evidenceCount: 1,
      status: 'accumulating',
      createdAt: stamp,
      updatedAt: stamp,
    }
    memory.inferences.push(inference)
    return { action: 'insert', id: inference.id }
  }

  return { action: 'rejected', reason: 'unknown_type' }
}

/**
 * 一站式：提取 → 门控 → 合并 → 写入。
 * @returns {{accepted: Array, rejected: Array}}
 */
export function ingest(userText, memory, ctx = {}, now = new Date()) {
  const candidates = extractCandidates(userText, ctx.perception ?? {})
  const accepted = []
  const rejected = []

  for (const candidate of candidates) {
    const verdict = gateCandidate(candidate, { ...ctx, userText })
    if (!verdict.accepted) {
      rejected.push({ candidate, reason: verdict.reason })
      continue
    }
    const result = commitCandidate(candidate, memory, now)
    if (result.action === 'rejected') rejected.push({ candidate, reason: result.reason })
    else accepted.push({ candidate, ...result, source: verdict.source })
  }

  memory.updatedAt = now.toISOString()
  return { accepted, rejected }
}
