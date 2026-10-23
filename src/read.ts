import { forgetUnmapped, getPage } from './api.ts'
import { getCached, getIndex, putCached, putIndex } from './cache.ts'
import { FanqieError, loginError, networkError, notFoundError, usageError } from './errors.ts'
import { countPua } from './fonts.ts'
import { hasSession } from './auth.ts'
import { getToc, type Chapter } from './toc.ts'

export interface ReadChapter {
  order?: number
  itemId: string
  title: string
  text: string
  fromCache: boolean
}

// 一次最多读几章。依据见 FEATURES.md F7：风控上 100 章也没出过失败，
// 限的是 Agent 的上下文（一章约 2300 个汉字，20 章约 4.7 万字）
export const MAX_CHAPTERS_PER_READ = 20

// 章节写法：3 或 3-5，序号从 1 起
export function parseRange(spec: string): { from: number; to: number } {
  const m = /^(\d+)(?:-(\d+))?$/.exec(spec.trim())
  if (!m) throw usageError(`章节要写成 3 或 3-5，收到 "${spec}"`)
  const from = Number(m[1])
  const to = m[2] === undefined ? from : Number(m[2])
  if (from < 1) throw usageError('章节序号从 1 开始')
  if (to < from) throw usageError(`章节范围 ${spec} 的起点比终点大`)
  if (to - from + 1 > MAX_CHAPTERS_PER_READ) {
    const n = MAX_CHAPTERS_PER_READ
    throw usageError(
      `一次最多读 ${n} 章，收到 ${spec}（${to - from + 1} 章）。请分批读，例如 read <书ID> ${from}-${from + n - 1} 再 read <书ID> ${from + n}-${from + 2 * n - 1}`,
    )
  }
  return { from, to }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16))
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)))
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

// 正文是 <p> 段落的 HTML。插图段落（只有 <img>）没有文字，丢掉
export function paragraphsOf(html: string): string[] {
  const parts = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1] ?? '')
  const raw = parts.length ? parts : html.split(/<br\s*\/?>/i)
  return raw.map((p) => unescapeHtml(p.replace(/<[^>]+>/g, '')).trim()).filter(Boolean)
}

interface Fetched {
  chapter: Omit<ReadChapter, 'fromCache'>
  raw: unknown
  locked: boolean
}

async function fetchChapter(itemId: string): Promise<Fetched> {
  const { status, state, decode } = await getPage(`/reader/${encodeURIComponent(itemId)}`)
  const cd = state.reader?.chapterData as Record<string, any> | undefined
  if (status === 404 || !cd?.itemId) throw notFoundError(`找不到章节 ${itemId}`)
  const text = paragraphsOf(String(cd.content ?? '')).map((p) => decode(p)).join('\n')
  return {
    chapter: { order: Number(cd.order) || undefined, itemId: String(cd.itemId), title: decode(cd.title), text },
    raw: cd,
    locked: Boolean(cd.isChapterLock),
  }
}

export interface ReadOptions {
  refresh: boolean
  // --raw：不读写缓存，返回接口原始数据
  raw: boolean
}

async function readOne(itemId: string, known: Chapter | undefined, opts: ReadOptions): Promise<{ chapter: ReadChapter; raw?: unknown }> {
  if (!opts.refresh && !opts.raw) {
    const c = getCached(itemId)
    if (c) return { chapter: { order: c.order, itemId, title: c.title, text: c.text, fromCache: true } }
  }
  // 目录已经标明要登录，且没有登录态：不必下载就能判断
  if (known?.locked && !hasSession()) {
    throw loginError(`「${known.title}」超出了免费章节：网页版要登录并开通 SVIP 会员才能读全。先运行 fanqie login`)
  }
  let f = await fetchChapter(itemId)
  // 正文里有还原不了的字符，多半是这次拿到的页面没带对字体：重新取，最多 2 次
  for (let i = 0; i < 2 && !f.locked && countPua(f.chapter.text) > 0; i++) {
    forgetUnmapped(countPua(f.chapter.text))
    // oxlint-disable-next-line no-await-in-loop
    f = await fetchChapter(itemId)
  }
  if (f.locked) {
    throw loginError(
      hasSession()
        ? `「${f.chapter.title}」登录后仍然读不全：网页版读全文需要 SVIP 会员；也可能是登录态过期，用 fanqie whoami 检查`
        : `「${f.chapter.title}」超出了免费章节：网页版要登录并开通 SVIP 会员才能读全。先运行 fanqie login`,
    )
  }
  // 乱码不如没有：Agent 会把它当正文。也不写进缓存，否则坏文本会被缓存 7 天
  const garbled = countPua(f.chapter.text)
  if (garbled > 0) {
    throw networkError(
      `章节「${f.chapter.title}」里有 ${garbled} 个字符没能还原，不输出以免给出乱码。稍后重试；如果一直这样，是字形表需要更新（scripts/build-glyphmap.ts）`,
    )
  }
  const order = known?.order ?? f.chapter.order
  const chapter = { ...f.chapter, order, fromCache: false }
  if (!opts.raw) putCached({ itemId, order, title: chapter.title, text: chapter.text, fetchedAt: Date.now() })
  return { chapter, raw: f.raw }
}

export function formatChapters(chapters: ReadChapter[]): string {
  return chapters.map((c) => `# ${c.title}\n${c.text}\n`).join('\n')
}

export interface ReadResult {
  chapters: ReadChapter[]
  raw: unknown[]
}

// 先用缓存的序号对应关系；强制刷新、缓存没有、或缓存里没有想要的序号时才取目录
async function tocFor(bookId: string, upTo: number, opts: ReadOptions): Promise<Chapter[]> {
  const cached = opts.refresh || opts.raw ? undefined : getIndex(bookId)
  if (cached && cached.length >= upTo) return cached
  const { chapters } = await getToc(bookId)
  if (!opts.raw) putIndex(bookId, chapters)
  return chapters
}

// 按书籍 ID 和章节范围读。中途失败时，错误上带着已读到的部分
export async function readRange(bookId: string, spec: string, opts: ReadOptions): Promise<ReadResult> {
  const { from, to } = parseRange(spec)
  const toc = await tocFor(bookId, to, opts)
  if (to > toc.length) throw notFoundError(`这本书的目录一共 ${toc.length} 章，没有第 ${to} 章`)
  const done: ReadChapter[] = []
  const raws: unknown[] = []
  try {
    for (const known of toc.slice(from - 1, to)) {
      // 逐章顺序读，既是礼貌，也避免触发风控
      // oxlint-disable-next-line no-await-in-loop
      const { chapter, raw } = await readOne(known.itemId, known, opts)
      done.push(chapter)
      if (raw !== undefined) raws.push(raw)
    }
  } catch (e) {
    if (e instanceof FanqieError && done.length) e.partial = formatChapters(done)
    throw e
  }
  return { chapters: done, raw: raws }
}

export async function readById(itemId: string, opts: ReadOptions): Promise<ReadResult> {
  const { chapter, raw } = await readOne(itemId, undefined, opts)
  return { chapters: [chapter], raw: raw === undefined ? [] : [raw] }
}
