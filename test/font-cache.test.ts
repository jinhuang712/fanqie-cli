import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fontHashFromHtml, readStoredMap } from "../src/fonts.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanqie-font-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const many = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [String(58344 + i), "的"]));

test("新格式和旧格式的缓存都能读", () => {
  const a = join(dir, "a.json");
  writeFileSync(a, JSON.stringify({ map: many(150), ocr: [58344, 58345] }));
  expect(readStoredMap(a)).toMatchObject({ ocr: 2 });
  expect(readStoredMap(a)?.map.size).toBe(150);
  const b = join(dir, "b.json");
  writeFileSync(b, JSON.stringify(many(150)));
  expect(readStoredMap(b)).toMatchObject({ ocr: 0 });
});

test("空映射、太少、半截文件、空文件都当作没有，并删掉坏文件（空映射会让整章不还原）", () => {
  const cases: Record<string, string> = {
    empty: "{}",
    emptyMap: JSON.stringify({ map: {}, ocr: [] }),
    tooFew: JSON.stringify({ map: many(5), ocr: [] }),
    half: '{"map":{"58344":"的","58345"',
    blank: "",
    nul: "null",
  };
  for (const [name, content] of Object.entries(cases)) {
    const p = join(dir, `${name}.json`);
    writeFileSync(p, content);
    expect(readStoredMap(p)).toBeUndefined();
    expect(existsSync(p)).toBe(false);
  }
});

test("文件不存在：没有", () => {
  expect(readStoredMap(join(dir, "nope.json"))).toBeUndefined();
});

test("fontHashFromHtml 也认状态 JSON 里转义过的写法", () => {
  expect(
    fontHashFromHtml(
      '"url":"https:\\u002F\\u002Flf6-awef.bytetos.com\\u002Fobj\\u002Fawesome-font\\u002Fc\\u002Fdc027189e0ba4cd.woff2"',
    ),
  ).toBe("dc027189e0ba4cd");
  expect(fontHashFromHtml("url(https://x/awesome-font/c/e26e946d8b2ccb7.woff2)")).toBe(
    "e26e946d8b2ccb7",
  );
  expect(fontHashFromHtml("")).toBeUndefined();
});
