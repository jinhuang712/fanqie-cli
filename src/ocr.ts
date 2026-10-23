import * as fontkit from 'fontkit'
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheDir } from './paths.ts'
import { findChrome } from './qrwindow.ts'

// 兜底：字体里出现字形表（src/glyphs.json）里没有的新字形时，把这个字形渲染成一张大图，
// 用 macOS 自带的 Vision 文字识别认出来。只在 macOS 上有；识别结果不一定对，调用方要告诉用户。
//
// 为什么不整页截图：整页 OCR 要在几千字里把识别结果对回到具体的私有区字符，
// 逐个字形渲染则一张图就是一个字，不存在对不回去的问题。

const REPEAT = 3
const CELL = 120

const SWIFT_SOURCE = `import Foundation
import Vision
import AppKit

var out: [String: [String]] = [:]
for path in CommandLine.arguments.dropFirst() {
  guard let img = NSImage(contentsOfFile: path),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { out[path] = []; continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  req.recognitionLanguages = ["zh-Hans", "en-US"]
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  try? handler.perform([req])
  out[path] = (req.results ?? []).flatMap { $0.topCandidates(5).map { $0.string } }
}
let data = try JSONSerialization.data(withJSONObject: out)
print(String(data: data, encoding: .utf8)!)
`

export const ocrAvailable = (): boolean =>
  process.platform === 'darwin' && Boolean(Bun.which('swiftc')) && !process.env.FANQIE_NO_OCR

// 第一次用时把 Swift 小程序编译到缓存目录，以后直接用
async function helperPath(): Promise<string> {
  const dir = join(cacheDir(), 'bin')
  const bin = join(dir, 'ocr')
  const src = join(dir, 'ocr.swift')
  mkdirSync(dir, { recursive: true })
  if (existsSync(bin) && existsSync(src) && readFileSync(src, 'utf8') === SWIFT_SOURCE) return bin
  writeFileSync(src, SWIFT_SOURCE)
  const p = Bun.spawn(['swiftc', '-O', src, '-o', bin], { stdout: 'ignore', stderr: 'pipe' })
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited])
  if (code !== 0) throw new Error(`编译 OCR 小程序失败：${err.slice(0, 300)}`)
  return bin
}

async function recognize(paths: string[]): Promise<Record<string, string[]>> {
  const bin = await helperPath()
  const p = Bun.spawn([bin, ...paths], { stdout: 'pipe', stderr: 'ignore' })
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited])
  if (code !== 0) throw new Error('OCR 小程序运行失败')
  return JSON.parse(out) as Record<string, string[]>
}

// 把每个字形画成 SVG（字形轮廓来自字体本身），再用无头 Chrome 截图
async function renderGlyphs(font: fontkit.Font, cps: number[], dir: string): Promise<Map<number, string>> {
  const executablePath = findChrome()
  if (!executablePath) throw new Error('没有找到 Chrome 或 Edge')
  const upm = font.unitsPerEm
  const cells = cps
    .map((cp) => {
      const d = font.glyphForCodePoint(cp).path.toSVG()
      // 同一个字形在一行里画 REPEAT 次：Vision 更擅长认一行文字，单独一个字常常认不出。
      // 字体坐标 y 向上，SVG 向下，所以翻转；字与字之间、四周留白
      const unit = 1.3 * upm
      const glyph = Array.from(
        { length: REPEAT },
        (_, i) => `<path d="${d}" transform="translate(${i * unit},0) scale(1,-1)" fill="#000"/>`,
      ).join('')
      return `<svg id="g${cp}" width="${CELL * REPEAT}" height="${CELL}" viewBox="${-0.15 * upm} ${-0.95 * upm} ${unit * REPEAT} ${unit}" style="background:#fff">${glyph}</svg>`
    })
    .join('')
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 })
    await page.setContent(`<body style="margin:0;background:#fff">${cells}</body>`)
    const files = new Map<number, string>()
    for (const cp of cps) {
      const file = join(dir, `${cp}.png`)
      // oxlint-disable-next-line no-await-in-loop
      await page.locator(`#g${cp}`).screenshot({ path: file })
      files.set(cp, file)
    }
    return files
  } finally {
    await browser.close()
  }
}

// 返回每个码位识别出的单个字符；认不出的不返回。
// allowed：新字体只是把同样的字重新排列，所以没认出的字形只可能是"字形表里还没被占用的字"，
// 在这个小集合里挑，比不加限制准得多。候选里一个都不在集合里时，再用不加限制的多数票
export async function ocrGlyphs(font: fontkit.Font, cps: number[], allowed?: Set<string>): Promise<Map<number, string>> {
  if (!cps.length) return new Map()
  const dir = mkdtempSync(join(tmpdir(), 'fanqie-ocr-'))
  try {
    const files = await renderGlyphs(font, cps, dir)
    const candidates = await recognize([...files.values()])
    const out = new Map<number, string>()
    for (const [cp, file] of files) {
      const ch = pickChar(candidates[file] ?? [], allowed)
      if (ch) out.set(cp, ch)
    }
    return out
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// 一行里画了 REPEAT 次同一个字形，候选字符串里每个字符按出现次数计分，靠前的候选分更高。
// 至少要拿到 2 分，否则不采用
export function pickChar(candidates: string[], allowed?: Set<string>): string | undefined {
  const score = new Map<string, number>()
  candidates.forEach((text, i) => {
    // topCandidates(5) 展平后，每 5 个是一个观察的候选；排名靠前的权重大
    const weight = 5 - (i % 5)
    for (const c of text.replace(/\s+/g, '')) score.set(c, (score.get(c) ?? 0) + weight)
  })
  const ranked = [...score].toSorted((a, b) => b[1] - a[1])
  const pick = (list: Array<[string, number]>) => (list[0] && list[0][1] >= 2 ? list[0][0] : undefined)
  return (allowed ? pick(ranked.filter(([c]) => allowed.has(c))) : undefined) ?? pick(ranked)
}
