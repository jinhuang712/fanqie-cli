import * as fontkit from 'fontkit'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import glyphs from './glyphs.json' with { type: 'json' }
import { networkError } from './errors.ts'
import { request } from './http.ts'
import { ocrAvailable, ocrGlyphs } from './ocr.ts'
import { cacheDir } from './paths.ts'

// 番茄把高频汉字、数字、字母换成私有区字符，再用自定义字体显示。
// 每个页面、每个接口用的字体不同，字体里"码位 -> 字形"的排布也不同，字形名是障眼法，
// 只有字形轮廓可信。所以：
//   1. 响应告诉我们用哪个字体（页面里的 @font-face，或响应头 x-tt-zhal 的 f=）；
//   2. 下载这个字体，按轮廓查 glyphs.json（轮廓 -> 汉字），得到本次的"码位 -> 汉字"；
//   3. 字体文件按哈希永久缓存，因为哈希相同内容就相同。
// glyphs.json 由 scripts/build-glyphmap.ts 生成。番茄换了新字形时，还原不了的字符会
// 留在文本里并被计数，test/live.test.ts 的真实页面回归测试会发现。

export type FontMap = Map<number, string>

const PUA_START = 0xe000
const PUA_END = 0xf8ff
const GLYPHS: Record<string, string> = glyphs
// 字体里认出的字形少于这个数，就不是一个正常的映射
const MIN_GLYPHS = 100
const CDN_HOSTS = ['lf6-awef.bytetos.com', 'lf3-awef.bytetos.com']

export interface Decoded {
  text: string
  // 还原不了、仍留在文本里的私有区字符个数
  unmapped: number
}

export const isPua = (cp: number): boolean => cp >= PUA_START && cp <= PUA_END

export function countPua(text: string): number {
  let n = 0
  for (const ch of text) if (isPua(ch.codePointAt(0)!)) n++
  return n
}

export function outlineKey(font: fontkit.Font, cp: number): string {
  const commands = font.glyphForCodePoint(cp).path.commands
  return createHash('md5').update(JSON.stringify(commands)).digest('hex').slice(0, 12)
}

// 靠 OCR 认出来的字形个数，按字体哈希记。调用方据此提示用户"可能有少量错字"
const ocrByHash = new Map<string, number>()
export const ocrGuesses = (hash: string | undefined): number => (hash ? (ocrByHash.get(hash) ?? 0) : 0)

// 兜底：字体里有字形表里没有的新字形时，用 OCR 认。新字体只是把同样的字重新排列，
// 所以候选只可能是"字形表里还没被这个字体用掉的字"。准确率约 90%（scripts/measure-ocr.ts 量过），
// 不是确定的，所以结果只留在这个字体的缓存里，不进全局字形表，免得错字扩散
export async function recoverWithOcr(font: fontkit.Font, map: FontMap): Promise<number[]> {
  if (!ocrAvailable()) return []
  const missing = font.characterSet.filter((cp) => isPua(cp) && !map.has(cp))
  if (!missing.length) return []
  const used = new Set(map.values())
  const allowed = new Set(Object.values(GLYPHS).filter((c) => !used.has(c)))
  try {
    const got = await ocrGlyphs(font, missing, allowed)
    for (const [cp, ch] of got) map.set(cp, ch)
    return [...got.keys()]
  } catch {
    return []
  }
}

export function buildMap(font: fontkit.Font): FontMap {
  const map: FontMap = new Map()
  for (const cp of font.characterSet) {
    if (!isPua(cp)) continue
    const ch = GLYPHS[outlineKey(font, cp)]
    if (ch) map.set(cp, ch)
  }
  return map
}

// 页面 HTML 里的 @font-face：.../awesome-font/c/<哈希>.woff2
// 同时认 <style> 里的写法，和状态 JSON 里转义过的写法（awesome-font\u002Fc\u002F<哈希>）
export const fontHashFromHtml = (html: string): string | undefined =>
  /awesome-font(?:\/|\\u002F)c(?:\/|\\u002F)([0-9a-f]+)/i.exec(html)?.[1]

// 响应头 x-tt-zhal：k=<字体族名>;f=<哈希>;d1=...;d2=...
export const fontHashFromHeader = (zhal: string | null | undefined): string | undefined =>
  zhal ? /(?:^|;)f=([0-9a-f]+)/.exec(zhal)?.[1] : undefined

const mapPath = (hash: string) => join(cacheDir(), 'fonts', `${hash}.json`)

// 读缓存里的字体映射。文件不存在、读不出来、或者映射是空的（空映射会让整章不还原），都当作没有，
// 并把坏文件删掉，调用方重新下载
export function readStoredMap(path: string): { map: FontMap; ocr: number } | undefined {
  if (!existsSync(path)) return undefined
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { map?: Record<string, string>; ocr?: number[] } & Record<string, unknown>
    // 旧格式是直接的 { 码位: 字 }
    const entries = Object.entries((stored.map ?? stored) as Record<string, string>)
    if (entries.length < MIN_GLYPHS) throw new Error('映射太少')
    return { map: new Map(entries.map(([cp, ch]) => [Number(cp), ch])), ocr: stored.ocr?.length ?? 0 }
  } catch {
    rmSync(path, { force: true })
    return undefined
  }
}

export async function getFontMap(hash: string): Promise<FontMap> {
  const path = mapPath(hash)
  const stored = readStoredMap(path)
  if (stored) {
    if (stored.ocr) ocrByHash.set(hash, stored.ocr)
    return stored.map
  }
  let reason = ''
  // 两个 CDN 域名轮流试，连接重试由 request 负责
  for (const host of CDN_HOSTS) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      const res = await request(`https://${host}/obj/awesome-font/c/${hash}.woff2`, { auth: false, retries: 3 })
      if (!res.ok) {
        reason = `HTTP ${res.status}`
        continue
      }
      // oxlint-disable-next-line no-await-in-loop
      const font = fontkit.create(Buffer.from(await res.arrayBuffer())) as fontkit.Font
      const map = buildMap(font)
      // oxlint-disable-next-line no-await-in-loop
      const guessed = await recoverWithOcr(font, map)
      if (guessed.length) ocrByHash.set(hash, guessed.length)
      if (map.size < MIN_GLYPHS) throw networkError(`字体 ${hash} 里认出的字形太少（${map.size}），字形表可能需要更新`)
      mkdirSync(join(cacheDir(), 'fonts'), { recursive: true })
      // 先写临时文件再改名：别的进程不会读到写了一半的文件
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify({ map: Object.fromEntries(map), ocr: guessed }))
      renameSync(tmp, path)
      return map
    } catch (e) {
      if (e instanceof Error && e.message.includes('字形')) throw e
      reason = e instanceof Error ? e.message : String(e)
    }
  }
  throw networkError(`下载字体 ${hash} 失败：${reason}`)
}

export function decode(text: string, map: FontMap | undefined): Decoded {
  if (!map || !text) return { text, unmapped: countPua(text) }
  let out = ''
  for (const ch of text) out += map.get(ch.codePointAt(0)!) ?? ch
  return { text: out, unmapped: countPua(out) }
}

// 测试用：把明文按给定映射反向编码成私有区字符
export function encodeForTest(text: string, map: FontMap): string {
  const reverse = new Map([...map].map(([cp, ch]) => [ch, cp]))
  let out = ''
  for (const ch of text) {
    const cp = reverse.get(ch)
    out += cp === undefined ? ch : String.fromCodePoint(cp)
  }
  return out
}
