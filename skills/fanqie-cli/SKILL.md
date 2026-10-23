---
name: fanqie-cli
description: 番茄小说（fanqienovel.com）命令行 fanqie-cli：搜书、看榜单、按分类找书、查书的详情和目录、读章节正文。用户想搜番茄小说的书、看男频女频榜单、按分类/状态/字数筛书、看某本书的简介和目录、读章节、研究文风和开篇节奏、拆书，或提到"番茄小说""fanqienovel""番茄榜单"时使用。
---

# fanqie-cli：番茄小说命令行

> **版权提醒（先看）**：内容是第三方的网络小说，仅供个人学习和研究。
> - 不要把章节原文大段贴进代码、提交、文档或任何公开输出；
> - 做分析时只引用必要的几句，写自己的分析和结构化笔记（节奏、结构、人设、钩子）；
> - 不要批量抓取整本书；不要绕过登录和付费。

## 调用

```
fanqie <命令> [参数]
```

用一行安装脚本装过的，`fanqie` 已经是全局命令。如果提示找不到 `fanqie`（比如手动安装的、或 `~/.local/bin` 不在 PATH 里），改用完整路径：

```
bun <仓库根目录>/src/cli.ts <命令> [参数]
```

下文的示例都写成 `fanqie ...`，用完整路径时把前缀换掉即可。在仓库根目录里也可以用 `bun run --silent fanqie <命令>`。必须加 `--silent`，否则 bun 会往 stdout 打印一行命令，破坏 `--json` 的输出。

## 命令速查

| 命令 | 用途 | 常用参数 |
|---|---|---|
| `search <关键词>` | 搜书，每页 10 本 | `--offset N`、`--sort relevance\|new\|hot` |
| `rank` | 榜单，每次 10 本、最多 100 本 | `--category <名称或ID>`（必填）、`--gender male\|female`、`--kind read\|new`、`--offset N` |
| `library` | 分类库筛书，每页 18 本 | `--category`、`--gender`、`--status finished\|ongoing`、`--words lt30\|30-50\|50-100\|100-200\|gt200`、`--sort hot\|new\|words`、`--page N` |
| `categories` | 列分类和 ID | `--for rank\|library`、`--gender` |
| `book <书id>` | 详情：简介、字数、章节数、免费章节 | |
| `toc <书id>` | 目录（序号、章节id、标题，锁定章节有标记） | |
| `read <书id> N` / `N-M` / `--id <章节id>` | 读正文 | `--refresh` 忽略缓存 |
| `login` | 弹出二维码窗，扫码登录 | |
| `whoami` | 看是否已登录 | |
| `cache clear` | 清正文缓存 | |

全局选项：`--json`（输出一个 JSON 对象）、`--raw`（接口原始响应）、`-h`。

输出默认是类 YAML 文本，字段名是中文，不保证是严格 YAML；要程序解析请加 `--json`（字段名是英文驼峰，如 `bookId`、`title`、`chapters[].text`）。结果在 stdout，错误在 stderr。

## 退出码

| 码 | 含义 | 怎么办 |
|---|---|---|
| 0 | 成功（"没有结果""未登录"也是 0） | |
| 1 | 用法错误 | 看 stderr 提示改参数；`read` 超过 20 章就分批 |
| 2 | 网络失败或被拦截；需要 Chrome/Edge 但没装 | 稍后重试，别连发；检查是否装了 Chrome |
| 3 | 书、章节或分类不存在 | 用 `search` / `categories` 重新确认 id |
| 4 | 章节超出免费范围 | 提示用户 `login` 扫码并开通 SVIP，不要尝试绕过 |

## 典型用法

```
fanqie search 关键词          # 拿到 书id
fanqie book <书id>            # 简介、字数、章节数
fanqie toc <书id>             # 目录
fanqie read <书id> 1-3        # 读前几章，看开篇节奏
fanqie categories --for rank  # 先查分类名，再 rank --category 名称
```

`read` 的输出：每章一行 `# 标题`，后面是正文，一段一行，章间空一行。

## 限制

- 未登录或没开通 SVIP 时，只能读前 10 章左右；之后要 `login` 扫码并开通 SVIP。`book` 的输出里有"免费章节/锁定章节"行时说明账号读不全。
- `read` 一次最多 20 章。读过的章节缓存 7 天（`--refresh` 可重取）。
- `search --sort new|hot` 要在浏览器里请求：需要本机装 Chrome 或 Edge，约 3 秒；`relevance` 约 1 秒。
- 网络偶尔重置连接，CLI 会自动重试。请求别太密（每分钟不超过 20 个）。
