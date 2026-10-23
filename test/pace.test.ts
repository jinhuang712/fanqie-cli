import { afterEach, beforeEach, expect, test } from "bun:test";
import { request, retryPolicy } from "../src/http.ts";

const realFetch = globalThis.fetch;
beforeEach(() => {
  retryPolicy.pinIp = false;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  retryPolicy.pinIp = true;
  retryPolicy.paceMs = [200, 700];
});

test("两次请求之间至少隔开设定的随机间隔", async () => {
  const times: number[] = [];
  globalThis.fetch = (() => {
    times.push(Date.now());
    return Promise.resolve(new Response("ok"));
  }) as unknown as typeof fetch;
  retryPolicy.paceMs = [80, 120];
  for (let i = 0; i < 4; i++) {
    // oxlint-disable-next-line no-await-in-loop
    await request("https://example.invalid/x", { auth: false });
  }
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  expect(gaps).toHaveLength(3);
  for (const g of gaps) expect(g).toBeGreaterThanOrEqual(75);
  // 间隔是随机的，不是固定值
  expect(new Set(gaps).size).toBeGreaterThan(1);
});
