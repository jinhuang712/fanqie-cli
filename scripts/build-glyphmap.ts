// 生成 src/glyphs.json（字形轮廓 -> 汉字）。
//
// 用法：bun scripts/build-glyphmap.ts <字体哈希>
//
// 原理：参考字体里字形名是 gid<数字>，减去 58344 得到 scripts/vgid-dict.json 里的下标，
// 查到汉字。这个字典来自 ying-ck/fanqienovel-downloader（AGPL-3.0）。字形名只在
// 这一个参考字体里可信（已用真实章节核对），所以只用它建表；其他字体一律按轮廓查。
import * as fontkit from 'fontkit'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPua, outlineKey } from '../src/fonts.ts'

const hash = process.argv[2]
if (!hash) {
  console.error('用法：bun scripts/build-glyphmap.ts <字体哈希>，例如 dc027189e0ba4cd')
  process.exit(1)
}
const dict = JSON.parse(readFileSync(join(import.meta.dir, 'vgid-dict.json'), 'utf8')) as string[]
const res = await fetch(`https://lf6-awef.bytetos.com/obj/awesome-font/c/${hash}.woff2`)
if (!res.ok) throw new Error(`下载字体失败：HTTP ${res.status}`)
const font = fontkit.create(Buffer.from(await res.arrayBuffer())) as fontkit.Font

const glyphs: Record<string, string> = {}
for (const cp of font.characterSet) {
  if (!isPua(cp)) continue
  const gid = /^gid(\d+)$/.exec(font.glyphForCodePoint(cp).name)?.[1]
  const ch = gid ? dict[Number(gid) - 58344] : undefined
  if (ch && ch !== '?') glyphs[outlineKey(font, cp)] = ch
}
writeFileSync(join(import.meta.dir, '..', 'src', 'glyphs.json'), JSON.stringify(glyphs, null, 0))
console.log(`写入 ${Object.keys(glyphs).length} 个字形`)
