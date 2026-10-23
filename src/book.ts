import { getPage, parseCount } from "./api.ts";
import { notFoundError } from "./errors.ts";
import { formatDate } from "./format.ts";

export interface BookInfo {
  bookId: string;
  title: string;
  author: string;
  category: string;
  tags: string[];
  finished: boolean;
  words?: number;
  reads?: number;
  chapterTotal: number;
  lastChapterTitle: string;
  lastUpdate: string;
  abstract: string;
  // 当前账号读不全的章节数。没有登录、或没有 SVIP 的账号，前 10 章左右之外的章节都是锁定的
  freeChapters: number;
  lockedChapters: number;
}

export const SVIP_NOTICE = "网页版读前 10 章左右之外的章节，要登录并开通 SVIP 会员";

// 书页数据里带着每章的锁定标记
export function lockSummary(volumes: unknown): { free: number; locked: number } {
  const flat = Array.isArray(volumes)
    ? (volumes as Array<Array<{ isChapterLock?: boolean }>>).flat()
    : [];
  const locked = flat.filter((c) => c.isChapterLock).length;
  return { free: flat.length - locked, locked };
}

interface RawCategory {
  Name: string;
  MainCategory: boolean;
}

// categoryV2 是 JSON 字符串：主分类带 MainCategory，其余是标签
export function parseCategories(categoryV2: unknown): { category: string; tags: string[] } {
  let list: RawCategory[] = [];
  try {
    list =
      typeof categoryV2 === "string" && categoryV2 ? (JSON.parse(categoryV2) as RawCategory[]) : [];
  } catch {
    list = [];
  }
  const main = list.find((c) => c.MainCategory) ?? list[0];
  return { category: main?.Name ?? "", tags: list.filter((c) => c !== main).map((c) => c.Name) };
}

export async function getBook(bookId: string): Promise<{ book: BookInfo; raw: unknown }> {
  const { status, state, decode } = await getPage(`/page/${encodeURIComponent(bookId)}`);
  // 不存在、已下架、出版付费书，网页都是 404；也有 200 但没有书名的情况
  const p = state.page as Record<string, any> | undefined;
  if (status === 404 || !p?.bookName) {
    throw notFoundError(`找不到书籍 ${bookId}：书不存在、已下架，或是网页不提供的出版付费书`);
  }
  const { category, tags } = parseCategories(p.categoryV2);
  const { free, locked } = lockSummary(p.chapterListWithVolume);
  const book: BookInfo = {
    bookId: String(p.bookId ?? bookId),
    title: decode(p.bookName),
    author: decode(p.author),
    category,
    tags,
    finished: String(p.creationStatus) === "0",
    words: parseCount(String(p.wordNumber ?? "")),
    reads: parseCount(String(p.readCount ?? "")),
    chapterTotal: Number(p.chapterTotal ?? 0),
    lastChapterTitle: decode(p.lastChapterTitle),
    lastUpdate: formatDate(p.lastPublishTime),
    abstract: decode(p.abstract).trim(),
    freeChapters: free,
    lockedChapters: locked,
  };
  return { book, raw: p };
}
