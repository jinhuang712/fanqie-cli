import { apiGet, getPage } from "./api.ts";
import { notFoundError } from "./errors.ts";

export type Gender = "male" | "female";

export interface Category {
  id: string;
  name: string;
  // 榜单分类按读者分；分类库的分类有「主分类、主题、角色、情节」之分
  group: string;
  // 分类库的分类有一句说明（后加的字段）
  description?: string;
}

export const GENDER_LABEL: Record<Gender, string> = { male: "男频", female: "女频" };
// 接口里 1 是男，0 是女
export const GENDER_PARAM: Record<Gender, number> = { male: 1, female: 0 };

export interface CategoryList {
  categories: Category[];
  raw: unknown;
}

// 榜单的分类放在 /rank 页面的状态里
export async function rankCategories(gender?: Gender): Promise<CategoryList> {
  const { state, decode } = await getPage("/rank");
  const list = state.rank?.rankCategoryTypeList as
    | Record<Gender, Array<{ id: string | number; name: string }>>
    | undefined;
  const categories: Category[] = [];
  for (const g of ["male", "female"] as const) {
    if (gender && gender !== g) continue;
    for (const c of list?.[g] ?? [])
      categories.push({ id: String(c.id), name: decode(c.name), group: GENDER_LABEL[g] });
  }
  return { categories, raw: list };
}

interface RawCategory {
  category_id: number;
  name: string;
  label: string;
  description?: string;
}

// 分类库的分类来自接口，gender=-1 是全部
export async function libraryCategories(gender?: Gender): Promise<CategoryList> {
  const { raw, decode } = await apiGet<{ code: number; data: RawCategory[] }>(
    "/api/author/book/category_list/v0/",
    {
      gender: gender ? GENDER_PARAM[gender] : -1,
    },
  );
  return {
    categories: raw.data.map((c) => ({
      id: String(c.category_id),
      name: decode(c.name),
      group: c.label,
      description: decode(c.description),
    })),
    raw: raw.data,
  };
}

// 名称或 ID -> 分类。找不到时报"找不到"，并提示怎么查
export function resolveCategory(list: Category[], input: string, hint: string): Category {
  const hit = list.find((c) => c.id === input) ?? list.find((c) => c.name === input);
  if (!hit) throw notFoundError(`找不到分类 "${input}"。用 ${hint} 查看有哪些分类`);
  return hit;
}
