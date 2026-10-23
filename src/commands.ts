import { currentUser, finishLogin, startQr, waitForConfirm } from "./auth.ts";
import { SVIP_NOTICE, getBook } from "./book.ts";
import { clearChapters } from "./cache.ts";
import { libraryCategories, rankCategories, type Gender } from "./categories.ts";
import { usageError } from "./errors.ts";
import {
  block,
  comment,
  stateLabel,
  yamlBlock,
  yamlDoc,
  yamlFlow,
  type Block,
  type YamlValue,
} from "./format.ts";
import { LIBRARY_PAGE, library, type LibraryBook, type Status } from "./library.ts";
import { RANK_PAGE, rank, type RankBook, type RankKind } from "./rank.ts";
import { openQrWindow } from "./qrwindow.ts";
import { formatChapters, readById, readRange } from "./read.ts";
import { WEB_PAGE, briefBook, formatSearch, searchRelevance, searchWeb } from "./search.ts";
import { getToc } from "./toc.ts";
import type { Options, Output } from "./types.ts";

export type Handler = (args: string[], opts: Options) => Promise<Output>;

export function parseNonNegative(value: string | undefined, name: string, fallback = 0): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw usageError(`--${name} 要是非负整数，收到 "${value}"`);
  return Number(value);
}

export function parseEnum<T extends string>(
  value: string | undefined,
  name: string,
  allowed: readonly T[],
  fallback?: T,
): T | undefined {
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw usageError(`--${name} 只能是 ${allowed.join("、")}，收到 "${value}"`);
  }
  return value as T;
}

const SORTS = ["relevance", "new", "hot"] as const;

const search: Handler = async (args, opts) => {
  if (args.some((a) => !a.trim())) throw usageError("搜索关键词不能是空的");
  // 多个参数用一个空格连成一个搜索词，只发一次请求
  const query = args.map((a) => a.trim()).join(" ");
  if (!query) throw usageError("缺少搜索关键词");
  const offset = parseNonNegative(opts.offset, "offset");
  const sort = parseEnum(opts.sort, "sort", SORTS, "relevance")!;
  const brief = Boolean(opts.brief);
  // 相关度排序走移动端接口（直接 HTTP）；最新、最热要走浏览器
  if (sort !== "relevance" && offset % WEB_PAGE !== 0) {
    throw usageError(`--sort ${sort} 每页 ${WEB_PAGE} 本，--offset 要是 ${WEB_PAGE} 的倍数`);
  }
  const web = sort !== "relevance";
  const { result, raw } = web
    ? await searchWeb(query, sort as "new" | "hot", offset)
    : await searchRelevance(query, offset);
  return {
    text: formatSearch(result.books, {
      brief,
      web,
      moreOffset: result.hasMore ? result.nextOffset : undefined,
    }),
    json: { ...result, books: brief ? result.books.map(briefBook) : result.books },
    raw,
  };
};

const GENDERS = ["male", "female"] as const;
const RANK_KINDS = ["read", "new"] as const;
const STATUSES = ["finished", "ongoing"] as const;
const WORDS = ["lt30", "30-50", "50-100", "100-200", "gt200"] as const;
const LIBRARY_SORTS = ["hot", "new", "words"] as const;
const FOR = ["rank", "library"] as const;

// 榜单和分类库的一本书。brief 为 true 时去掉封面和简介（目前没有开关，留给以后）
export function rankEntry(b: RankBook, brief = false): Array<[string, YamlValue | Block]> {
  return [
    ["名次", b.rank],
    [
      "名次变化",
      b.rankChange ? `${b.rankChange > 0 ? "上升" : "下降"} ${Math.abs(b.rankChange)}` : undefined,
    ],
    ["书id", b.bookId],
    ["书名", b.title],
    ["作者", b.author],
    ["状态", stateLabel(b.finished)],
    ["字数", b.words],
    ["阅读量", b.reads],
    ["最新章节", b.lastChapterTitle],
    ["更新时间", b.lastUpdate],
    ["封面", brief ? undefined : b.coverUrl],
    ["简介", brief ? undefined : block(b.abstract)],
  ];
}

export function libraryEntry(b: LibraryBook, brief = false): Array<[string, YamlValue | Block]> {
  return [
    ["书id", b.bookId],
    ["书名", b.title],
    ["作者", b.author],
    ["状态", stateLabel(b.finished)],
    ["字数", b.wordsText],
    ["阅读量", b.readsText],
    ["更新时间", b.lastUpdate],
    ["封面", brief ? undefined : b.coverUrl],
    ["简介", brief ? undefined : block(b.abstract)],
  ];
}

const rankCommand: Handler = async (args, opts) => {
  if (args.length) throw usageError(`rank 不接受参数 "${args.join(" ")}"`);
  const gender: Gender = parseEnum(opts.gender, "gender", GENDERS, "male")!;
  const kind: RankKind = parseEnum(opts.kind, "kind", RANK_KINDS, "read")!;
  if (!opts.category)
    throw usageError(
      `缺少 --category。用 fanqie categories --for rank --gender ${gender} 查看有哪些分类`,
    );
  const offset = parseNonNegative(opts.offset, "offset");
  const r = await rank(gender, kind, opts.category, offset);
  const next = offset + RANK_PAGE;
  const text = r.books.length
    ? yamlBlock(r.books.map((b) => rankEntry(b))) +
      comment(`统计截止 ${r.statsDate}`) +
      (next < r.total ? comment(`更多：--offset ${next}`) : "")
    : comment("没有结果");
  const { raw, ...json } = r;
  return { text, json, raw };
};

const libraryCommand: Handler = async (args, opts) => {
  if (args.length) throw usageError(`library 不接受参数 "${args.join(" ")}"`);
  const page = parseNonNegative(opts.page, "page", 1);
  if (page < 1) throw usageError("--page 从 1 开始");
  const r = await library({
    gender: parseEnum(opts.gender, "gender", GENDERS),
    category: opts.category,
    status: parseEnum(opts.status, "status", STATUSES) as Status | undefined,
    words: parseEnum(opts.words, "words", WORDS),
    sort: parseEnum(opts.sort, "sort", LIBRARY_SORTS, "hot")!,
    page,
  });
  const text = r.books.length
    ? yamlBlock(r.books.map((b) => libraryEntry(b))) +
      (r.hasMore ? comment(`更多：--page ${page + 1}`) : "")
    : comment("没有结果");
  const { raw, ...json } = r;
  return { text, json: { ...json, pageSize: LIBRARY_PAGE }, raw };
};

const categoriesCommand: Handler = async (args, opts) => {
  if (args.length) throw usageError(`categories 不接受参数 "${args.join(" ")}"`);
  const target = parseEnum(opts.for, "for", FOR, "rank")!;
  const gender = parseEnum(opts.gender, "gender", GENDERS);
  const { categories, raw } =
    target === "rank" ? await rankCategories(gender) : await libraryCategories(gender);
  return {
    text: categories.length
      ? yamlFlow(
          categories.map((c) => [
            ["分类id", c.id],
            ["名称", c.name],
            ["分组", c.group],
            ["说明", c.description],
          ]),
        )
      : comment("没有结果"),
    json: { for: target, categories },
    raw,
  };
};

function bookIdArg(args: string[], command: string): string {
  const [id, ...extra] = args;
  if (!id) throw usageError(`缺少书籍 ID。用法：fanqie ${command} <书籍ID>`);
  if (extra.length) throw usageError(`${command} 只接受一个书籍 ID，多出 "${extra.join(" ")}"`);
  if (!/^\d+$/.test(id))
    throw usageError(`书籍 ID 是一串数字，收到 "${id}"。用 fanqie search 查书籍 ID`);
  return id;
}

const bookCommand: Handler = async (args) => {
  const { book, raw } = await getBook(bookIdArg(args, "book"));
  const locked = book.lockedChapters > 0;
  const text = yamlDoc([
    ["书id", book.bookId],
    ["书名", book.title],
    ["作者", book.author],
    ["作者签名", book.authorBio],
    ["分类", book.category],
    ["标签", book.tags],
    ["状态", stateLabel(book.finished)],
    ["字数", book.words],
    ["阅读量", book.reads],
    ["章节数", book.chapterTotal],
    // 有锁定章节时才写这几行：SVIP 账号读得全，就没有
    ["免费章节", locked ? book.freeChapters : undefined],
    ["锁定章节", locked ? book.lockedChapters : undefined],
    ["最新章节", book.lastChapterTitle],
    ["更新时间", book.lastUpdate],
    ["开更时间", book.startDate],
    ["分卷", book.volumes.length > 1 ? book.volumes : undefined],
    ["封面", book.coverUrl],
    [
      "阅读",
      locked
        ? `前 ${book.freeChapters} 章免费，其余 ${book.lockedChapters} 章${SVIP_NOTICE.replace("网页版读前 10 章左右之外的章节，", "网页版")}`
        : undefined,
    ],
    ["简介", block(book.abstract)],
  ]);
  return { text, json: { book }, raw };
};

const tocCommand: Handler = async (args) => {
  const { chapters, raw } = await getToc(bookIdArg(args, "toc"));
  // 分卷：只在每一卷的第一章标出卷名，章节仍是一章一行
  const multiVolume = new Set(chapters.map((c) => c.volume)).size > 1;
  const text = yamlFlow(
    chapters.map((c, i) => [
      ["序号", c.order],
      ["章节id", c.itemId],
      ["标题", c.title],
      ["发布", c.publishedAt],
      [
        "卷",
        multiVolume && (i === 0 || chapters[i - 1]?.volume !== c.volume) ? c.volume : undefined,
      ],
      ["锁定", c.locked ? "是" : undefined],
    ]),
  );
  // 提示写在 stderr，不弄脏 stdout 里的结构化文本
  if (chapters.some((c) => c.locked))
    process.stderr.write(`提示：标「锁定」的章节读不全。${SVIP_NOTICE}\n`);
  return { text, json: { total: chapters.length, chapters }, raw };
};

const readCommand: Handler = async (args, opts) => {
  const readOpts = { refresh: opts.refresh, raw: opts.raw };
  let result;
  if (opts.id) {
    if (args.length) throw usageError("用了 --id 就不要再给书籍 ID 和章节");
    result = await readById(opts.id, readOpts);
  } else {
    if (args.length !== 2)
      throw usageError(
        "用法：fanqie read <书籍ID> <章节>，章节写 3 或 3-5；或 fanqie read --id <章节ID>",
      );
    const [bookId, range] = args as [string, string];
    result = await readRange(bookIdArg([bookId], "read"), range, readOpts);
  }
  return {
    text: formatChapters(result.chapters),
    json: { chapters: result.chapters },
    raw: result.raw,
  };
};

const loginCommand: Handler = async () => {
  const ticket = await startQr();
  const win = openQrWindow(ticket.png);
  try {
    const redirect = await waitForConfirm(ticket, win.closed, () =>
      process.stderr.write("已扫码，请在手机上确认登录\n"),
    );
    const user = await finishLogin(ticket, redirect);
    process.stderr.write(`提示：登录只是第一步。${SVIP_NOTICE}\n`);
    return { text: yamlDoc([["账号", user.name || user.id]]), json: { user }, raw: { user } };
  } finally {
    win.close();
  }
};

const whoamiCommand: Handler = async () => {
  const user = await currentUser();
  return {
    text: user
      ? yamlDoc([
          ["已登录", "是"],
          ["账号", user.name || user.id],
          ["会员", user.vip ? "是" : "否"],
        ])
      : yamlDoc([["已登录", "否"]]),
    // 账号 id 只在 --raw 里，--json 不带
    json: {
      loggedIn: Boolean(user),
      user: user ? { name: user.name, vip: user.vip } : null,
    },
    raw: { loggedIn: Boolean(user), user: user ?? null },
  };
};

const cacheClearCommand: Handler = async () => {
  const removed = clearChapters();
  return { text: yamlDoc([["已删除章数", removed]]), json: { removed }, raw: { removed } };
};

export const COMMANDS: Record<string, Handler> = {
  search,
  rank: rankCommand,
  library: libraryCommand,
  categories: categoriesCommand,
  book: bookCommand,
  toc: tocCommand,
  read: readCommand,
  login: loginCommand,
  whoami: whoamiCommand,
  "cache clear": cacheClearCommand,
};
