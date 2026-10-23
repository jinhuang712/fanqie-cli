import { expect, test } from 'bun:test'
import { mergeSetCookie, cookieHeader, type Jar } from '../src/jar.ts'
import { qrPage } from '../src/qrwindow.ts'
import { parseWebSearch } from '../src/search.ts'

test('parseWebSearch 映射字段，算出是否还有下一页', () => {
  const r = parseWebSearch(
    {
      code: 0,
      data: {
        total_count: 25,
        search_book_data_list: [
          { book_id: '1', book_name: '甲', author: '乙', category: '玄幻,架空', creation_status: 0, read_count: 933355, word_count: 6292901 },
        ],
      },
    },
    (t) => t ?? '',
    10,
  )
  expect(r.books[0]).toMatchObject({ bookId: '1', title: '甲', finished: true, reads: 933355, words: 6292901, category: '玄幻,架空' })
  expect(r.hasMore).toBe(true)
  expect(r.nextOffset).toBe(20)
  const last = parseWebSearch({ code: 0, data: { total_count: 25, search_book_data_list: [] } }, (t) => t ?? '', 20)
  expect(last.hasMore).toBe(false)
})

test('parseWebSearch 在 code 非 0 时抛错', () => {
  expect(() => parseWebSearch({ code: 1, message: 'x' }, (t) => t ?? '', 0)).toThrow('code=1')
})

test('mergeSetCookie 收下新 Cookie，删掉过期的', () => {
  const jar: Jar = { old: '1', keep: '2' }
  const res = new Response(null, {
    headers: [
      ['set-cookie', 'sessionid=abc; Path=/; HttpOnly'],
      ['set-cookie', 'old=; Max-Age=0; Path=/'],
      ['set-cookie', 'gone=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT'],
    ],
  })
  mergeSetCookie(jar, res)
  expect(jar).toEqual({ keep: '2', sessionid: 'abc' })
  expect(cookieHeader(jar)).toBe('keep=2; sessionid=abc')
})

test('二维码页面里有图片和提示文字', () => {
  const html = qrPage('AAAA')
  expect(html).toContain('data:image/png;base64,AAAA')
  expect(html).toContain('扫码')
  expect(html).toContain('notranslate')
  expect(html).toContain('SVIP')
  expect(html).toContain('前 10 章')
})
