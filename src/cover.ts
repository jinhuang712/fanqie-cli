// 封面。接口给的封面地址带签名、很快过期（403），但图片在 CDN 上的路径是固定的：
// novel-pic/<哈希>。去掉签名，用不用签名的原图地址，实测可以直接打开
const COVER_CDN = "https://p3-novel.byteimg.com/origin/";

// 接受封面路径（novel-pic/xxx）或带签名的完整地址；认不出就返回空串
export function coverUrl(source: string | undefined | null): string {
  const m = /novel-pic\/[0-9A-Za-z]+/.exec(source ?? "");
  return m ? COVER_CDN + m[0] : "";
}
