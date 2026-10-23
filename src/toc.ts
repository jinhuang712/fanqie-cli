import { apiGet, getPage, type Decoder } from "./api.ts";
import { FanqieError, notFoundError } from "./errors.ts";

export interface Chapter {
  // 在目录里排第几，从 1 起
  order: number;
  itemId: string;
  title: string;
  // 未登录读不全
  locked: boolean;
}

interface RawChapter {
  itemId: string;
  title: string;
  isChapterLock: boolean;
}

interface RawToc {
  code: number;
  data: { chapterListWithVolume: RawChapter[][] };
}

function toChapters(volumes: RawChapter[][] | undefined, decode: Decoder): Chapter[] {
  return (volumes ?? []).flat().map((c, i) => ({
    order: i + 1,
    itemId: c.itemId,
    title: decode(c.title),
    locked: c.isChapterLock,
  }));
}

// 目录接口对大书要返回几百 KB，容易被连接重置。书页的数据里有同样结构的目录，当备用
async function tocFromPage(
  bookId: string,
): Promise<{ chapters: Chapter[]; raw: unknown } | undefined> {
  const { status, state, decode } = await getPage(`/page/${encodeURIComponent(bookId)}`);
  if (status === 404) return undefined;
  const volumes = state.page?.chapterListWithVolume as RawChapter[][] | undefined;
  const chapters = toChapters(volumes, decode);
  return chapters.length ? { chapters, raw: volumes } : undefined;
}

export async function getToc(bookId: string): Promise<{ chapters: Chapter[]; raw: unknown }> {
  let chapters: Chapter[];
  let raw: unknown;
  try {
    const r = await apiGet<RawToc>("/api/reader/directory/detail", { bookId });
    chapters = toChapters(r.raw.data.chapterListWithVolume, r.decode);
    raw = r.raw.data;
  } catch (e) {
    if (!(e instanceof FanqieError) || e.kind !== "network") throw e;
    const fallback = await tocFromPage(bookId).catch(() => undefined);
    if (!fallback) throw e;
    return fallback;
  }
  // 书不存在时接口返回 code 0 和空目录
  if (!chapters.length)
    throw notFoundError(`找不到书籍 ${bookId} 的目录：书不存在、已下架，或没有章节`);
  return { chapters, raw };
}
