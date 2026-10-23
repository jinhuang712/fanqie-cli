// G7：已登录时，样本书第 11 到 13 章都完整输出，无截断。
// 需要用户自己的账号（要有 SVIP 会员），所以不能放进自动测试。
// 用法：先 fanqie login，再 bun scripts/check-login.ts
import { currentUser } from '../src/auth.ts'
import { FanqieError } from '../src/errors.ts'
import { readRange } from '../src/read.ts'

const BOOK = '7143038691944959011' // 十日终焉：前 10 章免费，第 11 章起网页版要 SVIP

const user = await currentUser()
if (!user) {
  console.log('未登录。先运行 fanqie login')
  process.exit(1)
}
console.log(`账号：${user.name || user.id}`)
try {
  // 不读缓存：要确认的是现在这个账号能读到
  const { chapters } = await readRange(BOOK, '11-13', { refresh: true, raw: false })
  for (const c of chapters) console.log(`第 ${c.order} 章「${c.title}」${c.text.length} 字`)
  const complete = chapters.length === 3 && chapters.every((c) => c.text.length > 900)
  console.log(complete ? 'G7 通过：3 / 3 章完整' : 'G7 未通过：有章节太短，可能是截断的预览')
  process.exit(complete ? 0 : 1)
} catch (e) {
  console.log(`G7 未通过：${e instanceof FanqieError ? e.message : String(e)}`)
  process.exit(1)
}
