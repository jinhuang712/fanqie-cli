import { homedir } from "node:os";
import { join } from "node:path";

// 环境变量只给测试用，用户不需要设置
export const cacheDir = () =>
  process.env.FANQIE_CACHE_DIR ?? join(homedir(), ".cache", "fanqie-cli");
export const configDir = () =>
  process.env.FANQIE_CONFIG_DIR ?? join(homedir(), ".config", "fanqie-cli");
