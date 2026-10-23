import { apiGet, parseCount } from './api.ts'
import { GENDER_PARAM, rankCategories, resolveCategory, type Gender } from './categories.ts'

export type RankKind = 'read' | 'new'

// 阅读榜 rankMold=2，新书榜 rankMold=1（对应网页菜单顺序和请求参数）
const MOLD: Record<RankKind, number> = { read: 2, new: 1 }
export const RANK_PAGE = 10

export interface RankBook {
  rank: number
  bookId: string
  title: string
  author: string
  finished: boolean
  words?: number
  reads?: number
  lastChapterTitle: string
}

interface RawRank {
  code: number
  data: {
    total_num: number
    book_list: Array<{
      bookId: string
      bookName: string
      author: string
      creationStatus: string
      wordNumber: string
      read_count: string
      lastChapterTitle: string
    }>
  }
}

export interface RankResult {
  gender: Gender
  kind: RankKind
  category: string
  offset: number
  total: number
  books: RankBook[]
  raw: unknown
}

export async function rank(gender: Gender, kind: RankKind, categoryInput: string, offset: number): Promise<RankResult> {
  // 榜单分类按读者分开，同一个 ID 在两边可能是不同的分类
  const { categories } = await rankCategories(gender)
  const category = resolveCategory(categories, categoryInput, `fanqie categories --for rank --gender ${gender}`)
  const { raw, decode } = await apiGet<RawRank>('/api/rank/category/list', {
    app_id: 2503,
    rank_list_type: 3,
    offset,
    limit: RANK_PAGE,
    category_id: category.id,
    rank_version: '',
    gender: GENDER_PARAM[gender],
    rankMold: MOLD[kind],
  })
  const books = raw.data.book_list.map((b, i) => ({
    rank: offset + i + 1,
    bookId: b.bookId,
    title: decode(b.bookName),
    author: decode(b.author),
    // creationStatus: "0" 完结，"1" 连载
    finished: b.creationStatus === '0',
    words: parseCount(b.wordNumber),
    reads: parseCount(b.read_count),
    lastChapterTitle: decode(b.lastChapterTitle),
  }))
  return { gender, kind, category: category.name, offset, total: raw.data.total_num, books, raw }
}
