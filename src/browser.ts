import { chromium, type Browser, type Page } from "playwright-core";
import { networkError } from "./errors.ts";
import { SITE, UA, markBadIp, pickIp } from "./http.ts";
import { findChrome } from "./qrwindow.ts";

// 网页版有些接口（例如按最新、最热排序的搜索）要签名，签名由页面自己的脚本补上。
// 所以这类请求要在真实浏览器的页面里发。浏览器只在这时启动，用本机的 Chrome 或 Edge。

export interface InPageResponse {
  status: number;
  text: string;
  zhal: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HOST = new URL(SITE).hostname;

// 只放行主站、前端脚本和签名脚本所在的域名；统计、监控、广告一律不加载。实测从 7.2 秒降到约 2.5 秒
const ALLOWED_HOSTS =
  /(^|\.)(fanqienovel\.com|fqnovelstatic\.com|bytegoofy\.com|yhgfb-cn-static\.com|bytetos\.com|byteimg\.com)$/;

// 浏览器和 HTTP 请求一样会撞上会重置连接的 CDN 节点。启动时用 --host-resolver-rules
// 把主站固定到一个挑好的 IPv4，失败了就换一个 IP 重新启动
async function launch(ip: string | undefined): Promise<Browser> {
  const executablePath = findChrome();
  if (!executablePath)
    throw networkError("没有找到 Chrome 或 Edge，这个功能需要浏览器。请安装 Google Chrome 后重试");
  return chromium.launch({
    executablePath,
    headless: true,
    args: ip ? [`--host-resolver-rules=MAP ${HOST} ${ip}`] : [],
  });
}

async function openHome(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ userAgent: UA, locale: "zh-CN" });
  // 只要脚本能跑：图片、字体、样式、媒体都不加载，快很多
  await context.route("**/*", (route) => {
    const req = route.request();
    const skip =
      ["image", "media", "font", "stylesheet"].includes(req.resourceType()) ||
      !ALLOWED_HOSTS.test(new URL(req.url()).hostname);
    return skip ? route.abort() : route.continue();
  });
  const page = await context.newPage();
  // 只等到服务器开始响应：脚本是一边加载一边就位的，后面会轮询到它能给请求签名为止
  await page.goto(`${SITE}/`, { waitUntil: "commit", timeout: 25_000 });
  return page;
}

// 在页面里 GET 一个同源接口。签名还没就位时服务端返回空内容，会重试几次
async function getOnce(path: string, ip: string | undefined): Promise<InPageResponse> {
  const browser = await launch(ip);
  try {
    const page = await openHome(browser);
    let last: InPageResponse = { status: 0, text: "", zhal: null };
    // 页面脚本还没给 fetch 装上签名时，服务端返回空内容；每 0.4 秒试一次，最多等 20 秒
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      await sleep(400);
      try {
        // oxlint-disable-next-line no-await-in-loop
        last = await page.evaluate(async (p) => {
          const r = await fetch(p, { credentials: "include" });
          return { status: r.status, text: await r.text(), zhal: r.headers.get("x-tt-zhal") };
        }, path);
      } catch {
        // 页面还在跳转，执行上下文没了；下一轮再试
      }
      if (last.text) return last;
    }
    return last;
  } finally {
    await browser.close();
  }
}

export async function pageGet(path: string): Promise<InPageResponse> {
  let reason = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    // oxlint-disable-next-line no-await-in-loop
    const ip = await pickIp(HOST);
    try {
      // oxlint-disable-next-line no-await-in-loop
      return await getOnce(path, ip);
    } catch (e) {
      if (e instanceof Error && e.message.includes("没有找到 Chrome")) throw e;
      reason = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);
      if (ip) markBadIp(ip);
      // oxlint-disable-next-line no-await-in-loop
      await sleep(1500 * (attempt + 1));
    }
  }
  throw networkError(`浏览器打不开番茄首页：${reason}。可能被番茄拦截，请稍后重试`);
}
