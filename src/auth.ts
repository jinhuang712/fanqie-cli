import { loginError, networkError } from "./errors.ts";
import { SITE, request } from "./http.ts";
import { cookieHeader, loadJar, mergeSetCookie, saveJar, type Jar } from "./jar.ts";

const PASSPORT_QUERY =
  "aid=2503&app_name=novelapp&version_code=57700&device_platform=web&channel=novel&sdk_version=1.6.1&passport_sdk_version=2.0.0&new_user=0";
const NEXT = encodeURIComponent(`${SITE}/`);

// 登录后番茄会种下 sessionid
export const hasSession = (): boolean => {
  const jar = loadJar();
  return Boolean(jar.sessionid || jar.sid_tt);
};

export interface QrTicket {
  token: string;
  // 二维码 PNG，base64
  png: string;
  // 过期时间，毫秒时间戳
  expiresAt: number;
  jar: Jar;
}

interface Passport<T> {
  data?: T & { error_code?: number; description?: string };
  message?: string;
}

async function passport<T>(path: string, extra: string, jar: Jar): Promise<Passport<T>> {
  const url = `${SITE}${path}?next=${NEXT}${extra}&${PASSPORT_QUERY}`;
  const res = await request(url, { auth: false, headers: { cookie: cookieHeader(jar) } });
  mergeSetCookie(jar, res);
  try {
    return (await res.json()) as Passport<T>;
  } catch {
    throw networkError("登录接口没有返回数据，可能被番茄拦截，请稍后重试");
  }
}

export async function startQr(): Promise<QrTicket> {
  const jar: Jar = {};
  const j = await passport<{ token: string; qrcode: string; expire_time: number }>(
    "/passport/web/get_qrcode/",
    "",
    jar,
  );
  const d = j.data;
  if (!d || d.error_code || !d.token || !d.qrcode)
    throw networkError(`获取二维码失败：${d?.description ?? j.message ?? "接口没有给出二维码"}`);
  return {
    token: d.token,
    png: d.qrcode,
    expiresAt: d.expire_time ? d.expire_time * 1000 : Date.now() + 120_000,
    jar,
  };
}

export type QrStatus = "new" | "scanned" | "confirmed" | "expired";

export async function checkQr(t: QrTicket): Promise<{ status: QrStatus; redirectUrl?: string }> {
  const j = await passport<{ status: string; redirect_url?: string }>(
    "/passport/web/check_qrconnect/",
    `&token=${encodeURIComponent(t.token)}`,
    t.jar,
  );
  const d = j.data;
  if (!d) return { status: "new" };
  if (d.error_code) throw networkError(`二维码状态异常：${d.description ?? d.error_code}`);
  if (d.redirect_url || d.status === "confirmed")
    return { status: "confirmed", redirectUrl: d.redirect_url };
  return { status: d.status === "scanned" || d.status === "expired" ? d.status : "new" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 等用户扫码并在手机上确认。window 关闭或过期时放弃
export async function waitForConfirm(
  t: QrTicket,
  windowClosed: Promise<void>,
  onScanned: () => void,
): Promise<string> {
  // 窗口关闭由 promise 回调置位，循环里读它
  const win = { closed: false };
  void windowClosed.then(() => {
    win.closed = true;
  });
  let announced = false;
  while (!win.closed && Date.now() < t.expiresAt) {
    // oxlint-disable-next-line no-await-in-loop
    const r = await checkQr(t);
    if (r.status === "confirmed") return r.redirectUrl ?? `${SITE}/`;
    if (r.status === "expired") break;
    if (r.status === "scanned" && !announced) {
      announced = true;
      onScanned();
    }
    // oxlint-disable-next-line no-await-in-loop
    await sleep(1500);
  }
  throw networkError(
    win.closed
      ? "登录没有完成：二维码窗口被关闭了"
      : "登录没有完成：二维码已过期，请重新运行 fanqie login",
  );
}

// 确认后沿着跳转链走一遍，把沿途种下的 Cookie 收进 jar
export async function finishLogin(t: QrTicket, redirectUrl: string): Promise<User> {
  let url = redirectUrl;
  for (let hop = 0; hop < 8; hop++) {
    // oxlint-disable-next-line no-await-in-loop
    const res = await request(url, {
      auth: false,
      redirect: "manual",
      headers: { cookie: cookieHeader(t.jar) },
    });
    mergeSetCookie(t.jar, res);
    const next = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !next) break;
    url = new URL(next, url).toString();
  }
  const user = await fetchUser(t.jar);
  if (!user) throw loginError("扫码已确认，但没有建立登录态。请重新运行 fanqie login");
  saveJar(t.jar);
  return user;
}

export interface User {
  id: string;
  name: string;
}

async function fetchUser(jar: Jar): Promise<User | undefined> {
  const res = await request(`${SITE}/api/user/info/v2`, {
    auth: false,
    headers: { cookie: cookieHeader(jar) },
  });
  try {
    const j = (await res.json()) as { code?: number; data?: { id?: string; name?: string } };
    const id = j.data?.id;
    // 未登录时 code 是 -1，data 为空；id 为 0 或 1 也是未登录
    if (j.code !== 0 || !id || id === "0" || id === "1") return undefined;
    return { id, name: j.data?.name ?? "" };
  } catch {
    return undefined;
  }
}

// 没有保存的登录态就不必联网。登录态失效时返回 undefined
export async function currentUser(): Promise<User | undefined> {
  if (!hasSession()) return undefined;
  return fetchUser(loadJar());
}
