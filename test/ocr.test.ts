import { expect, test } from "bun:test";
import { pickChar } from "../src/ocr.ts";

// Vision 对一个观察给出前 5 个候选，展平后每 5 个一组。一行画 3 个同样的字形，候选里每个字符按排名计分
test("pickChar 取得分最高的字符", () => {
  expect(pickChar(["山山山", "山山凵", "山", "凵凵凵", "田"])).toBe("山");
});

test("pickChar 只在允许的字符里挑", () => {
  // 最高分是"山"，但这个字体里"山"已经被别的字形用掉了，只能是"凵"
  expect(pickChar(["山山山", "山山凵", "山", "凵凵凵", "田"], new Set(["凵", "田"]))).toBe("凵");
});

test("pickChar 候选里一个允许的字符都没有时，退回不加限制的结果", () => {
  expect(pickChar(["山山山", "山山山", "山山", "山", "山"], new Set(["田"]))).toBe("山");
});

test("pickChar 得分太低（只出现一次）不采用", () => {
  expect(pickChar(["", "", "", "", "x"])).toBeUndefined();
  expect(pickChar([])).toBeUndefined();
});

test("pickChar 忽略空白", () => {
  expect(pickChar(["山 山 山", "山山山", "山山山", "山山山", "山山山"])).toBe("山");
});
