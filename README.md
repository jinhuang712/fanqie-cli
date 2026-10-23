<!-- what-we-build: approved 2026-10-23 -->

# 🍅 fanqie-cli

[![CI](https://github.com/jinhuang712/fanqie-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jinhuang712/fanqie-cli/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/jinhuang712/fanqie-cli?color=ff6b35)](https://github.com/jinhuang712/fanqie-cli/releases)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![bun](https://img.shields.io/badge/bun-%E2%89%A51.4-f472b6?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![macOS](https://img.shields.io/badge/tested%20on-macOS-lightgrey?logo=apple&logoColor=white)](INSTALL.md)

> 📚 番茄小说的命令行：搜索、榜单、目录、正文，给 Agent 和脚本用。

所有数据直接来自番茄小说官方站点，不经过任何第三方服务器。默认输出是带字段名的类 YAML 文本，也能输出 JSON；失败时有固定的退出码，所以 Agent 不用解析报错文字。

> [!WARNING]
> **版权与使用声明**
>
> - 本项目与字节跳动、番茄小说**没有任何关系**，不隶属于它们，也未获得它们的认可。
> - 小说的内容属于作者和平台。这个工具**仅供个人学习和研究**（比如研究开篇节奏和文风）：不要批量抓取整本书、不要再分发小说原文、不要把原文大段放进代码、文档或公开输出里、不要用于商业用途。
> - 它**不绕过**番茄的登录和付费：前 10 章左右之外的章节，网页版要登录并开通 SVIP 会员才能读，这个工具只读你的账号本来就能读到的内容。
> - 使用前请先看番茄小说的用户协议，后果自负。

## ✨ 功能

- 🔎 **找书**：关键词搜索（可按最新、最热排序）、男频女频的阅读榜和新书榜、按分类和状态和字数筛选的分类库。
- 📖 **看书**：书籍详情、目录、按章节序号读一章或多章正文（一次最多 20 章）。读过的章节缓存 7 天，再读不联网。
- 🔑 **登录**：弹出一个只有二维码的小窗，用番茄 App 扫码。
- 🧾 **输出**：默认是带字段名的类 YAML 文本，`--json` 输出 JSON，`--raw` 输出接口原始响应。
- 🔤 **不乱码**：番茄用自定义字体加密文字，这里按字形轮廓还原，每个响应用它自己的字体。

每个功能的细节见 [FEATURES.md](FEATURES.md)。

## 🚀 安装

```bash
curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh | bash
```

装好后直接敲 `fanqie`，同时会装好 Claude Code skill。需要 [bun](https://bun.sh) 1.4 或更新版本；不用 sudo，不改 shell 配置。参数、升级、卸载、手动安装见 [INSTALL.md](INSTALL.md)。

## 🧭 使用

先搜书拿到书 id，再用书 id 看详情、目录和正文（用一行安装的，直接敲 `fanqie`）：

```bash
fanqie search 修仙                       # 搜索，输出里有 书id
fanqie rank --category 西方奇幻           # 榜单
fanqie book <书id>                       # 书籍详情
fanqie toc <书id>                        # 目录
fanqie read <书id> 1-3                   # 读第 1 到 3 章
fanqie search 修仙 秦始皇 --brief         # 多个关键词合并，只要基本字段
fanqie search 修仙 --json | jq '.books[0]'
```

手动安装的，在仓库目录里把 `fanqie` 换成 `bun src/cli.ts`。

> [!TIP]
> 用 `bun run` 启动时要加 `--silent`，否则 bun 会往 stdout 打印一行命令，破坏 JSON：
>
> ```bash
> bun run --silent fanqie search 修仙 --json | jq '.books[0]'
> ```

全部命令、参数、示例输出和退出码见 [CLI.md](CLI.md)。

## 🤖 给 Agent 用：Claude Code skill

仓库里带了一个 skill，装上后 Claude Code 这类 coding agent 能认出这个 CLI，知道什么时候用、怎么用。一行安装已经装好了，手动安装见 [INSTALL.md](INSTALL.md)。

## ⚠️ 已知限制

> [!IMPORTANT]
> **前 10 章左右之外的章节，网页版要 SVIP 会员才能读全。** 只登录不够：已登录但没有 SVIP 的账号读这些章节仍然失败。

- 🚫 没有书评和段评：番茄网页端没有评论列表，评论只在 App 里，要 App 签名，所以不做。
- 📕 部分出版书网页不提供，搜得到但读不了。
- 🌐 搜索按最新、最热排序，以及扫码登录，需要本机装有 Chrome 或 Edge；排序搜索约 3 秒。
- 🔤 番茄换了新的加密字形时：macOS 上会自动用系统自带的文字识别补认（约 90% 准确，会在 stderr 提示）；其他系统读正文会失败，需要更新字形表。
- 🍎 只在 macOS 上测过。
- 📡 番茄的连接会随机被重置，命令会自动重试几次；连续失败时报网络错误，稍后再试。

## 📊 实测数据

2026-10-23 在一台 macOS 机器、家用网络、一个 SVIP 账号上测的。每项的测法见 [GOALS.md](GOALS.md)。

| 项                    | 数值                                                |
| --------------------- | --------------------------------------------------- |
| 🟢 相关排序搜索       | 约 1.0 秒                                           |
| 🟡 最新、最热搜索     | 约 3.2 秒（要启动浏览器）                           |
| 🟢 读一章，第一次     | 约 0.6 秒                                           |
| ⚡ 读一章，缓存命中   | 约 2 毫秒，不联网                                   |
| 🟢 连续读 100 章      | 约 57 秒（约 0.57 秒/章），5 批每批 20 章，全部成功 |
| 🟢 无间隔连续读 60 章 | 28 秒，没有被限流                                   |
| ✅ 文字还原           | 19 本书 × 前 10 章，共 190 章，0 个乱码             |
| ✅ 搜索命中           | 20 本书名，目标书全部在前 3 条（样本偏热门书）      |

> [!NOTE]
> 数字会随网络变化，只当参考。这只是少量、短时间的测量：没测并发和长时间大批量读，不保证不被限流。

## 🧪 测试与持续集成

```bash
bun run typecheck     # 类型检查
bun test              # 单元测试，不联网
bun run test:live     # 联网回归测试（约 8 分钟），对应 GOALS.md 的 G1 到 G6
bun run check:hosts   # 源码里的主机名必须在官方白名单内
bun run check:fonts   # 站上在用的字体，字形表是否全部认得（联网）
```

GitHub Actions 在每次推送和 PR 时跑类型检查、单元测试和域名检查；每周一次检查番茄是否换了新字形。联网回归测试不放在 CI 里（要 Chrome 和真实网络，而且番茄的连接会随机重置）。

## 📚 文档

| 文档                         | 回答什么                                                 |
| ---------------------------- | -------------------------------------------------------- |
| [INSTALL.md](INSTALL.md)     | 安装、升级、卸载的全部细节                               |
| [FEATURES.md](FEATURES.md)   | 每个功能做什么，做到哪一步，为什么这样做                 |
| [CLI.md](CLI.md)             | 每条命令的参数、取值、默认值、输出字段、示例输出和退出码 |
| [GOALS.md](GOALS.md)         | 用哪些数字衡量项目，以及现在的测量结果                   |
| [ROADMAP.md](ROADMAP.md)     | 什么时候做什么，做到哪一步                               |
| [TODO.md](TODO.md)           | 还没有里程碑的小修和待查事项                             |
| [CHANGELOG.md](CHANGELOG.md) | 每个版本改了什么                                         |
| [CLAUDE.md](CLAUDE.md)       | 给维护者：设计决策和踩过的坑                             |

## ⚖️ 许可证

[AGPL-3.0-or-later](LICENSE)：可以免费使用和修改。你分发修改过的版本，或把它做成网络服务提供给别人用，必须用同一协议公开全部源码。自己使用、通过命令行调用它，不需要开源。
