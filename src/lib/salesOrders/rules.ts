import type { OrderSourceType, PricingMode, SalesOrderType } from "./types";

// Which order type a new order gets. A type lists rules ({ field, equals }); the types are scanned in their
// sort order and the FIRST type with a rule that matches wins (any one rule of a type is enough). A type with
// no rules is never picked by a rule. When nothing matches the workspace's default type applies, then the first
// active type. The person can always change the type on a draft; this only decides what the form starts with.

export const TYPE_RULE_FIELDS = ["customer_group", "region", "source_type"] as const;
export type TypeRuleField = (typeof TYPE_RULE_FIELDS)[number];

export type TypeRule = { field: TypeRuleField; equals: string };

/** What the rules are compared with. Values are matched case-insensitively and trimmed. */
export type TypeContext = { customer_group?: string | null; region?: string | null; source_type?: OrderSourceType | null };

type AccountForRules = { type?: string | null; state?: string | null; country?: string | null; custom_data?: Record<string, unknown> | null };

const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * The context an account gives the rules. Customer group is the tenant's own `cf_customer_group` custom field
 * when it has one, else the account type. Region is matched against both the state and the country.
 */
export function contextForAccount(account: AccountForRules | null | undefined, sourceType: OrderSourceType | null): TypeContext & { regions: string[] } {
  const cf = account?.custom_data?.cf_customer_group;
  const group = typeof cf === "string" && cf.trim() ? cf : account?.type ?? null;
  return {
    customer_group: group,
    region: account?.state ?? account?.country ?? null,
    regions: [account?.state, account?.country].map(norm).filter(Boolean),
    source_type: sourceType,
  };
}

/** Rules from stored JSON: unknown fields and blank values are dropped so a bad row can never match everything. */
export function cleanRules(input: unknown): TypeRule[] {
  if (!Array.isArray(input)) return [];
  const out: TypeRule[] = [];
  for (const r of input as { field?: unknown; equals?: unknown }[]) {
    const field = typeof r?.field === "string" ? r.field : "";
    const equals = typeof r?.equals === "string" ? r.equals.trim() : "";
    if ((TYPE_RULE_FIELDS as readonly string[]).includes(field) && equals) out.push({ field: field as TypeRuleField, equals: equals.slice(0, 100) });
  }
  return out.slice(0, 20);
}

function ruleMatches(rule: TypeRule, ctx: TypeContext & { regions?: string[] }): boolean {
  const want = norm(rule.equals);
  if (rule.field === "customer_group") return norm(ctx.customer_group) === want;
  if (rule.field === "source_type") return norm(ctx.source_type) === want;
  const regions = ctx.regions ?? [norm(ctx.region)].filter(Boolean);
  return regions.includes(want);
}

type PickableType = Pick<SalesOrderType, "id" | "rules" | "is_default" | "active" | "sort_order">;
export type TypePick<T extends PickableType> = { type: T; via: "rule" | "default" | "first" };

export function pickOrderType<T extends PickableType>(types: readonly T[], ctx: TypeContext & { regions?: string[] }): TypePick<T> | null {
  const active = types.filter((t) => t.active).sort((a, b) => a.sort_order - b.sort_order);
  for (const t of active) {
    const rules = cleanRules(t.rules);
    if (rules.some((r) => ruleMatches(r, ctx))) return { type: t, via: "rule" };
  }
  const def = active.find((t) => t.is_default);
  if (def) return { type: def, via: "default" };
  return active[0] ? { type: active[0], via: "first" } : null;
}

/** The pricing mode an order is created with. An order made from a quote keeps that quote's mode; otherwise it is its type's. */
export function pricingModeFor(type: { pricing_mode: PricingMode } | null, sourceMode: PricingMode | null): PricingMode {
  return sourceMode ?? type?.pricing_mode ?? "internal";
}

export const PREFIX_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/** A numbering prefix as typed: upper-cased, spaces and dashes removed; null when it is not a valid prefix. */
export function cleanPrefix(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const p = v.trim().toUpperCase().replace(/[\s-]+/g, "");
  return PREFIX_RE.test(p) ? p : null;
}
