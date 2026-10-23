// 联网回归测试：对应 GOALS.md 的 G1 到 G6。默认不跑，用 `bun run test:live`。
// G7 需要用户自己的 SVIP 账号，不能自动测，见 scripts/check-login.ts。
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import glyphs from '../src/glyphs.json' with { type: 'json' }
import { countPua, getFontMap, ocrGuesses } from '../src/fonts.ts'
import { ocrAvailable } from '../src/ocr.ts'
import samples from './samples.json' with { type: 'json' }

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts')
const live = Boolean(process.env.FANQIE_LIVE)
const BOOK = '7143038691944959011' // 十日终焉：前 10 章免费，第 11 章起要 SVIP
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let cache: string
let config: string
beforeAll(() => {
  cache = mkdtempSync(join(tmpdir(), 'fq-live-cache-'))
  // 空的配置目录：保证是未登录状态，不碰用户真实的登录态
  config = mkdtempSync(join(tmpdir(), 'fq-live-config-'))
})
afterAll(() => {
  rmSync(cache, { recursive: true, force: true })
  rmSync(config, { recursive: true, force: true })
})

async function run(...args: string[]) {
  const p = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FANQIE_CACHE_DIR: cache, FANQIE_CONFIG_DIR: config },
  })
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { code: await p.exited, stdout, stderr }
}

describe.skipIf(!live)('G1 三类找书入口都能用', () => {
  const cases: Array<[string, string[]]> = [
    ['search', ['search', '修仙']],
    ['search --sort hot', ['search', '修仙', '--sort', 'hot']],
    ['rank', ['rank', '--category', '西方奇幻']],
    ['library', ['library', '--category', '悬疑脑洞']],
    ['categories', ['categories']],
  ]
  for (const [name, args] of cases) {
    test(name, async () => {
      const r = await run(...args)
      expect(r.code).toBe(0)
      expect(r.stdout).toMatch(/^- /m)
      expect(r.stdout).not.toContain('# 没有结果')
    }, 90_000)
  }
})

describe.skipIf(!live)('G2 搜索命中目标书', () => {
  test('样本书名搜索，目标书进前 3 条的比例', async () => {
    const { searchRelevance } = await import('../src/search.ts')
    let hit = 0
    const missed: string[] = []
    for (const b of samples.books) {
      // oxlint-disable-next-line no-await-in-loop
      const { result } = await searchRelevance(b.title, 0)
      if (result.books.slice(0, 3).some((x) => x.bookId === b.id)) hit++
      else missed.push(b.title)
      // oxlint-disable-next-line no-await-in-loop
      await sleep(300)
    }
    const rate = hit / samples.books.length
    console.log(`G2 命中率 ${hit}/${samples.books.length} = ${(rate * 100).toFixed(0)}%`, missed.length ? `未命中：${missed.join('、')}` : '')
    // 阈值 100%（用户定的）：样本集的书全部要在前 3 条里
    expect(missed).toEqual([])
    expect(rate).toBe(1)
  }, 180_000)
})

describe.skipIf(!live)('G3 输出无乱码', () => {
  test('找书、详情、目录的输出没有私有区字符', async () => {
    for (const args of [
      ['search', '修仙'],
      ['search', '修仙', '--sort', 'new'],
      ['rank', '--category', '西方奇幻', '--gender', 'male'],
      ['rank', '--category', '古风世情', '--gender', 'female', '--kind', 'new'],
      ['library', '--sort', 'new'],
      ['categories', '--for', 'library'],
      ['book', BOOK],
      ['toc', BOOK],
    ]) {
      // oxlint-disable-next-line no-await-in-loop
      const r = await run(...args)
      // 失败时说清是哪条命令、什么错误，网络问题才好排查
      if (r.code !== 0) throw new Error(`fanqie ${args.join(' ')} 退出码 ${r.code}：${r.stderr.slice(0, 300)}`)
      expect(countPua(r.stdout)).toBe(0)
      expect(r.stderr).not.toContain('警告')
    }
  }, 240_000)

  test('10 本样本书的前 3 章：正文没有私有区字符，长度正常', async () => {
    // 出版书网页不提供，读不了，不在 G3 的样本里
    const readable = samples.books.filter((b) => (b as { readable?: boolean }).readable !== false).slice(0, 10)
    for (const b of readable) {
      // oxlint-disable-next-line no-await-in-loop
      const r = await run('read', b.id, '1-3')
      if (r.code !== 0) throw new Error(`fanqie read ${b.id}（${b.title}）1-3 退出码 ${r.code}：${r.stderr.slice(0, 300)}`)
      expect(countPua(r.stdout)).toBe(0)
      expect(r.stderr).not.toContain('警告')
      expect(r.stdout.match(/^# /gm)?.length).toBe(3)
      expect(r.stdout.length).toBeGreaterThan(900)
    }
  }, 300_000)
})

describe.skipIf(!live)('G3 字体检查', () => {
  test('站上当前用到的字体，字形表全部认得', async () => {
    const { checkFonts } = await import('../scripts/check-fonts.ts')
    const reports = await checkFonts()
    expect(reports.length).toBeGreaterThan(0)
    for (const r of reports) {
      if (r.error || r.unknown > 0) throw new Error(`字体 ${r.hash}（${r.sources.join('、')}）${r.error ?? `有 ${r.unknown} 个字形字形表不认得`}`)
    }
  }, 120_000)
})

describe.skipIf(!live)('G4 读过的章节不再联网', () => {
  test('同一章第二次读取：0 次网络请求', async () => {
    process.env.FANQIE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'fq-g4-'))
    process.env.FANQIE_CONFIG_DIR = config
    const { readRange } = await import('../src/read.ts')
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = ((...a: Parameters<typeof fetch>) => {
      calls++
      return realFetch(...a)
    }) as typeof fetch
    try {
      const first = await readRange(BOOK, '2', { refresh: false, raw: false })
      const firstCalls = calls
      calls = 0
      const second = await readRange(BOOK, '2', { refresh: false, raw: false })
      console.log(`G4 第一次 ${firstCalls} 次请求，第二次 ${calls} 次`)
      expect(firstCalls).toBeGreaterThan(0)
      expect(calls).toBe(0)
      expect(second.chapters[0]?.fromCache).toBe(true)
      expect(second.chapters[0]?.text).toBe(first.chapters[0]?.text)
    } finally {
      globalThis.fetch = realFetch
      rmSync(process.env.FANQIE_CACHE_DIR, { recursive: true, force: true })
      process.env.FANQIE_CACHE_DIR = undefined as unknown as string
      delete process.env.FANQIE_CACHE_DIR
    }
  }, 90_000)
})

describe.skipIf(!live)('G6 输出能被程序读取', () => {
  const ok: Array<[string, string[]]> = [
    ['search', ['search', '修仙']],
    ['search --sort hot', ['search', '修仙', '--sort', 'hot']],
    ['rank', ['rank', '--category', '西方奇幻']],
    ['library', ['library']],
    ['categories', ['categories']],
    ['book', ['book', BOOK]],
    ['toc', ['toc', BOOK]],
    ['read', ['read', BOOK, '1']],
    ['whoami', ['whoami']],
    ['cache clear', ['cache', 'clear']],
  ]
  for (const [name, args] of ok) {
    test(`${name}：--json 和 --raw 都是合法 JSON`, async () => {
      for (const flag of ['--json', '--raw']) {
        // oxlint-disable-next-line no-await-in-loop
        const r = await run(...args, flag)
        expect(r.code).toBe(0)
        expect(() => JSON.parse(r.stdout)).not.toThrow()
      }
    }, 120_000)
  }

  const failures: Array<[string, string[], number]> = [
    ['缺参数', ['search'], 1],
    ['榜单缺分类', ['rank'], 1],
    ['书籍 ID 不是数字', ['book', 'abc'], 1],
    ['书不存在', ['book', '1'], 3],
    ['目录：书不存在', ['toc', '7143038691944959012'], 3],
    ['章节超出目录', ['read', BOOK, '9999'], 3],
    ['章节 ID 不存在', ['read', '--id', '1'], 3],
    ['分类不存在', ['rank', '--category', '不存在'], 3],
    ['要 SVIP 的章节', ['read', BOOK, '11'], 4],
  ]
  for (const [name, args, code] of failures) {
    test(`失败：${name}，退出码 ${code}，--json 时 stdout 为空`, async () => {
      const r = await run(...args, '--json')
      expect(r.code).toBe(code)
      expect(r.stdout).toBe('')
      expect(r.stderr.length).toBeGreaterThan(0)
    }, 90_000)
  }

  test('读多章中途遇到锁定章节：文本模式先输出已读到的，JSON 模式 stdout 为空', async () => {
    const text = await run('read', BOOK, '9-11')
    expect(text.code).toBe(4)
    expect(text.stdout).toContain('# 第9章')
    expect(text.stdout).toContain('# 第10章')
    expect(text.stdout).not.toContain('# 第11章')
    const json = await run('read', BOOK, '9-11', '--json')
    expect(json.code).toBe(4)
    expect(json.stdout).toBe('')
  }, 120_000)

  test('网络不通：退出码 2', async () => {
    const p = Bun.spawn(['bun', CLI, 'book', BOOK], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FANQIE_CACHE_DIR: cache, FANQIE_CONFIG_DIR: config, HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' },
    })
    expect(await p.exited).toBe(2)
    expect(await new Response(p.stdout).text()).toBe('')
  }, 60_000)
})

describe.skipIf(!live || !ocrAvailable())('OCR 兜底', () => {
  test('字形表里缺了 12 个字形，getFontMap 用 OCR 现场补回来，大部分是对的', async () => {
    const REF_FONT = 'dc027189e0ba4cd'
    const table = glyphs as Record<string, string>
    const saved = { ...table }
    process.env.FANQIE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'fq-ocr-'))
    try {
      // 先在不缺的情况下取一次，得到标准答案；再清缓存，拿掉 12 个字形重新取
      const truth = await getFontMap(REF_FONT)
      rmSync(join(process.env.FANQIE_CACHE_DIR, 'fonts'), { recursive: true, force: true })
      const keys = Object.keys(table)
        .toSorted(() => Math.random() - 0.5)
        .slice(0, 12)
      for (const k of keys) delete table[k]
      const map = await getFontMap(REF_FONT)
      let right = 0
      for (const [cp, ch] of truth) if (map.get(cp) === ch) right++
      console.log(`OCR 兜底：${ocrGuesses(REF_FONT)} 个字形靠 OCR 认出，全部 ${truth.size} 个字里正确 ${right} 个`)
      expect(ocrGuesses(REF_FONT)).toBeGreaterThanOrEqual(8)
      // 12 个里至少对 9 个
      expect(right).toBeGreaterThanOrEqual(truth.size - 3)
    } finally {
      Object.assign(table, saved)
      rmSync(process.env.FANQIE_CACHE_DIR, { recursive: true, force: true })
      delete process.env.FANQIE_CACHE_DIR
    }
  }, 300_000)
})
