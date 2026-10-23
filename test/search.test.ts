import { expect, test } from "bun:test";
import { networkError, usageError } from "../src/errors.ts";
import {
  briefBook,
  formatSearch,
  mergeKeywordRuns,
  parseSearch,
  parseWebSearch,
  searchKeywords,
  type SearchBook,
} from "../src/search.ts";

test("parseSearch 映射字段并识别完结状态", () => {
  const r = parseSearch({
    code: 0,
    data: {
      has_more: true,
      offset: 10,
      ret_data: [
        { book_id: "1", title: "甲", author: "乙", category: "悬疑", creation_status: "0" },
        { book_id: "2", title: "丙", author: "丁", creation_status: "1" },
      ],
    },
  });
  expect(r.hasMore).toBe(true);
  expect(r.nextOffset).toBe(10);
  expect(r.books[0]).toMatchObject({ bookId: "1", finished: true, category: "悬疑" });
  expect(r.books[1]).toMatchObject({ finished: false, category: "" });
});

test("parseSearch 在 code 非 0 时抛网络错误", () => {
  expect(() => parseSearch({ code: 1, message: "x" })).toThrow("code=1");
});

test("parseSearch 不再输出评分", () => {
  const r = parseSearch({
    code: 0,
    data: { ret_data: [{ book_id: "1", title: "a", author: "b" }] },
  });
  expect(Object.keys(r.books[0]!)).not.toContain("score");
});

const book = (id: string, extra: Partial<SearchBook> = {}): SearchBook => ({
  bookId: id,
  title: `示例书${id}`,
  author: "示例作者",
  category: "示例分类",
  finished: false,
  ...extra,
});

test("parseSearch 读出简介，空简介不留字段", () => {
  const r = parseSearch({
    code: 0,
    data: {
      ret_data: [
        { book_id: "1", title: "甲", author: "乙", abstract: " 示例简介 " },
        { book_id: "2", title: "丙", author: "丁", abstract: "" },
      ],
    },
  });
  expect(r.books[0]!.abstract).toBe("示例简介");
  expect(r.books[1]!.abstract).toBeUndefined();
});

test("parseWebSearch 读出简介、最新章节、更新时间、封面，并逐个字段解码", () => {
  const decode = (t: string | null | undefined) => (t ?? "").replaceAll("#", "");
  const r = parseWebSearch(
    {
      code: 0,
      data: {
        total_count: 1,
        search_book_data_list: [
          {
            book_id: "1",
            book_name: "示#例",
            author: "作#者",
            category: "玄幻,#架空,腹黑",
            creation_status: 1,
            read_count: 10,
            word_count: 20,
            book_abstract: "这是#简介",
            last_chapter_title: "第#1章",
            last_chapter_time: "1760000000",
            first_chapter_id: "111",
            last_chapter_id: "222",
            thumb_url: "https://example.com/a.jpg",
          },
          {
            book_id: "2",
            book_name: "乙",
            author: "丙",
            category: "玄幻",
            creation_status: 0,
            read_count: 1,
            word_count: 2,
            book_abstract: "",
            last_chapter_time: "0",
          },
        ],
      },
    },
    decode,
    0,
  );
  expect(r.books[0]).toMatchObject({
    title: "示例",
    author: "作者",
    category: "玄幻,架空,腹黑",
    abstract: "这是简介",
    lastChapterTitle: "第1章",
    lastUpdate: "2025-10-09",
    firstChapterId: "111",
    lastChapterId: "222",
    cover: "https://example.com/a.jpg",
  });
  const empty = r.books[1]!;
  expect(empty.abstract).toBeUndefined();
  expect(empty.lastUpdate).toBeUndefined();
  expect(empty.cover).toBeUndefined();
});

test("mergeKeywordRuns：并集、按书 id 去重、命中多的在前、同数保持先后", () => {
  const merged = mergeKeywordRuns([
    { keyword: "甲", books: [book("1"), book("2"), book("3")] },
    { keyword: "乙", books: [book("4"), book("3"), book("2")] },
    { keyword: "丙", books: [book("3"), book("5")] },
  ]);
  expect(merged.map((b) => b.bookId)).toEqual(["3", "2", "1", "4", "5"]);
  expect(merged[0]!.matchedKeywords).toEqual(["甲", "乙", "丙"]);
  expect(merged[1]!.matchedKeywords).toEqual(["甲", "乙"]);
  expect(merged[4]!.matchedKeywords).toEqual(["丙"]);
});

test("searchKeywords：某个关键词网络失败只警告，其余照常", async () => {
  const warnings: string[] = [];
  const r = await searchKeywords(
    ["甲", "乙"],
    async (k) => {
      if (k === "甲") throw networkError("连接被重置");
      return { result: { books: [book("1")], hasMore: false, nextOffset: 0 }, raw: { k } };
    },
    (m) => warnings.push(m),
  );
  expect(r.books.map((b) => b.matchedKeywords)).toEqual([["乙"]]);
  expect(r.failed).toEqual([{ keyword: "甲", message: "连接被重置" }]);
  expect(warnings).toHaveLength(1);
  expect(Object.keys(r.raw)).toEqual(["乙"]);
});

test("searchKeywords：全部失败抛网络错误；非网络错误直接抛", async () => {
  const fail = async () => {
    throw networkError("x");
  };
  await expect(searchKeywords(["甲", "乙"], fail, () => {})).rejects.toMatchObject({
    kind: "network",
  });
  const bad = async () => {
    throw usageError("y");
  };
  await expect(searchKeywords(["甲", "乙"], bad, () => {})).rejects.toMatchObject({
    kind: "usage",
  });
});

test("formatSearch：默认输出带简介块和额外字段，brief 不带", () => {
  const books = [
    book("1", {
      abstract: "第一行\n第二行",
      lastChapterTitle: "第3章 示例",
      lastUpdate: "2026-10-01",
      cover: "https://example.com/c.jpg",
      firstChapterId: "11",
      lastChapterId: "33",
    }),
    book("2"),
  ];
  const full = formatSearch(books, { brief: false, web: false });
  expect(full).toContain("  简介: |\n    第一行\n    第二行\n");
  expect(full).toContain("最新章节: 第3章 示例");
  expect(full).toContain("更新时间: 2026-10-01");
  expect(full).toContain("封面: https://example.com/c.jpg");
  // 没有简介的书不输出空字段
  expect(full.match(/简介/g)).toHaveLength(1);
  const brief = formatSearch(books, { brief: true, web: false });
  for (const w of ["简介", "最新章节", "更新时间", "封面", "首章id"])
    expect(brief).not.toContain(w);
  expect(brief).toContain("书名: 示例书1");
});

test("formatSearch：网页分类拆成分类和标签；多关键词有命中字段，没有更多提示", () => {
  const out = formatSearch(
    [{ ...book("1", { category: "玄幻,架空,腹黑" }), matchedKeywords: ["甲", "乙"] }],
    { brief: true, web: true },
  );
  expect(out).toContain("命中关键词: [甲, 乙]");
  expect(out).toContain("分类: 玄幻");
  expect(out).toContain("标签: [架空, 腹黑]");
  expect(out).not.toContain("更多");
  expect(formatSearch([book("1")], { brief: true, web: false, moreOffset: 10 })).toContain(
    "# 更多：--offset 10",
  );
});

test("briefBook 去掉额外字段，保留基本字段", () => {
  const b = briefBook({ ...book("1", { abstract: "x", cover: "u" }), words: 5 });
  expect(Object.keys(b).toSorted()).toEqual(
    ["author", "bookId", "category", "finished", "title", "words"].toSorted(),
  );
});
