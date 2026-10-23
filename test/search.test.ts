import { expect, test } from "bun:test";
import { parseSearch } from "../src/search.ts";

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
