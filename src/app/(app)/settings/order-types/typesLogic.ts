// Settings > Order types, as pure functions: the draft a panel edits, the block list operations (reorder, show/hide,
// text) and what stops a save. Tested without a browser.

import type { StandardQuoteTemplateBlock, StandardQuoteTemplateBlockType } from "@/lib/types";
import { STANDARD_QUOTE_REQUIRED_BLOCKS } from "@/lib/types";
import { defaultStandardQuoteBlocks, HEX_COLOR_RE } from "@/lib/standardQuoteTemplateBlocks";
import type { NewTypeBody } from "@/lib/salesOrders/client";
import type { PricingMode, SalesOrderType } from "@/lib/salesOrders/types";

export type RuleField = "customer_group" | "region" | "source_type";
export const RULE_FIELDS: { id: RuleField; label: string }[] = [
  { id: "customer_group", label: "Customer group" },
  { id: "region", label: "Region" },
  { id: "source_type", label: "Made from" },
];
export const SOURCE_CHOICES: { id: string; label: string }[] = [
  { id: "standard_quote", label: "Standard quote" }, { id: "quotation", label: "Quotation" }, { id: "opportunity", label: "Deal" },
  { id: "lead", label: "Lead" }, { id: "email", label: "Email" }, { id: "direct", label: "Typed in directly" },
];

export const BLOCK_LABELS: Record<StandardQuoteTemplateBlockType, string> = {
  letterhead: "Letterhead (logo and company)",
  quote_meta: "Order number and date",
  bill_to: "Customer, bill-to and ship-to",
  intro_text: "Intro text",
  line_items: "Line items table",
  totals: "Total",
  notes: "Notes",
  terms: "Terms and conditions",
  signature: "Signature block",
  footer_text: "Footer text",
  specs_table: "Specifications table",
  cta_banner: "Call-to-action banner",
};
export const CONTENT_BLOCKS = new Set<StandardQuoteTemplateBlockType>(["intro_text", "footer_text", "specs_table", "cta_banner"]);
export const CONTENT_HELP: Partial<Record<StandardQuoteTemplateBlockType, string>> = {
  intro_text: "A short cover note above the lines",
  footer_text: "Legal text near the bottom",
  specs_table: "One “Label: Value” per line",
  cta_banner: "One highlighted line",
};

export type TypeDraft = {
  name: string;
  prefix: string;
  pricing_mode: PricingMode;
  is_default: boolean;
  active: boolean;
  rules: { field: string; equals: string }[];
  blocks: StandardQuoteTemplateBlock[];
  accent_color: string;
  logo_position: "left" | "center" | "right";
};

export const ACCENT_FALLBACK = "#378ADD";

export const blankDraft = (hasDefault: boolean): TypeDraft => ({
  name: "", prefix: "SO", pricing_mode: "internal", is_default: !hasDefault, active: true, rules: [], blocks: defaultStandardQuoteBlocks(),
  accent_color: ACCENT_FALLBACK, logo_position: "left",
});

export function draftFromType(t: SalesOrderType): TypeDraft {
  const blocks = (t.template.blocks as StandardQuoteTemplateBlock[]).filter((b) => b && typeof b.type === "string");
  return {
    name: t.name, prefix: t.prefix, pricing_mode: t.pricing_mode, is_default: t.is_default, active: t.active, rules: t.rules.map((r) => ({ ...r })),
    blocks: blocks.length > 0 ? blocks : defaultStandardQuoteBlocks(), accent_color: t.template.accent_color ?? ACCENT_FALLBACK, logo_position: t.template.logo_position ?? "left",
  };
}

export const normalizePrefix = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

/** What stops a save, in plain words, or null. */
export function draftProblem(d: TypeDraft): string | null {
  if (d.name.trim() === "") return "Give the type a name";
  if (d.prefix.length < 2) return "The prefix needs at least two letters or digits";
  if (!HEX_COLOR_RE.test(d.accent_color)) return "The accent colour must look like #378ADD";
  if (d.rules.some((r) => r.equals.trim() === "")) return "Finish or remove the empty selection rule";
  return null;
}

export function toBody(d: TypeDraft): NewTypeBody {
  return {
    name: d.name.trim(), prefix: d.prefix, pricing_mode: d.pricing_mode, is_default: d.is_default, active: d.active,
    rules: d.rules.map((r) => ({ field: r.field, equals: r.equals.trim() })),
    template: { blocks: d.blocks, accent_color: d.accent_color, logo_position: d.logo_position },
  };
}

export const isRequiredBlock = (t: StandardQuoteTemplateBlockType): boolean => STANDARD_QUOTE_REQUIRED_BLOCKS.includes(t);

export function moveBlock(blocks: StandardQuoteTemplateBlock[], index: number, by: -1 | 1): StandardQuoteTemplateBlock[] {
  const to = index + by;
  if (to < 0 || to >= blocks.length) return blocks;
  const next = [...blocks];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
export const toggleBlock = (blocks: StandardQuoteTemplateBlock[], index: number): StandardQuoteTemplateBlock[] =>
  blocks.map((b, i) => (i === index && !isRequiredBlock(b.type) ? { ...b, visible: !b.visible } : b));
export const setBlockText = (blocks: StandardQuoteTemplateBlock[], index: number, content: string): StandardQuoteTemplateBlock[] =>
  blocks.map((b, i) => (i === index ? { ...b, content } : b));

export const ruleSummary = (rules: { field: string; equals: string }[]): string =>
  rules.length === 0 ? "—" : rules.map((r) => `${RULE_FIELDS.find((f) => f.id === r.field)?.label ?? r.field} = ${r.field === "source_type" ? SOURCE_CHOICES.find((s) => s.id === r.equals)?.label ?? r.equals : r.equals}`).join("; ");

/** Types in the order the list shows them: default first, then by name; inactive last. */
export const sortedTypes = (types: SalesOrderType[]): SalesOrderType[] =>
  [...types].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.is_default) - Number(a.is_default) || a.sort_order - b.sort_order || a.name.localeCompare(b.name));
