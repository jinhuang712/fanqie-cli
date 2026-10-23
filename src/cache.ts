import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./paths.ts";

// 已发布的章节很少改，期限固定 7 天
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedChapter {
  itemId: string;
  order?: number;
  title: string;
  text: string;
  fetchedAt: number;
}

const chaptersDir = () => join(cacheDir(), "chapters");
const indexDir = () => join(cacheDir(), "index");
const pathOf = (itemId: string) =>
  join(chaptersDir(), `${itemId.replace(/[^0-9A-Za-z_-]/g, "_")}.json`);

export function getCached(itemId: string, now = Date.now()): CachedChapter | undefined {
  try {
    const c = JSON.parse(readFileSync(pathOf(itemId), "utf8")) as CachedChapter;
    return now - c.fetchedAt < TTL_MS ? c : undefined;
  } catch {
    return undefined;
  }
}

export function putCached(c: CachedChapter): void {
  mkdirSync(chaptersDir(), { recursive: true });
  writeFileSync(pathOf(c.itemId), JSON.stringify(c));
}

// 只删正文。字体文件很小，哈希相同内容就相同，留着
export function clearChapters(): number {
  rmSync(indexDir(), { recursive: true, force: true });
  if (!existsSync(chaptersDir())) return 0;
  const files = readdirSync(chaptersDir()).filter((f) => f.endsWith(".json"));
  rmSync(chaptersDir(), { recursive: true, force: true });
  return files.length;
}

// 章节序号到章节 ID 的对应。只用来定位正文（读 N 章时省掉一次目录请求），不会出现在输出里。
// 章节追加不改变已有序号，所以 7 天内可以复用；序号超出时调用方重新取目录
export interface IndexEntry {
  order: number;
  itemId: string;
  title: string;
  locked: boolean;
}

export function getIndex(bookId: string, now = Date.now()): IndexEntry[] | undefined {
  try {
    const f = JSON.parse(readFileSync(join(indexDir(), `${bookId}.json`), "utf8")) as {
      fetchedAt: number;
      chapters: IndexEntry[];
    };
    return now - f.fetchedAt < TTL_MS ? f.chapters : undefined;
  } catch {
    return undefined;
  }
}

export function putIndex(bookId: string, chapters: IndexEntry[]): void {
  mkdirSync(indexDir(), { recursive: true });
  writeFileSync(
    join(indexDir(), `${bookId}.json`),
    JSON.stringify({ fetchedAt: Date.now(), chapters }),
  );
}
