// G5：源码里出现的主机名，除官方域名白名单外必须为 0。
// 用法：bun scripts/check-hosts.ts（有违规时退出码 1）
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 官方域名白名单。字体 CDN（bytetos.com）是番茄页面自己引用的
export const ALLOWED = ["fanqienovel.com", "snssdk.com", "bytetos.com"];

const HOST = /\b(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|dev|xyz)\b/gi;

export function findViolations(srcDir: string): Array<{ file: string; host: string }> {
  const out: Array<{ file: string; host: string }> = [];
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith(".ts")) continue;
    const code = readFileSync(join(srcDir, name), "utf8")
      .split("\n")
      // 注释里提到别的项目不算。// 前面必须是行首或空白，否则会把 https:// 当成注释
      .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
      .join("\n");
    for (const host of new Set(code.match(HOST) ?? [])) {
      const h = host.toLowerCase();
      if (!ALLOWED.some((a) => h === a || h.endsWith(`.${a}`))) out.push({ file: name, host });
    }
  }
  return out;
}

if (import.meta.main) {
  const violations = findViolations(join(import.meta.dir, "..", "src"));
  for (const v of violations) console.error(`${v.file}: 白名单之外的主机名 ${v.host}`);
  console.log(violations.length ? `违规 ${violations.length} 处` : "没有白名单之外的主机名");
  process.exit(violations.length ? 1 : 0);
}
