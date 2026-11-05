import type { PhotoMesh } from "@/components/ui/PhotoFrame";

// Pure helpers for the Rich Accounts list (docs/design/rich-ui.md). No data is fetched or invented here: every value is shaped
// from a row listAccountsLive() already returned. Kept apart from the component so the maths is tested without rendering.

export type AccountsView = "rows" | "cards" | "table";

export const ACCOUNTS_VIEWS: AccountsView[] = ["rows", "cards", "table"];
export const ACCOUNTS_VIEW_KEY = "bpm-rich-accounts-view";

/** The remembered view; anything unknown (empty, tampered, an older value) is the default, Rows. */
export function parseAccountsView(raw: unknown): AccountsView {
  return raw === "cards" || raw === "table" || raw === "rows" ? raw : "rows";
}

const MESHES: PhotoMesh[] = ["a", "b", "c", "d", "e", "f"];

/** A stable gradient per account: the same name always paints the same mesh. */
export function meshFor(name: string): PhotoMesh {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MESHES[h % MESHES.length];
}

export function initialsOf(name: string): string {
  const out = name.split(/\s+/).filter(Boolean).map((w) => Array.from(w)[0]).slice(0, 2).join("").toUpperCase();
  return out || "?";
}

export type CountChip = { key: "contacts" | "cases" | "assets" | "contracts"; n: number; label: string };

const CHIP_WORDS: Record<CountChip["key"], [string, string]> = {
  contacts: ["contact", "contacts"],
  cases: ["case", "cases"],
  assets: ["asset", "assets"],
  contracts: ["AMC", "AMCs"],
};

/** Only counts that exist. A zero is left out, never drawn, so a row never carries a number that says nothing. */
export function countChips(counts: { contacts: number; cases: number; assets: number; contracts: number }): CountChip[] {
  const order: CountChip["key"][] = ["contacts", "cases", "assets", "contracts"];
  return order
    .filter((k) => counts[k] > 0)
    .map((k) => ({ key: k, n: counts[k], label: `${counts[k]} ${CHIP_WORDS[k][counts[k] === 1 ? 0 : 1]}` }));
}

/** A link to the list with the given params; empty values are dropped and the page resets to 1. */
export function listHref(base: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export type TypeChip = { id: string; label: string; href: string; active: boolean };

/** "All" plus one chip per type. Each keeps every other active filter and the sort, so picking a type never drops a search. */
export function typeChips(args: {
  base: string;
  types: { value: string; label: string }[];
  current: string | undefined;
  params: Record<string, string | undefined>;
}): TypeChip[] {
  const { base, types, current, params } = args;
  const rest = { ...params };
  delete rest.type;
  return [
    { id: "all", label: "All", href: listHref(base, rest), active: !current },
    ...types.map((t) => ({ id: t.value, label: t.label, href: listHref(base, { ...rest, type: t.value }), active: current === t.value })),
  ];
}

/** A tel: target, or null when the phone holds no digits. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  return /\d/.test(digits) ? `tel:${digits}` : null;
}

/** A mailto: target, or null when the address is not a plain single address. */
export function mailHref(email: string | null | undefined): string | null {
  const e = (email ?? "").trim();
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e) ? `mailto:${e}` : null;
}

export type RichAccountRow = {
  id: string;
  name: string;
  initials: string;
  mesh: PhotoMesh;
  typeLabel: string;
  typeTone: "blue" | "purple" | "teal" | "amber" | "red" | "green";
  href: string;
  /** City, then "via <OEM>" when the account was referred; empty when neither is known. */
  line: string;
  chips: CountChip[];
  tel: string | null;
  mail: string | null;
  /** Present only when the workspace owns Quotations and the caller may create one. */
  quoteHref: string | null;
};

export type RichAccountSource = {
  account: { id: string; name: string; type: string; city: string | null; phone: string | null; email: string | null };
  referredBy: { name: string } | null;
  counts: { contacts: number; cases: number; assets: number; contracts: number };
};

export function toRichRow(
  src: RichAccountSource,
  o: { href: string; typeLabel: string; typeTone: RichAccountRow["typeTone"]; quoteHref: string | null },
): RichAccountRow {
  const { account, referredBy, counts } = src;
  const line = [account.city?.trim() || null, referredBy ? `via ${referredBy.name}` : null].filter(Boolean).join(" · ");
  return {
    id: account.id,
    name: account.name,
    initials: initialsOf(account.name),
    mesh: meshFor(account.name),
    typeLabel: o.typeLabel,
    typeTone: o.typeTone,
    href: o.href,
    line,
    chips: countChips(counts),
    tel: telHref(account.phone),
    mail: mailHref(account.email),
    quoteHref: o.quoteHref,
  };
}
