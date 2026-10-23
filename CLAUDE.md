# fanqie-cli

番茄小说的命令行，bun + TypeScript。文档在仓库根目录：`FEATURES.md`（做什么）、`CLI.md`（命令速查）、`GOALS.md`（数字）、`ROADMAP.md`（进度）、`TODO.md`（待查）。这份文件只写**给维护者的决策和陷阱**，不重复那些文档。

## 常用命令

```bash
bun install
bun run typecheck           # tsc --noEmit
bun test                    # 单元测试，不联网
bun run test:live           # 联网回归测试，对应 GOALS.md 的 G1 到 G6
bun run check:hosts         # G5：源码里的主机名必须在官方白名单内
bun run check:fonts         # 站上在用的字体，字形表是否全部认得（联网）
bun src/cli.ts search 修仙   # 直接跑；用 bun run 要加 --silent，否则 bun 会往 stdout 打印一行命令，破坏 JSON
```

提交前 broom 钩子会跑 oxlint，有问题会拦住提交。**检查命令别用 `| tail`、`| grep` 吞退出码**，否则类型错误和失败的测试会被提交进去（这个仓库已经发生过一次）。

## 决策（ROADMAP 里几次设计讨论的结论）

### 请求优先走 HTTP，只有要签名的才走浏览器（D2.1）

实测不需要登录也不需要签名、Bun 直接发 HTTP 就能拿到的：榜单、分类库、分类列表、书页、目录、阅读页、二维码登录。只有网页版搜索（按最新、最热排序）要 `a_bogus` 签名，签名由页面自己的脚本补，所以这一条用 `playwright-core` 驱动本机 Chrome 或 Edge，在页面里 `fetch`（`src/browser.ts`）。不要把更多请求挪进浏览器：慢（约 3 秒）。不自己实现 `a_bogus`：算法随时会变。

浏览器那条路要屏蔽图片、字体、样式并只等 `domcontentloaded`，否则要 60 秒以上。

### 字体还原按字形轮廓查汉字，字体现场取（D2.2）

番茄把高频字换成私有区字符 U+E3E8 到 U+E55B。**同一个码位在不同字体里对应不同的字，字形名是障眼法，只有字形轮廓可信**（两个字体的 362 个轮廓完全一样，但码位排布不同，字形名却相同）。流程：

1. 响应告诉我们用哪个字体：页面 HTML 里的 `@font-face`（`awesome-font/c/<哈希>.woff2`），或接口响应头 `x-tt-zhal: k=..;f=<哈希>;...`。
2. 下载字体（`lf6-awef.bytetos.com` 或 `lf3-awef.bytetos.com`），用 `fontkit` 解析，算每个字形轮廓的哈希，在 `src/glyphs.json`（轮廓 → 汉字）里查。
3. 字体按哈希永久缓存在 `~/.cache/fanqie-cli/fonts/`。

`src/glyphs.json` 由 `scripts/build-glyphmap.ts` 用一个已核对过的参考字体生成，字典 `scripts/vgid-dict.json` 来自 ying-ck/fanqienovel-downloader（AGPL-3.0，本项目同为 AGPL-3.0-or-later）。**番茄出现新字形时，还原不了的字符会留在文本里，stderr 警告，`test:live` 的 G3 会失败**——这时重新运行 build-glyphmap。不同接口用不同字体（分类库和榜单就不同），所以每个响应都要按它自己的字体还原，不要用全局映射。

### 连接会被随机重置：根因是 DNS 轮换到坏的 CDN 节点（D2.3）

最初以为是风控，实际查下来不是：`fanqienovel.com` 的 DNS 在几组 CDN 之间轮换，**`43.109.121.*` 这 8 个 IP 和 `112.90.76.103` 对 curl 一律重置连接**，其余 9 个正常。Bun 又在进程内缓存解析结果，碰上坏的一组，重试也连同一个 IP；整个进程可以 0/12 全败。自己解析 IPv4、随机挑一个直连：36/36 成功，按域名请求只有 24/36。所以 `src/http.ts`：

- 每次请求前用 `resolve4` 自己解析，随机挑一个没被标记的 IPv4，直连并带上 `Host` 头和 `tls.serverName`；失败的 IP 记入进程内黑名单。
- 最多重试 6 次，间隔 0.5、1、2、4、8 秒再乘一个 0.7 到 1.3 的随机数，总预算约 15 秒。
- 请求之间有 200 到 700 毫秒的随机空档（`retryPolicy.paceMs`），不像脚本那样连发。第一次请求不等。
- 浏览器那条路也一样：`src/browser.ts` 用 `--host-resolver-rules=MAP fanqienovel.com <IP>` 把主站固定到挑好的 IP，打不开就换 IP 重启，最多 3 次。每次命令起新浏览器，不用持久 profile。

测试里把 `retryPolicy.pinIp` 关掉、`paceMs` 设成 `[0, 0]`、`baseMs` 调小。

### 缓存（FEATURES.md F7）

- 正文缓存 7 天（`src/cache.ts`）。
- **另外缓存了"章节序号 → 章节 ID"的对应**（`index/`），同样 7 天。原因：不缓存的话，读一章必须先请求一次目录，G4（第二次读取 0 次请求）就做不到。它只用来定位正文，不出现在输出里；`toc` 命令仍然实时。章节只会追加，已有序号不变；请求的序号超出缓存时重新取目录。
- 只缓存完整的章节：被锁的章节直接报错，不写缓存。

### 登录（D3.1）

扫码接口是 `/passport/web/get_qrcode/` 和 `/passport/web/check_qrconnect/`，直接 HTTP 就能调，二维码是接口给的 base64 PNG。所以"小窗"不需要番茄页面：写一个只有二维码的 HTML，用本机 Chrome 的 `--app` 模式弹一个 340×500 的窗口（`src/qrwindow.ts`）。要带 `--disable-features=Translate,TranslateUI`，否则 Chrome 的翻译栏会盖住二维码。确认后沿着 `redirect_url` 的跳转链收 Cookie，存到 `~/.config/fanqie-cli/auth.json`（权限 600）。

**登录不等于能读全文**：网页版读前 10 章之后的章节要 SVIP 会员（用户的会员权益表上写着"会员网页读：SVIP 网页可读全文"）。已验证：登录成功的账号读第 11 章，阅读页和目录里 `isChapterLock` 仍是 `true`。开通 SVIP 后同一个登录态不用重新登录就能读（已验证：第 11 到 13 章完整，目录里的 `isChapterLock` 也变成 `false`）。所以读被锁的章节失败时，退出码是 4，提示里要说清楚需要 SVIP。

### 测试用的环境变量

`FANQIE_CACHE_DIR`、`FANQIE_CONFIG_DIR` 只给测试用，用来把缓存和登录态指到临时目录，不要写进用户文档。

### OCR 兜底（`src/ocr.ts`）

字体里出现字形表（`src/glyphs.json`）没有的新字形时，`getFontMap` 会补救：把每个缺的字形画成 SVG（轮廓取自字体本身），一行重复 3 次，用无头 Chrome 截图，再用 macOS 的 Vision 文字识别（Swift 小程序，第一次用时编译到 `~/.cache/fanqie-cli/bin/`）认字。**候选只限"字形表里还没被这个字体用掉的字"**——新字体只是把同样的字重新排列，这个限制把准确率从 77% 提到约 90%。`bun scripts/measure-ocr.ts <字体哈希> few` 可以重新量：随机拿掉 15 个已知字形，实测 67 / 75 = 89.3%；联网回归里拿掉 12 个，362 个字里对 361 个。

- 只在 macOS 上有，设 `FANQIE_NO_OCR=1` 关闭。
- **结果不写进全局字形表**，只留在这个字体的缓存（`fonts/<哈希>.json` 的 `ocr` 字段）：OCR 会认错，写进全局表错字就会扩散到别的字体。
- 每次用到这个字体都在 stderr 提示"有 N 个新字形是 OCR 认出来的"。
- 正确的做法仍然是重新运行 `scripts/build-glyphmap.ts` 更新字形表；OCR 只是更新之前的过渡。
- 没有整页截图：整页 OCR 要把识别结果对回到具体的私有区字符，逐个字形渲染一张图就是一个字，没有对不回去的问题。

## 陷阱

- 番茄首页和 `/library`、`/search/…` 在浏览器里直接打开偶尔被连接重置：同一个原因（坏的 CDN 节点），不是这几个页面特殊。
- 读正文遇到还原不了的字符，会重新取最多 2 次，仍然不行就失败且不缓存。设 `FANQIE_DEBUG=1` 会在 stderr 打印每次用到的字体哈希和认出的字形数。
- 想提前知道番茄是否换了新字形：`bun run check:fonts`（联网）。它收集首页、榜单页、阅读页和两个接口当前在用的字体，逐个统计私有区字形里字形表认得、不认得几个，有不认得的退出码为 1；不走 OCR、不写缓存、不改 `glyphs.json`。
- 搜索的评分字段在移动端接口里是常量 8.5（49 条结果实测），已经去掉，不要加回来。
- 榜单阅读榜对应 `rankMold=2`，新书榜对应 `rankMold=1`。已核实（2026-10-23）：阅读榜按阅读量降序、有大量老书；新书榜全是新书、字数 14 到 28 万。
- `creation_status` 在各处都是 0 完结、1 连载。
- 书页对不存在、已下架、出版付费书都返回 HTTP 404；目录接口对不存在的书返回 code 0 和空目录，要自己判断。
- 目录响应没有 `x-tt-zhal`，章节标题是明文。
- `scripts/check-hosts.ts` 删注释时，`//` 前面必须是行首或空白，否则会把 `https://` 当成注释，检查就废了。
