export type ErrorKind = "usage" | "network" | "notfound" | "login";

// 退出码编号见 CLI.md → 退出码
export const EXIT_CODE: Record<ErrorKind, number> = {
  usage: 1,
  network: 2,
  notfound: 3,
  login: 4,
};

export class FanqieError extends Error {
  // 读多章中途失败时，已经读到的结果。文本模式下先输出它，再报错
  partial?: string;

  constructor(
    readonly kind: ErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export const usageError = (message: string) => new FanqieError("usage", message);
export const networkError = (message: string) => new FanqieError("network", message);
export const notFoundError = (message: string) => new FanqieError("notfound", message);
export const loginError = (message: string) => new FanqieError("login", message);
