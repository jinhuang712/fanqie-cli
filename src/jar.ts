import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./paths.ts";

export type Jar = Record<string, string>;

interface AuthFile {
  cookies: Jar;
  savedAt: string;
}

const authPath = () => join(configDir(), "auth.json");

export function loadJar(): Jar {
  try {
    return (JSON.parse(readFileSync(authPath(), "utf8")) as AuthFile).cookies ?? {};
  } catch {
    return {};
  }
}

export function saveJar(cookies: Jar): void {
  mkdirSync(configDir(), { recursive: true });
  const file: AuthFile = { cookies, savedAt: new Date().toISOString() };
  writeFileSync(authPath(), JSON.stringify(file, null, 2));
  chmodSync(authPath(), 0o600);
}

export function clearJar(): void {
  if (existsSync(authPath())) rmSync(authPath());
}

// 合并响应里的 Set-Cookie；已过期的 Cookie 从 jar 里删掉
export function mergeSetCookie(jar: Jar, res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";").map((s) => s.trim());
    const eq = pair?.indexOf("=") ?? -1;
    if (!pair || eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const maxAge = attrs.find((a) => /^max-age=/i.test(a))?.split("=")[1];
    const expires = attrs.find((a) => /^expires=/i.test(a))?.slice(8);
    const expired = maxAge === "0" || (expires !== undefined && Date.parse(expires) < Date.now());
    if (expired || value === "") delete jar[name];
    else jar[name] = value;
  }
}

export const cookieHeader = (jar: Jar): string =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
