// 提前发现"番茄换了新字形"：收集站上当前在用的字体，逐个检查字形表（src/glyphs.json）认不认得。
// 用法：bun run check:fonts（联网）
// 退出码：0 全部认得；1 发现字形表不认得的字形（或找不到任何在用的字体）；2 网络失败（请求或下载字体失败，没能完成检查）。
// CI 靠这个区分"番茄换了新字形"和"海外机器被 CDN 重置连接"。
//
// 这里不走 getFontMap：它会触发 OCR 兜底、写缓存、认得太少时抛错，而检查要的是"字形表本身"的覆盖率。
// 所以自己下载字体，用同一个 buildMap（按轮廓查表）统计，不写任何缓存，也不改 glyphs.json。
import * as fontkit from 'fontkit'
import { buildMap, fontHashFromHeader, isPua } from '../src/fonts.ts'
import { request, SITE } from '../src/http.ts'

const CDN_HOSTS = ['lf6-awef.bytetos.com', 'lf3-awef.bytetos.com']
const PAGES = [
  { name: '首页', url: `${SITE}/` },
  { name: '榜单页', url: `${SITE}/rank` },
  { name: '阅读页', url: `${SITE}/reader/7173216089122439711` },
]
const APIS = [
  {
    name: '分类库接口',
    url: `${SITE}/api/author/library/book_list/v0/?page_count=1&page_index=0&gender=-1&category_id=-1&creation_status=-1&word_count=-1&book_type=-1&sort=0`,
  },
  {
    name: '榜单接口',
    url: `${SITE}/api/rank/category/list?app_id=2503&rank_list_type=3&offset=0&limit=1&category_id=1141&rank_version=&gender=1&rankMold=2`,
  },
]

export interface FontReport {
  hash: string
  sources: string[]
  total: number
  known: number
  unknown: number
  error?: string
  /** error 是下载字体失败（网络问题），不是字形表的问题 */
  network?: boolean
}

// 一个页面可能声明多个字体，所以取全部
export const fontHashesFromHtml = (html: string): string[] => [
  ...new Set([...html.matchAll(/awesome-font\/c\/([0-9a-f]+)/g)].flatMap((m) => (m[1] ? [m[1]] : []))),
]

class DownloadError extends Error {}

async function downloadFont(hash: string): Promise<fontkit.Font> {
  let reason = ''
  for (const host of CDN_HOSTS) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      const res = await request(`https://${host}/obj/awesome-font/c/${hash}.woff2`, { auth: false, retries: 3 })
      if (!res.ok) {
        reason = `HTTP ${res.status}`
        continue
      }
      // oxlint-disable-next-line no-await-in-loop
      return fontkit.create(Buffer.from(await res.arrayBuffer())) as fontkit.Font
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e)
    }
  }
  throw new DownloadError(`下载字体失败：${reason}`)
}

export async function collectHashes(): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>()
  const add = (hash: string, source: string) => {
    const list = found.get(hash) ?? []
    if (!list.includes(source)) list.push(source)
    found.set(hash, list)
  }
  for (const p of PAGES) {
    // oxlint-disable-next-line no-await-in-loop
    const res = await request(p.url, { auth: false })
    // oxlint-disable-next-line no-await-in-loop
    const html = await res.text()
    for (const h of fontHashesFromHtml(html)) add(h, p.name)
    const zh = fontHashFromHeader(res.headers.get('x-tt-zhal'))
    if (zh) add(zh, `${p.name}（响应头）`)
  }
  for (const a of APIS) {
    // oxlint-disable-next-line no-await-in-loop
    const res = await request(a.url, { auth: false })
    // oxlint-disable-next-line no-await-in-loop
    await res.arrayBuffer()
    const h = fontHashFromHeader(res.headers.get('x-tt-zhal'))
    if (h) add(h, a.name)
  }
  return found
}

export async function checkFonts(): Promise<FontReport[]> {
  const hashes = await collectHashes()
  const reports: FontReport[] = []
  for (const [hash, sources] of hashes) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      const font = await downloadFont(hash)
      const total = font.characterSet.filter(isPua).length
      const known = buildMap(font).size
      // 认得太少（getFontMap 里 <100 会抛错）也算不认得，这里只是数出来
      reports.push({ hash, sources, total, known, unknown: total - known })
    } catch (e) {
      reports.push({ hash, sources, total: 0, known: 0, unknown: 0, error: e instanceof Error ? e.message : String(e), network: e instanceof DownloadError })
    }
  }
  return reports
}

export const hasProblem = (reports: FontReport[]): boolean => reports.length === 0 || reports.some((r) => r.unknown > 0 || r.error)

if (import.meta.main) {
  let reports: FontReport[]
  try {
    reports = await checkFonts()
  } catch (e) {
    // 只有请求页面和接口会走到这里：网络失败，不是新字形
    console.error(`网络失败，没能完成检查：${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }
  console.log(['哈希', '来源', '字形数', '认得', '不认得'].join('\t'))
  for (const r of reports) {
    console.log([r.hash, r.sources.join('、'), r.total, r.known, r.error ? `检查失败：${r.error}` : r.unknown].join('\t'))
  }
  if (!reports.length) console.log('没有找到任何在用的字体哈希，检查无法进行')
  const unrecognized = reports.some((r) => r.unknown > 0 || (r.error && !r.network)) || reports.length === 0
  if (!unrecognized && reports.some((r) => r.network)) {
    console.error('下载字体失败，没能完成检查（网络问题，不是新字形）')
    process.exit(2)
  }
  if (hasProblem(reports)) {
    console.log(`
有字体的字形表认不全（或检查失败）。修复办法：
  bun scripts/build-glyphmap.ts <哈希>   重新生成 src/glyphs.json
注意：build-glyphmap 依赖 scripts/vgid-dict.json 的"字形名 -> 汉字"，只在参考字体上可信；
对一个全新字体它可能不适用（字形名是障眼法），用它生成会得到错表。新字形对应的汉字需要人确认：
OCR 可以给出候选（参考 scripts/measure-ocr.ts 的做法），但准确率约 90%，不能不经确认写进字形表。
本脚本不会自动改 glyphs.json。`)
    process.exit(1)
  }
  console.log('站上当前在用的字体，字形表全部认得')
}
