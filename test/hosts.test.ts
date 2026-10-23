import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findViolations } from '../scripts/check-hosts.ts'

test('G5：源码里没有白名单之外的主机名', () => {
  expect(findViolations(join(import.meta.dir, '..', 'src'))).toEqual([])
})

test('能发现白名单之外的主机名，忽略注释', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hosts-'))
  writeFileSync(join(dir, 'a.ts'), "const a = 'https://evil.example.com/x' // 提到 other.org 不算\nconst b = 'https://novel.snssdk.com/y'\n")
  expect(findViolations(dir)).toEqual([{ file: 'a.ts', host: 'evil.example.com' }])
})
