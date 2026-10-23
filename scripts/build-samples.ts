// 生成 test/samples.json：回归样本集（G2 的搜索命中、G3 的乱码检查）。
// 样本固定下来提交进仓库；只有想换样本时才重新运行。
// 用法：bun scripts/build-samples.ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { library } from '../src/library.ts'

// 先放几本手工确认过存在的，再用分类库最热的补足到 20 本
const FIXED: Array<[string, string]> = [
  ['7143038691944959011', '十日终焉'],
  ['7276384138653862966', '我不是戏神'],
  ['7256784068786785336', '诡舍'],
  ['7659364597169654808', '重生之都市修仙'],
  ['7683486797782862872', '大奉打更人'],
  ['6982529841564224526', '我在精神病院学斩神'],
  ['6569430662955142157', '捡个杀手做老婆'],
]
// readable: false 的书能搜到但网页读不了（出版书），G2 用，G3 不用
const books: Array<{ id: string; title: string; readable?: boolean }> = FIXED.map(([id, title]) => ({ id, title }))
const UNREADABLE = new Set(['7683486797782862872'])
for (const b of books) if (UNREADABLE.has(b.id)) b.readable = false
for (let page = 1; books.length < 20 && page <= 10; page++) {
  // oxlint-disable-next-line no-await-in-loop
  const r = await library({ sort: 'hot', page })
  for (const b of r.books) {
    // 书名太短或带标点的，搜索时容易有歧义，不要
    if (books.length < 20 && b.title.length >= 4 && !/[，。：？！、（）()《》]/.test(b.title) && !books.some((x) => x.id === b.bookId)) {
      books.push({ id: b.bookId, title: b.title })
    }
  }
}
writeFileSync(join(import.meta.dir, '..', 'test', 'samples.json'), JSON.stringify({ books }, null, 2) + '\n')
console.log(`写入 ${books.length} 本`)
console.log(books.map((b) => `${b.id} ${b.title}`).join('\n'))
