import { apiGet, parseCount } from "./api.ts";
import { coverUrl } from "./cover.ts";
import { formatDate } from "./format.ts";
import { GENDER_PARAM, libraryCategories, resolveCategory, type Gender } from "./categories.ts";

export type Status = "finished" | "ongoing";
export type Words = "lt30" | "30-50" | "50-100" | "100-200" | "gt200";
export type LibrarySort = "hot" | "new" | "words";

// 接口参数：creation_status 0 完结、1 连载；word_count 0 到 4 对应五档；sort 0 最热、1 最新、2 字数
export const STATUS_PARAM: Record<Status, number> = { finished: 0, ongoing: 1 };
export const WORDS_PARAM: Record<Words, number> = {
  lt30: 0,
  "30-50": 1,
  "50-100": 2,
  "100-200": 3,
  gt200: 4,
};
export const SORT_PARAM: Record<LibrarySort, number> = { hot: 0, new: 1, words: 2 };
export const LIBRARY_PAGE = 18;

export interface LibraryBook {
  bookId: string;
  title: string;
  author: string;
  finished: boolean;
  words?: number;
  reads?: number;
  // 接口给的原文，例如 "320.1万字"、"未满1000人在读"
  wordsText: string;
  readsText: string;
  // 以下是后加的字段
  abstract: string;
  coverUrl: string;
  lastUpdate: string;
}

interface RawLibrary {
  code: number;
  data: {
    has_more: boolean;
    total_count: number;
    book_list: Array<{
      book_id: string;
      book_name: string;
      author: string;
      creation_status: number;
      word_count: string;
      read_count: string;
      abstract?: string;
      thumb_uri?: string;
      last_chapter_time?: string;
    }>;
  };
}

export interface LibraryFilter {
  gender?: Gender;
  category?: string;
  status?: Status;
  words?: Words;
  sort: LibrarySort;
  page: number;
}

export interface LibraryResult {
  page: number;
  hasMore: boolean;
  books: LibraryBook[];
  raw: unknown;
}

export async function library(f: LibraryFilter): Promise<LibraryResult> {
  let categoryId = "-1";
  if (f.category) {
    const { categories } = await libraryCategories(f.gender);
    categoryId = resolveCategory(categories, f.category, "fanqie categories --for library").id;
  }
  const { raw, decode } = await apiGet<RawLibrary>("/api/author/library/book_list/v0/", {
    page_count: LIBRARY_PAGE,
    page_index: f.page - 1,
    gender: f.gender ? GENDER_PARAM[f.gender] : -1,
    category_id: categoryId,
    creation_status: f.status ? STATUS_PARAM[f.status] : -1,
    word_count: f.words ? WORDS_PARAM[f.words] : -1,
    book_type: -1,
    sort: SORT_PARAM[f.sort],
  });
  const books = raw.data.book_list.map((b) => {
    const wordsText = decode(b.word_count);
    const readsText = decode(b.read_count);
    return {
      bookId: b.book_id,
      title: decode(b.book_name),
      author: decode(b.author),
      finished: b.creation_status === 0,
      words: parseCount(wordsText),
      reads: parseCount(readsText),
      wordsText,
      readsText,
      abstract: decode(b.abstract).trim(),
      coverUrl: coverUrl(b.thumb_uri),
      lastUpdate: formatDate(b.last_chapter_time),
    };
  });
  return { page: f.page, hasMore: raw.data.has_more, books, raw };
}
