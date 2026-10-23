import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBook } from "../src/book.ts";
import { libraryEntry, rankEntry } from "../src/commands.ts";
import { coverUrl } from "../src/cover.ts";
import { yamlBlock, yamlFlow } from "../src/format.ts";
import { retryPolicy } from "../src/http.ts";
import { library } from "../src/library.ts";
import { rank } from "../src/rank.ts";
import { getToc } from "../src/toc.ts";

// 全部是虚构数据
const realFetch = globalThis.fetch;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanqie-fields-"));
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

function mockFetch(handler: (url: string) => Response) {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) =>
    handler(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    )) as typeof fetch;
}

const HASH = "0123456789abcdef0123456789abcdef";
const signed = `https://img.example.test/novel-pic/${HASH}~tplv-resize:225:0.image?x-expires=1&x-signature=abc`;

test("封面：路径和签名地址都换成不带签名的固定地址，认不出就是空", () => {
  const want = `https://p3-novel.byteimg.com/origin/novel-pic/${HASH}`;
  expect(coverUrl(`novel-pic/${HASH}`)).toBe(want);
  expect(coverUrl(signed)).toBe(want);
  expect(coverUrl("")).toBe("");
  expect(coverUrl(undefined)).toBe("");
});

test("榜单：简介、封面、更新时间、名次变化、统计截止都带上", async () => {
  mockFetch((url) => {
    if (url.includes("/api/rank/category/list"))
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            total_num: 100,
            rankVersion: "1792750200",
            book_list: [
              {
                bookId: "101",
                bookName: "测试书甲",
                author: "作者甲",
                creationStatus: "1",
                wordNumber: "120000",
                read_count: "5000",
                lastChapterTitle: "第9章 尾声",
                abstract: "第一行\n第二行",
                thumbUri: signed,
                uid: "900",
                firstChapterItemId: "f1",
                lastChapterItemId: "l1",
                lastChapterUpdateTime: "1792670404",
                rankPosDiff: -2,
              },
              {
                bookId: "102",
                bookName: "测试书乙",
                author: "作者乙",
                creationStatus: "0",
                wordNumber: "80000",
                read_count: "100",
                lastChapterTitle: "第3章",
                rankPosDiff: 0,
              },
            ],
          },
        }),
      );
    return new Response(
      `<script>window.__INITIAL_STATE__={"rank":{"rankCategoryTypeList":{"male":[{"id":"7","name":"测试分类"}],"female":[]}}}</script>`,
    );
  });
  const r = await rank("male", "read", "测试分类", 0);
  const [a, b] = r.books;
  expect(a).toMatchObject({
    abstract: "第一行\n第二行",
    coverUrl: `https://p3-novel.byteimg.com/origin/novel-pic/${HASH}`,
    authorId: "900",
    firstChapterId: "f1",
    lastChapterId: "l1",
    lastUpdate: "2026-10-22",
    rankChange: -2,
  });
  expect(b).toMatchObject({ abstract: "", coverUrl: "", rankChange: 0 });
  expect(r.statsDate).toBe("2026-10-23");
  const text = yamlBlock(r.books.map((x) => rankEntry(x)));
  expect(text).toContain("名次变化: 下降 2");
  expect(text).toContain("简介: |\n    第一行\n    第二行");
  // 没有变化、没有简介的书：这些行整行省略
  expect(text.split("- 名次: 2")[1]).not.toContain("名次变化");
  expect(text.split("- 名次: 2")[1]).not.toContain("简介");
  // brief：去掉封面和简介
  const brief = yamlBlock([rankEntry(a!, true)]);
  expect(brief).not.toContain("简介");
  expect(brief).not.toContain("封面");
  expect(brief).toContain("更新时间: 2026-10-22");
});

test("分类库：简介、封面、更新时间", async () => {
  mockFetch(
    () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            has_more: false,
            total_count: 1,
            book_list: [
              {
                book_id: "201",
                book_name: "测试书丙",
                author: "作者丙",
                creation_status: 0,
                word_count: "30万字",
                read_count: "未满1000人在读",
                abstract: "一句话简介",
                thumb_uri: `novel-pic/${HASH}`,
                last_chapter_time: "1792674488",
                status: 0,
              },
            ],
          },
        }),
      ),
  );
  const r = await library({ sort: "hot", page: 1 });
  expect(r.books[0]).toMatchObject({
    abstract: "一句话简介",
    coverUrl: `https://p3-novel.byteimg.com/origin/novel-pic/${HASH}`,
    lastUpdate: "2026-10-22",
  });
  const text = yamlBlock(r.books.map((x) => libraryEntry(x)));
  expect(text).toContain("更新时间: 2026-10-22");
  expect(text).toContain("简介: |\n    一句话简介");
});

test("书详情：作者签名、封面、开更时间、首末章 ID、分卷", async () => {
  const volumes = [
    [{ itemId: "c1", title: "第1章", isChapterLock: false, firstPassTime: "1705061207" }],
    [{ itemId: "c2", title: "第2章", isChapterLock: false, firstPassTime: "1705128350" }],
  ];
  const page = {
    bookName: "测试书丁",
    bookId: "301",
    author: "作者丁",
    authorId: "800",
    description: "签名一句话",
    sourceUri: `novel-pic/${HASH}`,
    thumbUri: signed,
    creationStatus: 1,
    wordNumber: 1000,
    readCount: 20,
    chapterTotal: 2,
    lastChapterItemId: "c2",
    lastChapterTitle: "第2章",
    lastPublishTime: "1705128350",
    abstract: "简介",
    volumeNameList: ["第一卷", "第二卷"],
    chapterListWithVolume: volumes,
  };
  mockFetch(
    () =>
      new Response(`<script>window.__INITIAL_STATE__={"page":${JSON.stringify(page)}}</script>`),
  );
  const { book } = await getBook("301");
  expect(book).toMatchObject({
    authorBio: "签名一句话",
    authorId: "800",
    coverUrl: `https://p3-novel.byteimg.com/origin/novel-pic/${HASH}`,
    startDate: "2024-01-12",
    firstChapterId: "c1",
    lastChapterId: "c2",
    volumes: ["第一卷", "第二卷"],
  });
});

test("目录：每章带发布日期和所在的卷", async () => {
  mockFetch(
    () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            chapterListWithVolume: [
              [
                {
                  itemId: "a1",
                  title: "第1章",
                  isChapterLock: false,
                  firstPassTime: "1705061207",
                  volume_name: "第一卷",
                },
                {
                  itemId: "a2",
                  title: "第2章",
                  isChapterLock: false,
                  firstPassTime: "1705061216",
                  volume_name: "第一卷",
                },
              ],
              [
                {
                  itemId: "b1",
                  title: "第3章",
                  isChapterLock: true,
                  firstPassTime: "1705128350",
                  volume_name: "第二卷",
                },
              ],
            ],
          },
        }),
      ),
  );
  const { chapters } = await getToc("1");
  expect(chapters.map((c) => [c.publishedAt, c.volume])).toEqual([
    ["2024-01-12", "第一卷"],
    ["2024-01-12", "第一卷"],
    ["2024-01-13", "第二卷"],
  ]);
  // 一章一行的形状不变
  const line = yamlFlow([
    [
      ["序号", 1],
      ["标题", "第1章"],
      ["发布", chapters[0]!.publishedAt],
    ],
  ]);
  expect(line).toBe("- {序号: 1, 标题: 第1章, 发布: 2024-01-12}\n");
});
