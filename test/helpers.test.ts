import { expect, test } from "bun:test";
import { parseCount } from "../src/api.ts";
import { resolveCategory, type Category } from "../src/categories.ts";
import { parseEnum, parseNonNegative } from "../src/commands.ts";
import { FanqieError } from "../src/errors.ts";
import { block, scalar, yamlBlock, yamlDoc, yamlFlow } from "../src/format.ts";
import { lockSummary } from "../src/book.ts";

test("parseCount 解析中文数量", () => {
  expect(parseCount("320.1万字")).toBe(3_201_000);
  expect(parseCount("264.5万人在读")).toBe(2_645_000);
  expect(parseCount("1433人在读")).toBe(1433);
  expect(parseCount("1.2亿")).toBe(120_000_000);
  expect(parseCount("未满1000人在读")).toBeUndefined();
  expect(parseCount("")).toBeUndefined();
});

const CATEGORIES: Category[] = [
  { id: "1141", name: "西方奇幻", group: "男频" },
  { id: "8", name: "科幻末世", group: "男频" },
];

test("resolveCategory 按名称或 ID 找，找不到抛 notfound", () => {
  expect(resolveCategory(CATEGORIES, "西方奇幻", "x").id).toBe("1141");
  expect(resolveCategory(CATEGORIES, "8", "x").name).toBe("科幻末世");
  try {
    resolveCategory(CATEGORIES, "不存在", "fanqie categories");
    throw new Error("应该抛错");
  } catch (e) {
    expect(e).toBeInstanceOf(FanqieError);
    expect((e as FanqieError).kind).toBe("notfound");
    expect((e as FanqieError).message).toContain("fanqie categories");
  }
});

test("parseNonNegative 与 parseEnum 校验参数", () => {
  expect(parseNonNegative(undefined, "offset")).toBe(0);
  expect(parseNonNegative("20", "offset")).toBe(20);
  expect(() => parseNonNegative("-1", "offset")).toThrow("非负整数");
  expect(parseEnum("hot", "sort", ["hot", "new"] as const)).toBe("hot");
  expect(parseEnum(undefined, "sort", ["hot", "new"] as const, "hot")).toBe("hot");
  expect(() => parseEnum("x", "sort", ["hot", "new"] as const)).toThrow("hot、new");
});

test("scalar：普通值不加引号，会让人读错的才加", () => {
  expect(scalar("十日终焉")).toBe("十日终焉");
  expect(scalar("7143038691944959011")).toBe("7143038691944959011");
  expect(scalar(320)).toBe("320");
  expect(scalar("第1章 示例章节")).toBe("第1章 示例章节");
  expect(scalar("a:b")).toBe("a:b");
  expect(scalar("a#b")).toBe("a#b");
  expect(scalar("")).toBe('""');
  expect(scalar("a: b")).toBe('"a: b"');
  expect(scalar("a #b")).toBe('"a #b"');
  expect(scalar(" a")).toBe('" a"');
  expect(scalar("a ")).toBe('"a "');
  expect(scalar("abc:")).toBe('"abc:"');
  for (const c of "-?:,[]{}#&*!|>'\"%@") expect(scalar(`${c}x`)).toBe(JSON.stringify(`${c}x`));
  expect(scalar('say "hi": ok')).toBe('"say \\"hi\\": ok"');
  expect(scalar("true")).toBe('"true"');
  expect(scalar("a\nb")).toBe("a b");
});

test("scalar：流式里逗号、冒号、花括号、方括号也要加引号", () => {
  expect(scalar("a,b", true)).toBe('"a,b"');
  expect(scalar("a:b", true)).toBe('"a:b"');
  expect(scalar("a{b}", true)).toBe('"a{b}"');
  expect(scalar("a[b]", true)).toBe('"a[b]"');
  expect(scalar("a,b")).toBe("a,b");
  expect(scalar("第1章，示例章节", true)).toBe("第1章，示例章节");
});

test("yamlBlock：每项以 - 开头，后续字段缩进 2 格，省略空字段，标签用流式列表", () => {
  const text = yamlBlock([
    [
      ["书id", "1"],
      ["书名", "a: b"],
      ["作者", ""],
      ["标签", ["x", "y,z"]],
      ["字数", undefined],
      ["阅读量", 0],
    ],
    [
      ["书id", "2"],
      ["标签", []],
    ],
  ]);
  expect(text).toBe('- 书id: 1\n  书名: "a: b"\n  标签: [x, "y,z"]\n  阅读量: 0\n- 书id: 2\n');
  expect(yamlBlock([])).toBe("");
});

test("yamlFlow：一项一行，值里有逗号、冒号、花括号时加引号", () => {
  const text = yamlFlow([
    [
      ["序号", 1],
      ["章节id", "7000000000000000100"],
      ["标题", "第1章 示例章节"],
    ],
    [
      ["序号", 2],
      ["标题", "a, b {c}"],
      ["锁定", "是"],
    ],
    [
      ["序号", 3],
      ["标题", ""],
      ["锁定", undefined],
    ],
  ]);
  expect(text).toBe(
    '- {序号: 1, 章节id: 7000000000000000100, 标题: 第1章 示例章节}\n- {序号: 2, 标题: "a, b {c}", 锁定: 是}\n- {序号: 3}\n',
  );
});

test("yamlDoc：多行文本写成块标量，空文本整行省略", () => {
  expect(
    yamlDoc([
      ["书名", "x"],
      ["简介", block("第一行\n\n  第三行 \r\n末行")],
    ]),
  ).toBe("书名: x\n简介: |\n  第一行\n\n    第三行\n  末行\n");
  expect(
    yamlDoc([
      ["书名", "x"],
      ["简介", block("  ")],
    ]),
  ).toBe("书名: x\n");
  const inList = yamlBlock([
    [
      ["书id", "1"],
      ["简介", block("a\nb")],
      ["作者", "z"],
    ],
  ]);
  expect(inList).toBe("- 书id: 1\n  简介: |\n    a\n    b\n  作者: z\n");
});

test("lockSummary 数出免费和锁定的章节", () => {
  const volumes = [
    [{ isChapterLock: false }, { isChapterLock: false }],
    [{ isChapterLock: true }, { isChapterLock: true }, { isChapterLock: true }],
  ];
  expect(lockSummary(volumes)).toEqual({ free: 2, locked: 3 });
  expect(lockSummary(undefined)).toEqual({ free: 0, locked: 0 });
});
