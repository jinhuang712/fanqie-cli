import { expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

async function run(...args: string[]) {
  const p = Bun.spawn(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code: await p.exited, stdout, stderr };
}

test("没有命令：用法错误，stdout 为空", async () => {
  const r = await run();
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("用法");
});

test("--help：退出码 0", async () => {
  const r = await run("--help");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("search");
});

test("未知命令：用法错误", async () => {
  const r = await run("nope");
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
});

test("未知选项：用法错误", async () => {
  const r = await run("search", "x", "--nope");
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
});

test("search 缺关键词：用法错误", async () => {
  const r = await run("search");
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("关键词");
});

test("search 关键词是空白：用法错误", async () => {
  const r = await run("search", "甲", "  ");
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("关键词");
});

test("search 多个关键词配合 --brief，参数不对仍是用法错误", async () => {
  const r = await run("search", "甲", "乙", "--brief", "--offset", "abc");
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
});

test("--offset 不是数字：用法错误", async () => {
  const r = await run("search", "x", "--offset", "abc");
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
});

test("--sort 取值不对：用法错误", async () => {
  const r = await run("search", "x", "--sort", "best");
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("relevance");
});
