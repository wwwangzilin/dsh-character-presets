/**
 * 露娜 · 不在场层（offline）
 * ============================================================================
 * 你没看她的时候，她在干什么。
 *
 * 现在的她像一盏声控灯：你说话才亮。隔 8 小时再聊，她只报一句「心跳 74」，
 * 好像时间根本没流动过。而真人最让人信服的地方，恰恰是那些**你看不见的时刻**。
 *
 * 三条规矩：
 *   1. **确定性** —— 同一个间隔内每次派生出同一件事（用 lastSeenMs 当种子）。
 *      不能每轮变，否则「她刚才在睡觉」和「她刚才在翻你抽屉」会前后打架，
 *      比不写还糟。
 *   2. **不解释你的缺席** —— 只说她自己干了什么，不追问你去哪了。
 *      抱怨的活儿交给表达层，这里只给事实。
 *   3. **短** —— 一句，最多两句。它是一行状态，不是一段剧情。
 */

/** 空档分桶。不到 5 分钟不值得编故事——她本来就还在旁边。 */
const BUCKETS = [
  { key: 'moment', max: 5 * 60_000, events: [] },
  {
    key: 'short',
    max: 60 * 60_000,
    events: [
      '本小姐去倒了杯水',
      '本小姐刚把你桌上那堆东西挪到一边了，乱死了',
      '本小姐在窗台上趴了一会儿，什么都没干',
      '本小姐刚去看了眼冰箱，里面还是那几样',
    ],
  },
  {
    key: 'half-day',
    max: 8 * 3_600_000,
    events: [
      '本小姐睡了个午觉。梦到什么？哼，不告诉你',
      '本小姐把你这屋翻了一遍，什么都没找着',
      '本小姐看了一下午漫画。是借的，不是买的',
      '本小姐数了数你桌上那堆东西，十七样。十七样！',
      '本小姐在沙发上躺到腿麻，这才起来',
    ],
  },
  {
    key: 'day',
    max: 36 * 3_600_000,
    events: [
      '本小姐昨天等了你半天，后来自己睡了',
      '本小姐昨天把那个抽屉修好了，不用谢',
      '本小姐昨天翻了你书架上那本，前面写得还行',
      '本小姐昨天一个人吃的饭，难吃',
    ],
  },
  {
    key: 'days',
    max: 7 * 86_400_000,
    events: [
      '好几天没影。本小姐把你这屋从里到外查了一遍',
      '本小姐这几天自己找事做，差点把窗帘拆了',
      '本小姐还以为你死了呢，杂鱼',
      '这几天本小姐把漫画全看完了，没得看了',
    ],
  },
  {
    key: 'long',
    max: Infinity,
    events: [
      '这么久。本小姐都快忘了你长什么样了，杂鱼',
      '本小姐都懒得数了，反正很久',
      '本小姐差点就回魔界了。……差点',
    ],
  },
]

/** 整数散列：把毫秒时间戳搅成一个稳定的种子。 */
function hash32(n) {
  let x = Math.floor(Number(n) || 0) & 0xffffffff
  x = (x ^ 61) ^ (x >>> 16)
  x = (x + (x << 3)) | 0
  x = x ^ (x >>> 4)
  x = Math.imul(x, 0x27d4eb2d)
  x = x ^ (x >>> 15)
  return Math.abs(x)
}

/** 按种子从表里取一条——同一间隔内恒定。 */
export function pickStable(list, seed) {
  if (!Array.isArray(list) || list.length === 0) return null
  return list[hash32(seed) % list.length]
}

/**
 * 距离上次说话多久，落在哪个桶里。
 * @param {number} lastSeenMs 上次互动的时间戳
 * @param {number} [now] 当前时间戳
 * @returns {{ ms:number, key:string, hours:number } | null} 无记录或时间倒退时返回 null
 */
export function offlineGap(lastSeenMs, now = Date.now()) {
  const last = Number(lastSeenMs)
  const t = Number(now)
  if (!Number.isFinite(last) || last <= 0 || !Number.isFinite(t)) return null
  const ms = t - last
  if (ms <= 0) return null
  const bucket = BUCKETS.find((b) => ms < b.max) ?? BUCKETS[BUCKETS.length - 1]
  return { ms, key: bucket.key, hours: Math.round((ms / 3_600_000) * 10) / 10 }
}

/**
 * 她这段时间在干什么。
 * @returns {{ key:string, text:string } | null} 间隔太短（<5 分钟）时返回 null
 */
export function offscreenEvent(lastSeenMs, now = Date.now()) {
  const gap = offlineGap(lastSeenMs, now)
  if (gap === null) return null
  const bucket = BUCKETS.find((b) => b.key === gap.key)
  if (!bucket || bucket.events.length === 0) return null
  const text = pickStable(bucket.events, Number(lastSeenMs))
  return text === null ? null : { key: gap.key, text }
}

/**
 * 生成注入给模型的一行事实。形如：
 *   不在场：本小姐睡了个午觉。梦到什么？哼，不告诉你
 * 间隔太短或没有记录时返回空串——不是每次都要交代行踪。
 */
export function absenceLine(lastSeenMs, now = Date.now()) {
  const event = offscreenEvent(lastSeenMs, now)
  return event === null ? '' : `不在场：${event.text}`
}

/** 空档是否久到值得提一句「你终于回来了」。 */
export function isLongAbsence(lastSeenMs, now = Date.now()) {
  const gap = offlineGap(lastSeenMs, now)
  return gap !== null && gap.ms >= 24 * 3_600_000
}
