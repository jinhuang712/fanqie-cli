import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { networkError } from "./errors.ts";

export interface QrWindow {
  // 窗口被用户关闭（或进程退出）时完成
  closed: Promise<void>;
  close(): void;
}

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const CHROME_COMMANDS = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
];

export function findChrome(): string | undefined {
  return (
    CHROME_PATHS.find((p) => existsSync(p)) ??
    CHROME_COMMANDS.map((c) => Bun.which(c)).find(Boolean) ??
    undefined
  );
}

export const qrPage = (png: string): string => `<!doctype html>
<html lang="zh-CN" translate="no"><head><meta charset="utf-8"><meta name="google" content="notranslate"><title>番茄小说登录</title>
<style>
  body{margin:0;font:15px -apple-system,"PingFang SC",sans-serif;text-align:center;background:#fff;color:#222}
  img{width:260px;height:260px;margin-top:28px;image-rendering:pixelated}
  p{margin:14px 24px;line-height:1.5}
  small{color:#888}
  .vip{margin:0 24px;padding:6px 10px;font-size:12px;line-height:1.5;color:#a8550f;background:#fff4e5;border-radius:6px}
</style></head><body>
<img src="data:image/png;base64,${png}" alt="二维码">
<p>用番茄小说 App 扫码<br>并在手机上确认登录</p>
<p><small>登录成功后这个窗口会自动关闭</small></p>
<p class="vip">没有开通 SVIP 的账号，只能读前 10 章左右</p>
</body></html>`;

// 只弹一个小窗显示二维码；番茄的页面不会打开
export function openQrWindow(png: string): QrWindow {
  const chrome = findChrome();
  if (!chrome) {
    throw networkError("没有找到 Chrome 或 Edge，没法弹出二维码窗口。请安装 Google Chrome 后重试");
  }
  const dir = mkdtempSync(join(tmpdir(), "fanqie-qr-"));
  mkdirSync(join(dir, "profile"));
  const html = join(dir, "index.html");
  writeFileSync(html, qrPage(png));
  const proc = Bun.spawn(
    [
      chrome,
      `--app=file://${html}`,
      `--user-data-dir=${join(dir, "profile")}`,
      "--window-size=340,500",
      // 不要弹出翻译栏，它会盖住二维码
      "--lang=zh-CN",
      "--disable-features=Translate,TranslateUI",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
    ],
    { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
  );
  const closed = proc.exited.then(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    closed,
    close: () => {
      proc.kill();
    },
  };
}
