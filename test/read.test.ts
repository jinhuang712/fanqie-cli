import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TTL_MS, clearChapters, getCached, putCached } from '../src/cache.ts'
import { MAX_CHAPTERS_PER_READ, parseRange, paragraphsOf, unescapeHtml, formatChapters } from '../src/read.ts'
import { parseCategories } from '../src/book.ts'

test('parseRange 解析单章和范围', () => {
  expect(parseRange('3')).toEqual({ from: 3, to: 3 })
  expect(parseRange('3-5')).toEqual({ from: 3, to: 5 })
  for (const bad of ['0', 'a', '5-3', '3-', '-3', '1,2', '']) {
    expect(() => parseRange(bad)).toThrow()
  }
})

test('parseRange 章数上限：N 章通过，N+1 章报用法错误并给分批例子', () => {
  const n = MAX_CHAPTERS_PER_READ
  expect(parseRange(`11-${10 + n}`)).toEqual({ from: 11, to: 10 + n })
  let err: any
  try {
    parseRange(`11-${11 + n}`)
  } catch (e) {
    err = e
  }
  expect(err?.kind).toBe('usage')
  expect(err.message).toContain(`一次最多读 ${n} 章`)
  expect(err.message).toContain(`read <书ID> 11-${10 + n} 再 read <书ID> ${11 + n}-${10 + 2 * n}`)
})

test('unescapeHtml 还原常见实体', () => {
  expect(unescapeHtml('a&amp;b &lt;c&gt; &quot;d&quot; e&nbsp;f')).toBe('a&b <c> "d" e f')
  expect(unescapeHtml('&#26412;&#x6587;')).toBe('本文')
  expect(unescapeHtml('&unknown;')).toBe('&unknown;')
})

test('paragraphsOf 按段取文字，丢掉插图段和空段', () => {
  const html = '<p>第一段</p><p><img src="x.png"></p><p>  </p><p>第二段<br/>仍是第二段&amp;</p>'
  expect(paragraphsOf(html)).toEqual(['第一段', '第二段仍是第二段&'])
})

test('paragraphsOf 没有 <p> 时按 <br> 分段', () => {
  expect(paragraphsOf('甲<br>乙<br/>丙')).toEqual(['甲', '乙', '丙'])
})

test('formatChapters 每章一行标题，章之间空一行', () => {
  const out = formatChapters([
    { itemId: '1', title: '第1章 甲', text: 'a\nb', fromCache: false },
    { itemId: '2', title: '第2章 乙', text: 'c', fromCache: true },
  ])
  expect(out).toBe('# 第1章 甲\na\nb\n\n# 第2章 乙\nc\n')
})

test('parseCategories 取主分类，其余是标签', () => {
  const v2 = JSON.stringify([
    { Name: '推理', MainCategory: false },
    { Name: '悬疑脑洞', MainCategory: true },
    { Name: '无限流', MainCategory: false },
  ])
  expect(parseCategories(v2)).toEqual({ category: '悬疑脑洞', tags: ['推理', '无限流'] })
  expect(parseCategories('')).toEqual({ category: '', tags: [] })
  expect(parseCategories('not json')).toEqual({ category: '', tags: [] })
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fanqie-cache-'))
  process.env.FANQIE_CACHE_DIR = dir
})
afterEach(() => {
  delete process.env.FANQIE_CACHE_DIR
  rmSync(dir, { recursive: true, force: true })
})

test('缓存：7 天内命中，过期后不命中', () => {
  const now = Date.now()
  putCached({ itemId: '100', title: 't', text: 'x', fetchedAt: now })
  expect(getCached('100', now + TTL_MS - 1000)?.text).toBe('x')
  expect(getCached('100', now + TTL_MS + 1000)).toBeUndefined()
  expect(getCached('不存在')).toBeUndefined()
})

test('缓存：clear 返回删除的章数，之后不再命中', () => {
  putCached({ itemId: '1', title: 'a', text: 'x', fetchedAt: Date.now() })
  putCached({ itemId: '2', title: 'b', text: 'y', fetchedAt: Date.now() })
  expect(clearChapters()).toBe(2)
  expect(getCached('1')).toBeUndefined()
  expect(clearChapters()).toBe(0)
})
