import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retryPolicy } from '../src/http.ts'
import { getToc } from '../src/toc.ts'

const realFetch = globalThis.fetch
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fanqie-toc-'))
  process.env.FANQIE_CACHE_DIR = dir
  process.env.FANQIE_CONFIG_DIR = dir
  retryPolicy.baseMs = 1
  retryPolicy.pinIp = false
  retryPolicy.paceMs = [0, 0]
})
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.FANQIE_CACHE_DIR
  delete process.env.FANQIE_CONFIG_DIR
  retryPolicy.baseMs = 500
  retryPolicy.pinIp = true
  retryPolicy.paceMs = [200, 700]
  rmSync(dir, { recursive: true, force: true })
})

const volumes = [
  [
    { itemId: 'a1', title: '第1章 甲', isChapterLock: false },
    { itemId: 'a2', title: '第2章 乙', isChapterLock: true },
  ],
  [{ itemId: 'b1', title: '第3章 丙', isChapterLock: true }],
]
const pageHtml = `<script>window.__INITIAL_STATE__={"page":{"bookName":"书","chapterListWithVolume":${JSON.stringify(volumes)}}}</script>`

function mockFetch(handler: (url: string) => Response | Error) {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const r = handler(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (r instanceof Error) throw r
    return r
  }) as typeof fetch
}

test('目录接口正常：按卷展平，序号从 1 起，带锁定标记', async () => {
  mockFetch(() => new Response(JSON.stringify({ code: 0, data: { chapterListWithVolume: volumes } })))
  const { chapters } = await getToc('1')
  expect(chapters.map((c) => [c.order, c.itemId, c.locked])).toEqual([
    [1, 'a1', false],
    [2, 'a2', true],
    [3, 'b1', true],
  ])
})

test('目录接口一直被重置：改从书页取同样的目录', async () => {
  mockFetch((url) => (url.includes('/api/reader/directory') ? new Error('socket closed') : new Response(pageHtml)))
  const { chapters } = await getToc('1')
  expect(chapters).toHaveLength(3)
  expect(chapters[2]?.title).toBe('第3章 丙')
})

test('目录接口和书页都失败：报网络错误', async () => {
  mockFetch(() => new Error('socket closed'))
  const err = await getToc('1').catch((e: unknown) => e)
  expect(err).toMatchObject({ kind: 'network' })
})

test('目录是空的：找不到', async () => {
  mockFetch(() => new Response(JSON.stringify({ code: 0, data: { chapterListWithVolume: [] } })))
  const err = await getToc('1').catch((e: unknown) => e)
  expect(err).toMatchObject({ kind: 'notfound' })
})
