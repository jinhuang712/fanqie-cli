// 基准：GOALS.md 的 B1 到 B4。用法：bun scripts/bench.ts
// 联网，约 3 分钟。每项取中位数；网络会随机重置连接，所以只统计成功的那几次。
import { chromium } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UA } from "../src/http.ts";
import { findChrome } from "../src/qrwindow.ts";
import { readRange } from "../src/read.ts";
import { searchRelevance, searchWeb } from "../src/search.ts";

const BOOK = "7143038691944959011";
const median = (xs: number[]) =>
  xs.length ? xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN;
const ms = (n: number) => `${Math.round(n)} ms`;

async function timeIt(fn: () => Promise<unknown>): Promise<number | undefined> {
  const t0 = performance.now();
  try {
    await fn();
    return performance.now() - t0;
  } catch {
    return undefined;
  }
}

async function repeat(
  n: number,
  fn: () => Promise<unknown>,
): Promise<{ values: number[]; failed: number }> {
  const values: number[] = [];
  let failed = 0;
  for (let i = 0; i < n; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const t = await timeIt(fn);
    if (t === undefined) failed++;
    else values.push(t);
  }
  return { values, failed };
}

const report = (label: string, r: { values: number[]; failed: number }) =>
  console.log(
    `${label}: 中位数 ${ms(median(r.values))}，成功 ${r.values.length} 次，失败 ${r.failed} 次`,
  );

// B1：搜索耗时
console.log("## B1 搜索耗时");
report("fanqie search（相关，直接请求）", await repeat(10, () => searchRelevance("修仙", 0)));
report(
  "fanqie search --sort hot（浏览器内请求）",
  await repeat(5, () => searchWeb("修仙", "hot", 0)),
);
// 参照：浏览器打开首页，在搜索框输入后，页面自己请求搜索接口的耗时
{
  const times: number[] = [];
  let failed = 0;
  const browser = await chromium.launch({ executablePath: findChrome()!, headless: true });
  for (let i = 0; i < 5; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const ctx = await browser.newContext({ userAgent: UA });
    // oxlint-disable-next-line no-await-in-loop
    const page = await ctx.newPage();
    try {
      // oxlint-disable-next-line no-await-in-loop
      await page.goto("https://fanqienovel.com/", {
        waitUntil: "domcontentloaded",
        timeout: 25_000,
      });
      // oxlint-disable-next-line no-await-in-loop
      await page.getByPlaceholder("请输入书名或作者名").fill("修仙");
      const t0 = performance.now();
      const resp = page.waitForResponse((r) => r.url().includes("search_book"), {
        timeout: 20_000,
      });
      // oxlint-disable-next-line no-await-in-loop
      await page.keyboard.press("Enter");
      // oxlint-disable-next-line no-await-in-loop
      await resp;
      times.push(performance.now() - t0);
    } catch {
      failed++;
    }
    // oxlint-disable-next-line no-await-in-loop
    await ctx.close();
  }
  await browser.close();
  report("参照：浏览器页面自己搜索（只算输入回车到响应，不含打开首页）", { values: times, failed });
}

// B2、B3：读一章，缓存未命中和命中
console.log("\n## B2、B3 读一章的耗时");
{
  const dir = mkdtempSync(join(tmpdir(), "fq-bench-"));
  process.env.FANQIE_CACHE_DIR = dir;
  const miss: number[] = [];
  const hit: number[] = [];
  let failed = 0;
  for (const n of [1, 2, 3, 4, 5]) {
    // oxlint-disable-next-line no-await-in-loop
    const a = await timeIt(() => readRange(BOOK, String(n), { refresh: false, raw: false }));
    if (a === undefined) {
      failed++;
      continue;
    }
    miss.push(a);
    // oxlint-disable-next-line no-await-in-loop
    const b = await timeIt(() => readRange(BOOK, String(n), { refresh: false, raw: false }));
    if (b !== undefined) hit.push(b);
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(
    `B2 缓存未命中：中位数 ${ms(median(miss))}（含查目录），成功 ${miss.length} 次，失败 ${failed} 次`,
  );
  console.log(`B3 缓存命中：中位数 ${ms(median(hit))}，成功 ${hit.length} 次`);
}

// B4：一章输出的字节数，默认输出对 --raw
console.log("\n## B4 一章的输出字节数");
{
  const run = async (...extra: string[]) => {
    const p = Bun.spawn(
      ["bun", join(import.meta.dir, "..", "src", "cli.ts"), "read", BOOK, "1", ...extra],
      {
        stdout: "pipe",
        stderr: "ignore",
        env: { ...process.env, FANQIE_CACHE_DIR: mkdtempSync(join(tmpdir(), "fq-bench4-")) },
      },
    );
    const out = await new Response(p.stdout).text();
    await p.exited;
    return Buffer.byteLength(out);
  };
  const plain = await run();
  const raw = await run("--raw");
  console.log(
    `默认输出 ${plain} 字节，--raw ${raw} 字节，默认是 --raw 的 ${((plain / raw) * 100).toFixed(0)}%`,
  );
}
