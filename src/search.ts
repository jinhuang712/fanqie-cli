import { decoderFor, parseCount, type Decoder } from "./api.ts";
import { pageGet } from "./browser.ts";
import { networkError } from "./errors.ts";
import { fontHashFromHeader } from "./fonts.ts";
import { getJson } from "./http.ts";
import type { Book } from "./types.ts";

const SEARCH_URL = "https://novel.snssdk.com/api/novel/channel/homepage/search/search/v1/";

export interface SearchResult {
  books: Book[];
  hasMore: boolean;
  nextOffset: number;
}

interface RawBook {
  book_id: string;
  title: string;
  author: string;
  category?: string;
  creation_status?: string;
  abstract?: string;
}

export interface RawSearch {
  code: number;
  message?: string;
  data?: { ret_data?: RawBook[]; has_more?: boolean; offset?: number };
}

export function parseSearch(raw: RawSearch): SearchResult {
  if (raw.code !== 0) throw networkError(`搜索失败：code=${raw.code} ${raw.message ?? ""}`.trim());
  const data = raw.data ?? {};
  const books = (data.ret_data ?? []).map((b) => ({
    bookId: b.book_id,
    title: b.title,
    author: b.author,
    category: b.category ?? "",
    // creation_status: "0" 完结，"1" 连载
    finished: b.creation_status === "0",
  }));
  return { books, hasMore: data.has_more ?? false, nextOffset: data.offset ?? 0 };
}

// 移动端搜索接口：不需要登录和签名，只给相关度排序
export async function searchRelevance(
  query: string,
  offset: number,
): Promise<{ result: SearchResult; raw: RawSearch }> {
  const url = new URL(SEARCH_URL);
  url.search = new URLSearchParams({
    device_platform: "android",
    parent_enterfrom: "novel_channel_search.tab.",
    aid: "1967",
    offset: String(offset),
    q: query,
  }).toString();
  const { json } = await getJson<RawSearch>(url.toString(), { auth: false });
  if (!json) throw networkError("搜索没有返回内容，可能被番茄拦截，请稍后重试");
  return { result: parseSearch(json), raw: json };
}

// 网页版搜索：能按最新、最热排序，要签名，所以走浏览器。每页 10 本，最多 300 条
export const WEB_PAGE = 10;

interface RawWebSearch {
  code: number;
  message?: string;
  data?: {
    total_count: number;
    search_book_data_list: Array<{
      book_id: string;
      book_name: string;
      author: string;
      category: string;
      creation_status: number;
      read_count: number;
      word_count: number;
    }>;
  };
}

export function parseWebSearch(raw: RawWebSearch, decode: Decoder, offset: number): SearchResult {
  if (raw.code !== 0 || !raw.data)
    throw networkError(`搜索失败：code=${raw.code} ${raw.message ?? ""}`.trim());
  const books = raw.data.search_book_data_list.map((b) => ({
    bookId: b.book_id,
    title: decode(b.book_name),
    author: decode(b.author),
    category: b.category,
    finished: b.creation_status === 0,
    words: parseCount(String(b.word_count)),
    reads: parseCount(String(b.read_count)),
  }));
  const next = offset + WEB_PAGE;
  return { books, hasMore: next < raw.data.total_count, nextOffset: next };
}

// query_type：0 相关、1 最新、2 最热
const QUERY_TYPE = { new: 1, hot: 2 } as const;

export async function searchWeb(
  query: string,
  sort: "new" | "hot",
  offset: number,
): Promise<{ result: SearchResult; raw: RawWebSearch }> {
  const qs = new URLSearchParams({
    filter: "127,127,127,127",
    page_count: String(WEB_PAGE),
    page_index: String(offset / WEB_PAGE),
    query_type: String(QUERY_TYPE[sort]),
    query_word: query,
  });
  const res = await pageGet(`/api/author/search/search_book/v1?${qs}`);
  let raw: RawWebSearch;
  try {
    raw = JSON.parse(res.text) as RawWebSearch;
  } catch {
    throw networkError(`网页搜索没有返回数据（HTTP ${res.status}），可能被番茄拦截，请稍后重试`);
  }
  const decode = await decoderFor(fontHashFromHeader(res.zhal));
  return { result: parseWebSearch(raw, decode, offset), raw };
}
