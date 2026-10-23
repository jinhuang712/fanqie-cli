#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { unmappedCount } from './api.ts'
import { COMMANDS } from './commands.ts'
import { EXIT_CODE, FanqieError } from './errors.ts'
import type { Options } from './types.ts'

const USAGE = `用法：fanqie <命令> [参数] [选项]

命令：
  search <关键词>              搜索书籍
  rank                        榜单
  library                     分类库
  categories                  分类列表
  book <书籍ID>                书籍详情
  toc <书籍ID>                 目录
  read <书籍ID> <章节>          读正文，章节写 3 或 3-5；或 read --id <章节ID>
                              （前 10 章左右免费，之后网页版要登录并开通 SVIP 会员）
  login                       扫码登录
  whoami                      登录状态
  cache clear                 清除正文缓存

全局选项：--json 输出 JSON；--raw 输出接口原始响应；-h 显示用法
完整说明见 CLI.md
`

const OPTIONS = {
  json: { type: 'boolean', default: false },
  raw: { type: 'boolean', default: false },
  refresh: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  offset: { type: 'string' },
  sort: { type: 'string' },
  gender: { type: 'string' },
  kind: { type: 'string' },
  category: { type: 'string' },
  status: { type: 'string' },
  words: { type: 'string' },
  page: { type: 'string' },
  for: { type: 'string' },
  id: { type: 'string' },
} as const

const write = (stream: NodeJS.WriteStream, text: string) => stream.write(text)

export async function main(argv: string[]): Promise<number> {
  let positionals: string[]
  let values: Options & { help?: boolean }
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
    positionals = parsed.positionals
    values = parsed.values
  } catch (e) {
    write(process.stderr, `${e instanceof Error ? e.message : String(e)}\n`)
    return EXIT_CODE.usage
  }

  const [name, ...rest] = positionals
  if (values.help || !name) {
    write(values.help ? process.stdout : process.stderr, USAGE)
    return name || values.help ? 0 : EXIT_CODE.usage
  }

  // "cache clear" 是两个词的命令
  const key = name === 'cache' ? `cache ${rest.shift() ?? ''}`.trim() : name
  const handler = COMMANDS[key]
  if (!handler) {
    write(process.stderr, `未知命令：${key}\n\n${USAGE}`)
    return EXIT_CODE.usage
  }

  try {
    const out = await handler(rest, values)
    write(process.stdout, values.raw ? JSON.stringify(out.raw, null, 2) + '\n' : values.json ? JSON.stringify(out.json, null, 2) + '\n' : out.text)
    if (unmappedCount() > 0) write(process.stderr, `警告：有 ${unmappedCount()} 个字符没能还原，字形表可能需要更新\n`)
    return 0
  } catch (e) {
    if (e instanceof FanqieError) {
      // 读多章中途失败：文本模式下先输出已读到的章节
      if (e.partial && !values.json && !values.raw) write(process.stdout, e.partial)
      write(process.stderr, `${e.message}\n`)
      return EXIT_CODE[e.kind]
    }
    write(process.stderr, `内部错误：${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
    return 1
  }
}

if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => process.exit(code))
}
