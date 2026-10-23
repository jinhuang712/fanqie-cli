import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { networkError } from './errors.ts'
import { cacheDir } from './paths.ts'
import { decode, fontHashFromHeader, fontHashFromHtml, getFontMap, ocrGuesses, type FontMap } from './fonts.ts'
import { SITE, getText, request } from './http.ts'
import { extractState } from './state.ts'

// 一次命令里所有还原不了的私有区字符，命令结束时在 stderr 警告一次
let unmappedTotal = 0
export const unmappedCount = (): number => unmappedTotal
// 调用方丢弃了一次还原结果（比如重新取了页面）时，把它的计数减掉
export const forgetUnmapped = (n: number): void => {
  unmappedTotal = Math.max(0, unmappedTotal - n)
}

export interface Decoder {
  (text: string | undefined | null): string
}

export async function decoderFor(hash: string | undefined): Promise<Decoder> {
  const map: FontMap | undefined = hash ? await getFontMap(hash) : undefined
  const guessed = ocrGuesses(hash)
  if (guessed > 0) process.stderr.write(`提示：这个字体里有 ${guessed} 个新字形是用 OCR 认出来的，约 10% 可能认错，少数字可能不对\n`)
  if (process.env.FANQIE_DEBUG) process.stderr.write(`[fanqie] 字体 ${hash ?? '（没有）'}，认出 ${map?.size ?? 0} 个字形\n`)
  return (text) => {
    const r = decode(text ?? '', map)
    unmappedTotal += r.unmapped
    return r.text
  }
}

interface Envelope {
  code?: number
  message?: string
  data?: unknown
}

export interface ApiResult<T> {
  raw: T
  decode: Decoder
}

// 番茄接口的统一壳：{ code, message, data }。响应头 x-tt-zhal 指明文字用的字体
export async function apiGet<T extends Envelope>(path: string, params: Record<string, string | number> = {}): Promise<ApiResult<T>> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  const res = await request(`${SITE}${path}${qs ? `?${qs}` : ''}`)
  const text = await res.text()
  let raw: T
  try {
    raw = JSON.parse(text) as T
  } catch {
    // 被拦截时服务端返回 200 和空内容，或者一个 HTML 页面
    throw networkError(`接口 ${path} 没有返回数据（HTTP ${res.status}），可能被番茄拦截，请稍后重试`)
  }
  if (raw.code !== 0) throw networkError(`接口 ${path} 返回 code=${raw.code} ${raw.message ?? ''}`.trim())
  return { raw, decode: await decoderFor(fontHashFromHeader(res.headers.get('x-tt-zhal'))) }
}

// 页面里有私有区字符，却找不到字体：把这一页存下来，下次出现就能直接看到
function dumpMissingFont(path: string, html: string, zhal: string | null): void {
  try {
    const dir = join(cacheDir(), 'debug')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `missing-font-${Date.now()}.html`)
    writeFileSync(file, `<!-- path: ${path}\n     x-tt-zhal: ${zhal ?? '（没有）'} -->\n${html}`)
    process.stderr.write(`提示：${path} 页面里有加密文字，却没找到字体声明；已把这一页存到 ${file}\n`)
  } catch {
    // 存不下来不影响命令
  }
}

export interface PageResult {
  status: number
  state: Record<string, any>
  decode: Decoder
}

// 取一个网页，解析里面的 __INITIAL_STATE__，字体取页面 @font-face 里的
export async function getPage(path: string): Promise<PageResult> {
  const { status, text, zhal } = await getText(`${SITE}${path}`)
  if (status === 404) return { status, state: {}, decode: await decoderFor(undefined) }
  // 字体哈希：页面里的 @font-face，缺了就用响应头 x-tt-zhal（阅读页上它直接是那段 CSS，也带哈希）
  const hash = fontHashFromHtml(text) ?? fontHashFromHtml(zhal ?? '') ?? fontHashFromHeader(zhal)
  if (!hash && /[\ue000-\uf8ff]/.test(text)) dumpMissingFont(path, text, zhal)
  return { status, state: extractState(text), decode: await decoderFor(hash) }
}

// "320.1万字" -> 3201000；"未满1000人在读" 这类没有确切数字的返回 undefined
export function parseCount(text: string): number | undefined {
  const m = /^([\d.]+)(万|亿)?/.exec(text.trim())
  if (!m) return undefined
  const n = Number(m[1]) * (m[2] === '万' ? 10_000 : m[2] === '亿' ? 100_000_000 : 1)
  return Number.isFinite(n) ? Math.round(n) : undefined
}
