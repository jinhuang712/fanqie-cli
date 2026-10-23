// 量 OCR 兜底在已知字形上的准确率：把参考字体的字形逐个交给 OCR，和字形表里的正确答案比。
// 用法：bun scripts/measure-ocr.ts [字体哈希]（默认 dc027189e0ba4cd）
import * as fontkit from "fontkit";
import glyphs from "../src/glyphs.json" with { type: "json" };
import { isPua, outlineKey } from "../src/fonts.ts";
import { ocrAvailable, ocrGlyphs } from "../src/ocr.ts";

if (!ocrAvailable()) {
  console.log("这台机器没有 OCR（需要 macOS 和 swiftc）");
  process.exit(1);
}
const hash = process.argv[2] ?? "dc027189e0ba4cd";
const res = await fetch(`https://lf6-awef.bytetos.com/obj/awesome-font/c/${hash}.woff2`);
const font = fontkit.create(Buffer.from(await res.arrayBuffer())) as fontkit.Font;
const table: Record<string, string> = glyphs;
const cps = font.characterSet.filter(isPua);
const t0 = performance.now();
// 最难的情形：全部字形都未知，候选集是整张字形表的汉字
const allowed = new Set(Object.values(table));
const got =
  process.argv[3] === "few"
    ? new Map<number, string>()
    : await ocrGlyphs(font, cps, process.argv[3] === "free" ? undefined : allowed);
const secs = ((performance.now() - t0) / 1000).toFixed(1);

let right = 0;
const wrong: string[] = [];
for (const cp of cps) {
  const truth = table[outlineKey(font, cp)];
  const guess = got.get(cp);
  if (guess === truth) right++;
  else wrong.push(`${truth} → ${guess ?? "（没认出）"}`);
}
console.log(`字形 ${cps.length} 个，耗时 ${secs} 秒`);
console.log(
  `识别出单个字符 ${got.size} 个，其中正确 ${right} 个：正确率 ${((right / cps.length) * 100).toFixed(1)}%（占全部字形）`,
);
if (got.size) console.log(`识别出的里面正确率 ${((right / got.size) * 100).toFixed(1)}%`);
if (got.size) console.log("错的或没认出的：", wrong.join("  "));

// 真实场景：字体里只多出少数几个新字形。随机拿掉 N 个已知字形，候选集就是这 N 个字
if (process.argv[3] === "few") {
  const N = 15;
  let total = 0;
  let ok = 0;
  for (let trial = 0; trial < 5; trial++) {
    const picked = cps.toSorted(() => Math.random() - 0.5).slice(0, N);
    const truthChars = new Set(picked.map((cp) => table[outlineKey(font, cp)]));
    // oxlint-disable-next-line no-await-in-loop
    const r = await ocrGlyphs(font, picked, truthChars);
    for (const cp of picked) {
      total++;
      if (r.get(cp) === table[outlineKey(font, cp)]) ok++;
    }
  }
  console.log(
    `少数新字形（每次 ${N} 个，共 5 次）：正确 ${ok} / ${total} = ${((ok / total) * 100).toFixed(1)}%`,
  );
}
