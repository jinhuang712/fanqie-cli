import { resolve4 } from "node:dns/promises";
import { networkError } from "./errors.ts";
import { cookieHeader, loadJar } from "./jar.ts";

// 番茄会拦截 Linux Chrome 和 curl 的 UA，所以固定用 macOS Chrome 的
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const SITE = "https://fanqienovel.com";

export interface RequestOptions {
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  // 带上登录态。默认带，对非番茄主站的地址不带
  auth?: boolean;
  redirect?: RequestRedirect;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// baseMs：重试的起始间隔；pinIp 关掉就按域名请求；paceMs：两次请求之间的随机间隔（毫秒，[最小, 最大]）。
// 后两个测试里用
export const retryPolicy = { baseMs: 500, pinIp: true, paceMs: [200, 700] as [number, number] };

const between = (min: number, max: number) => min + Math.random() * (max - min);

// 请求之间留一点随机的空档，别像脚本一样连发。第一次请求不等
let lastRequestAt = 0;
async function pace(): Promise<void> {
  const [min, max] = retryPolicy.paceMs;
  const wait = lastRequestAt === 0 ? 0 : lastRequestAt + between(min, max) - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

// 番茄的 DNS 在几组 CDN 之间轮换，有的组（实测 43.109.121.*）一直重置连接。Bun 又在进程内缓存解析结果，
// 碰上坏的一组，重试也连同一个 IP。所以自己解析 IPv4，随机挑一个直连（带 Host 和 SNI），失败的 IP 记下来不再用。
// 实测直连 36/36 成功，按域名请求 24/36，最差一轮整个进程 0/12
const badIps = new Set<string>();
export const markBadIp = (ip: string): void => {
  badIps.add(ip);
};

export async function pickIp(host: string): Promise<string | undefined> {
  try {
    const ips = (await resolve4(host)).filter((ip) => !badIps.has(ip));
    return ips[Math.floor(Math.random() * ips.length)];
  } catch {
    return undefined;
  }
}

// 连接被重置、超时、5xx 和 429 会重试。4xx 原样返回，由调用方判断
export async function request(url: string, opts: RequestOptions = {}): Promise<Response> {
  // 这条网络路径会随机重置连接（实测 25% 到 75%，与请求间隔无关），所以多试几次，间隔越来越长
  const tries = opts.retries ?? 6;
  const headers: Record<string, string> = {
    "user-agent": UA,
    "accept-language": "zh-CN,zh;q=0.9",
    ...opts.headers,
  };
  if (opts.auth !== false && url.startsWith(SITE)) {
    const cookie = cookieHeader(loadJar());
    if (cookie) headers.cookie = cookie;
  }

  let reason = "";
  // 重试必须按顺序等待，所以循环里 await
  for (let i = 0; i < tries; i++) {
    const target = new URL(url);
    // oxlint-disable-next-line no-await-in-loop
    await pace();
    const pin = retryPolicy.pinIp && target.protocol === "https:";
    // oxlint-disable-next-line no-await-in-loop
    const ip = pin ? await pickIp(target.hostname) : undefined;
    try {
      // oxlint-disable-next-line no-await-in-loop
      const res = await fetch(ip ? `https://${ip}${target.pathname}${target.search}` : url, {
        headers: ip ? { ...headers, host: target.hostname } : headers,
        redirect: opts.redirect ?? "follow",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
        ...(ip ? { tls: { serverName: target.hostname } } : {}),
      });
      if (res.status < 500 && res.status !== 429) return res;
      reason = `HTTP ${res.status}`;
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
      if (ip) markBadIp(ip);
    }
    // oxlint-disable-next-line no-await-in-loop
    if (i < tries - 1) await sleep(retryPolicy.baseMs * 2 ** i * between(0.7, 1.3));
  }
  const { host, pathname } = new URL(url);
  throw networkError(
    `请求失败（${host}${pathname}）：${reason}。可能是网络不通或被番茄拦截，请稍后重试`,
  );
}

export async function getText(
  url: string,
  opts?: RequestOptions,
): Promise<{ status: number; text: string; zhal: string | null }> {
  const res = await request(url, opts);
  return { status: res.status, text: await res.text(), zhal: res.headers.get("x-tt-zhal") };
}

// T 只出现在返回类型里：调用方声明期望的响应形状，这里不校验
// oxlint-disable-next-line no-unnecessary-type-parameters
export async function getJson<T>(
  url: string,
  opts?: RequestOptions,
): Promise<{ status: number; json: T | undefined }> {
  const { status, text } = await getText(url, opts);
  try {
    return { status, json: JSON.parse(text) as T };
  } catch {
    // 被拦截时服务端可能返回 200 和空内容
    return { status, json: undefined };
  }
}
