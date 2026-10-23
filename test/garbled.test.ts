import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCached } from "../src/cache.ts";
import { retryPolicy } from "../src/http.ts";
import { readById } from "../src/read.ts";

const realFetch = globalThis.fetch;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanqie-garbled-"));
  process.env.FANQIE_CACHE_DIR = dir;
  process.env.FANQIE_CONFIG_DIR = dir;
  retryPolicy.baseMs = 1;
  retryPolicy.pinIp = false;
  retryPolicy.paceMs = [0, 0];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.FANQIE_CACHE_DIR;
  delete process.env.FANQIE_CONFIG_DIR;
  retryPolicy.baseMs = 500;
  retryPolicy.pinIp = true;
  retryPolicy.paceMs = [200, 700];
  rmSync(dir, { recursive: true, force: true });
});

// 页面里没有 @font-face，正文里的私有区字符没法还原
const page = (content: string) =>
  `<script>window.__INITIAL_STATE__={"reader":{"chapterData":{"itemId":"7","title":"第1章 甲","order":1,"isChapterLock":false,"content":${JSON.stringify(content)}}}}</script>`;

function serve(pages: string[]): () => number {
  let calls = 0;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(pages[Math.min(calls++, pages.length - 1)]),
    )) as unknown as typeof fetch;
  return () => calls;
}

test("第一次拿到的页面没带字体，重新取一次就好了：输出正常，缓存的是好文本", async () => {
  const calls = serve([page("<p></p>"), page("<p>他的光</p>")]);
  const r = await readById("7", { refresh: false, raw: false });
  expect(r.chapters[0]?.text).toBe("他的光");
  expect(calls()).toBe(2);
  expect(getCached("7")?.text).toBe("他的光");
});

test("一直还原不了：报网络错误，不输出，也不写缓存", async () => {
  const calls = serve([page("<p></p>")]);
  const err = await readById("7", { refresh: false, raw: false }).catch((e: unknown) => e);
  expect(err).toMatchObject({ kind: "network" });
  expect((err as Error).message).toContain("3 个字符没能还原");
  expect(calls()).toBe(3);
  expect(getCached("7")).toBeUndefined();
});
