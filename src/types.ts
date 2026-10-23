export interface Output {
  // 默认的结构化文本
  text: string;
  // --json 的内容
  json: unknown;
  // --raw 的内容：接口原始响应，不还原字体、不整理字段
  raw: unknown;
}

export interface Options {
  json: boolean;
  raw: boolean;
  refresh: boolean;
  offset?: string;
  sort?: string;
  gender?: string;
  kind?: string;
  category?: string;
  status?: string;
  words?: string;
  page?: string;
  for?: string;
  id?: string;
  brief?: boolean;
}

export interface Book {
  bookId: string;
  title: string;
  author: string;
  category: string;
  finished: boolean;
  words?: number;
  reads?: number;
}
