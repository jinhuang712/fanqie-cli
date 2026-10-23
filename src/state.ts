import { networkError } from "./errors.ts";

// 番茄网页把页面数据放在 window.__INITIAL_STATE__ = {...}，里面可能有 :undefined
export function extractState(html: string): Record<string, any> {
  const m = /window\.__INITIAL_STATE__\s*=\s*/.exec(html);
  if (!m) throw networkError("页面里没有数据，可能被番茄拦截，或者页面结构变了");
  const start = m.index + m[0].length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) throw networkError("页面数据不完整，可能被番茄拦截，请稍后重试");
  try {
    return JSON.parse(html.slice(start, end).replace(/:undefined/g, ":null"));
  } catch {
    throw networkError("页面数据解析失败，页面结构可能变了");
  }
}
