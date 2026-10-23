// 默认输出是"类 YAML"文本：字段名用中文，冒号后一个空格，列表项以 "- " 开头。
// 不保证是严格 YAML（书 ID 不加引号，所以会被解析成整数）；要程序读请用 --json。

export type YamlValue = string | number | boolean | string[] | undefined | null;
export type Field = [name: string, value: YamlValue];
// 多行文本，写成 YAML 块标量（| ）
export interface Block {
  block: string;
}
export const block = (text: string | undefined | null): Block => ({ block: text ?? "" });
type Entry = [name: string, value: YamlValue | Block];

// 字段内的换行、制表符压成一个空格（首尾空格保留，由 scalar 决定要不要加引号）
const oneLine = (s: string | number | boolean): string =>
  String(s).replace(/\s*[\r\n\t]+\s*/g, " ");

const INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
const AMBIGUOUS_WORD = /^(?:true|false|null|yes|no|on|off|y|n|~)$/i;

// 值会让人读错时才加双引号（用 JSON.stringify，是合法的 YAML 双引号写法）。
// flow 为 true 时在 { } 或 [ ] 里：逗号、冒号、花括号、方括号也要引。
export function scalar(value: string | number | boolean, flow = false): string {
  const s = oneLine(value);
  const risky =
    s === "" ||
    s !== s.trim() ||
    s.includes(": ") ||
    s.includes(" #") ||
    s.endsWith(":") ||
    INDICATOR_START.test(s) ||
    AMBIGUOUS_WORD.test(s) ||
    (flow && /[,:[\]{}]/.test(s));
  return risky ? JSON.stringify(s) : s;
}

const isBlock = (v: unknown): v is Block =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// 空值整行省略；返回 null 表示这个字段不输出
function render(name: string, value: YamlValue | Block, flow: boolean): string[] | null {
  if (value === undefined || value === null) return null;
  if (isBlock(value)) {
    const body = value.block.replace(/\r/g, "").trim();
    if (!body) return null;
    return [`${name}: |`, ...body.split("\n").map((l) => (l.trim() ? `  ${l.trimEnd()}` : ""))];
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => oneLine(v).trim()).filter((v) => v !== "");
    if (!items.length) return null;
    return [`${name}: [${items.map((v) => scalar(v, true)).join(", ")}]`];
  }
  if (typeof value === "string" && oneLine(value).trim() === "") return null;
  return [`${name}: ${scalar(value, flow)}`];
}

// 一个 YAML 文档：每个字段一行
export function yamlDoc(fields: Entry[]): string {
  const out = fields.flatMap(([n, v]) => render(n, v, false) ?? []);
  return out.length ? out.join("\n") + "\n" : "";
}

// 块风格列表：第一个有值的字段带 "- "，其余缩进 2 个空格
export function yamlBlock(items: Entry[][]): string {
  const out: string[] = [];
  for (const item of items) {
    // 每个字段的首行加 "- " 或两个空格；块标量的正文行再多缩进两个空格
    let first = true;
    for (const [n, v] of item) {
      const lines = render(n, v, false);
      if (!lines) continue;
      lines.forEach((l, i) =>
        out.push(i === 0 ? (first ? "- " : "  ") + l : l === "" ? "" : "  " + l),
      );
      first = false;
    }
  }
  return out.length ? out.join("\n") + "\n" : "";
}

// 流式风格列表：一项一行，- {名: 值, 名: 值}
export function yamlFlow(items: Entry[][]): string {
  const out = items
    .map((item) =>
      item
        .flatMap(([n, v]) => {
          if (isBlock(v)) return [];
          if (Array.isArray(v)) return render(n, v, true) ?? [];
          if (v === undefined || v === null || (typeof v === "string" && oneLine(v).trim() === ""))
            return [];
          return [`${n}: ${scalar(v, true)}`];
        })
        .join(", "),
    )
    .filter(Boolean)
    .map((s) => `- {${s}}`);
  return out.length ? out.join("\n") + "\n" : "";
}

// 注释行
export const comment = (text: string): string => `# ${text}\n`;

export const stateLabel = (finished: boolean): string => (finished ? "完结" : "连载");

export function formatDate(seconds: string | number | undefined): string {
  const n = Number(seconds);
  if (!n) return "";
  return new Date(n * 1000).toISOString().slice(0, 10);
}
