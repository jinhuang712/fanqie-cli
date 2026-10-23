import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const script = join(root, 'install.sh');

let tmp: string;
let env: Record<string, string>;

function run(args: string[], extra: Record<string, string> = {}, pathOverride?: string) {
  const r = Bun.spawnSync(['/bin/bash', script, ...args], {
    env: { ...env, ...extra, ...(pathOverride === undefined ? {} : { PATH: pathOverride }) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fanqie-install-'));
  const home = join(tmp, 'home');
  mkdirSync(join(home, '.cache/fanqie-cli'), { recursive: true });
  mkdirSync(join(home, '.config/fanqie-cli'), { recursive: true });
  writeFileSync(join(home, '.cache/fanqie-cli/c'), 'cache');
  writeFileSync(join(home, '.config/fanqie-cli/auth.json'), 'auth');
  env = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    FANQIE_HOME: join(tmp, 'share/fanqie-cli'),
    FANQIE_BIN: join(tmp, 'bin'),
    CLAUDE_SKILLS_DIR: join(tmp, 'skills'),
    FANQIE_INSTALL_SOURCE: root,
    FANQIE_SKIP_DEPS: '1',
  };
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('install.sh', () => {
  test('安装：包装脚本可执行，skill 占位符被替换', () => {
    const r = run([]);
    expect(r.code).toBe(0);
    const wrapper = join(tmp, 'bin/fanqie');
    expect(statSync(wrapper).mode & 0o111).not.toBe(0);
    expect(readFileSync(wrapper, 'utf8')).toContain(join(tmp, 'share/fanqie-cli/src/cli.ts'));
    const skill = readFileSync(join(tmp, 'skills/fanqie-cli/SKILL.md'), 'utf8');
    expect(skill).not.toContain('<仓库根目录>');
    expect(skill).toContain(join(tmp, 'share/fanqie-cli/src/cli.ts'));
    expect(r.out).toContain('0.1.0');
    const help = Bun.spawnSync([wrapper, '--help'], { env, stdout: 'pipe', stderr: 'pipe' });
    expect(help.exitCode).toBe(0);
  });

  test('再装一次（升级）成功，且不残留临时目录', () => {
    expect(run([]).code).toBe(0);
    const left = Bun.spawnSync(['ls', '-A', join(tmp, 'share')]).stdout.toString().trim().split('\n');
    expect(left).toEqual(['fanqie-cli']);
  });

  test('--no-skill 不装 skill', () => {
    rmSync(join(tmp, 'skills'), { recursive: true, force: true });
    expect(run(['--no-skill']).code).toBe(0);
    expect(existsSync(join(tmp, 'skills/fanqie-cli'))).toBe(false);
    expect(existsSync(join(tmp, 'bin/fanqie'))).toBe(true);
  });

  test('--uninstall 删三处，不碰缓存和登录态', () => {
    expect(run([]).code).toBe(0);
    const r = run(['--uninstall']);
    expect(r.code).toBe(0);
    expect(existsSync(join(tmp, 'share/fanqie-cli'))).toBe(false);
    expect(existsSync(join(tmp, 'bin/fanqie'))).toBe(false);
    expect(existsSync(join(tmp, 'skills/fanqie-cli'))).toBe(false);
    expect(readFileSync(join(env.HOME ?? '', '.cache/fanqie-cli/c'), 'utf8')).toBe('cache');
    expect(readFileSync(join(env.HOME ?? '', '.config/fanqie-cli/auth.json'), 'utf8')).toBe('auth');
    expect(r.out).toContain('.config/fanqie-cli');
  });

  test('--uninstall 不删不是自己生成的 fanqie', () => {
    mkdirSync(join(tmp, 'bin'), { recursive: true });
    writeFileSync(join(tmp, 'bin/fanqie'), '#!/bin/sh\necho other\n');
    expect(run(['--uninstall']).code).toBe(0);
    expect(existsSync(join(tmp, 'bin/fanqie'))).toBe(true);
    rmSync(join(tmp, 'bin/fanqie'));
  });

  test('没有 bun：退出码非 0，提示安装方法', () => {
    const bin = join(tmp, 'nobun');
    mkdirSync(bin, { recursive: true });
    for (const t of ['bash', 'env', 'dirname', 'mkdir', 'tar', 'sed', 'grep', 'head', 'rm', 'mv', 'cp', 'cat', 'mktemp', 'chmod']) {
      const p = Bun.which(t);
      if (p) Bun.spawnSync(['ln', '-sf', p, join(bin, t)]);
    }
    const r = run([], {}, bin);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('https://bun.sh/install');
    expect(existsSync(join(tmp, 'bin/fanqie'))).toBe(false);
  });

  test('下载地址：main 和指定版本', () => {
    expect(run(['--print-url']).out.trim()).toBe('https://github.com/jinhuang712/fanqie-cli/archive/refs/heads/main.tar.gz');
    expect(run(['--version', 'v1.2.3', '--print-url']).out.trim()).toBe(
      'https://github.com/jinhuang712/fanqie-cli/archive/refs/tags/v1.2.3.tar.gz',
    );
    expect(run(['--version', 'a/b', '--print-url']).code).not.toBe(0);
  });

  test('不认识的参数报错', () => {
    expect(run(['--nope']).code).not.toBe(0);
  });
});
