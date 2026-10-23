<!-- what-we-build: drafted 2026-10-23 -->

# 安装

## 前置条件

- [bun](https://bun.sh) 1.4 或更新版本。
- 排序搜索和扫码登录还需要本机装有 Chrome 或 Edge。
- 只在 macOS 上测过。

## 一行安装

```bash
curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh | bash
```

它会：

- 把代码装到 `~/.local/share/fanqie-cli`。
- 在 `~/.local/bin/fanqie` 生成全局命令，装完直接敲 `fanqie search 修仙`。
- 把 Claude Code skill 装到 `~/.claude/skills/fanqie-cli`。

它不会：

- 不用 sudo。
- 不改 `.zshrc`、`.bashrc` 等配置文件。如果 `~/.local/bin` 不在 PATH 里，脚本会告诉你怎么加。
- 不替你装 bun。没有 bun 时只提示安装方法，加 `--install-bun` 表示同意它安装。

再运行一次同样的命令就是升级。升级失败不会留下装了一半的版本。

## 参数

参数写在 `bash -s --` 后面：

```bash
# 只装命令行，不装 skill
curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh | bash -s -- --no-skill

# 装指定版本
curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh | bash -s -- --version v0.1.0

# 卸载
curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh | bash -s -- --uninstall
```

| 参数              | 作用                          |
| ----------------- | ----------------------------- |
| `--version <tag>` | 装指定版本，默认装 `main`     |
| `--no-skill`      | 只装命令行，不装 skill        |
| `--install-bun`   | 没有 bun 时，同意脚本替你安装 |
| `--uninstall`     | 卸载                          |
| `--help`          | 显示用法                      |

安装位置可以用环境变量改：`FANQIE_HOME`（代码）、`FANQIE_BIN`（命令）、`CLAUDE_SKILLS_DIR`（skill）。

## 卸载

`--uninstall` 只删安装目录、`fanqie` 命令和 skill，**不删**缓存和登录态，结束时会告诉你它们的位置：

- 缓存：`~/.cache/fanqie-cli`
- 登录态：`~/.config/fanqie-cli`

想彻底清掉，自己删这两个目录。

## 想先看脚本再运行

```bash
curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh -o install.sh
less install.sh
bash install.sh
```

## 手动安装

```bash
git clone https://github.com/jinhuang712/fanqie-cli.git
cd fanqie-cli
bun install
```

在仓库目录里用 `bun src/cli.ts <命令>` 代替 `fanqie <命令>`。

## 手动安装 skill

```bash
cp -r skills/fanqie-cli ~/.claude/skills/
```

再把 `~/.claude/skills/fanqie-cli/SKILL.md` 里的 `<仓库根目录>` 换成你克隆的路径。细节见 [skills/README.md](skills/README.md)。
