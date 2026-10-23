import { expect, test } from "bun:test";
import {
  countPua,
  decode,
  encodeForTest,
  fontHashFromHeader,
  fontHashFromHtml,
  type FontMap,
} from "../src/fonts.ts";

// 一个只有几个字的假映射，不依赖网络
const MAP: FontMap = new Map([
  [0xe400, "他"],
  [0xe401, "的"],
  [0xe402, "光"],
  [0xe403, "1"],
]);

test("编码后再还原，得到原文", () => {
  const encoded = encodeForTest("他的光1", MAP);
  expect(countPua(encoded)).toBe(4);
  expect(decode(encoded, MAP)).toEqual({ text: "他的光1", unmapped: 0 });
});

test("普通字符原样保留", () => {
  expect(decode("abc，。", MAP)).toEqual({ text: "abc，。", unmapped: 0 });
});

test("映射里没有的私有区字符保留原样并计数", () => {
  const r = decode("甲乙", MAP);
  expect(r.text).toBe("甲乙");
  expect(r.unmapped).toBe(1);
});

test("没有映射时，私有区字符全部计为还原不了", () => {
  expect(decode("甲", undefined).unmapped).toBe(1);
});

test("从页面 HTML 取字体哈希", () => {
  const html =
    '@font-face{font-family:X;src:url(https://lf6-awef.bytetos.com/obj/awesome-font/c/dc027189e0ba4cd.woff2)format("woff2")}';
  expect(fontHashFromHtml(html)).toBe("dc027189e0ba4cd");
  expect(fontHashFromHtml("<html></html>")).toBeUndefined();
});

test("从响应头 x-tt-zhal 取字体哈希", () => {
  expect(fontHashFromHeader("k=fKts9tCXDjS49UhH;f=e26e946d8b2ccb7;d1=lf6-awef.bytetos.com")).toBe(
    "e26e946d8b2ccb7",
  );
  expect(fontHashFromHeader(null)).toBeUndefined();
});
