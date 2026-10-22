import { NAV, type NavItem } from "@/lib/constants";
import { CREATE_ACTIONS } from "@/lib/createActions";
import { visibleSettingsMenu } from "@/lib/settingsMenu";
import type { WorkcenterKey } from "@/lib/workcenters";
import { OBJECT_DEFS, type AssistantObjectType } from "./objects";

// Where the assistant may send a person. The list is GENERATED from the same tables the sidebar, the Settings
// menu and the ⌘K palette run on, filtered by the same gates (module flags, Business Role grants, admin-only,
// supervisor-only). The model picks an id from this list and nothing else: it cannot write a URL, and a target the
// caller cannot reach is not in the list at all. Pure and client-safe so the gating is unit-tested.

export type NavTargetKind = "nav" | "settings" | "create";
export type NavTarget = { id: string; label: string; section: string; href: string; kind: NavTargetKind };

export type NavGateCtx = {
  features: Record<string, boolean | undefined>;
  /** Admin, or a member with no Business Role (unrestricted access). */
  isAdmin: boolean;
  isWfmSupervisor: boolean;
  canView: (wc: WorkcenterKey) => boolean;
  canCreate: (wc: WorkcenterKey) => boolean;
  canEdit: (wc: WorkcenterKey) => boolean;
};

export function buildNavTargets(ctx: NavGateCtx): NavTarget[] {
  const out = new Map<string, NavTarget>();
  const add = (t: NavTarget) => { if (!out.has(t.id)) out.set(t.id, t); };

  // Same rule as the sidebar and the palette's `canSee`.
  const canSee = (item: NavItem) =>
    (!item.featureKey || ctx.features[item.featureKey] === true) &&
    (!item.adminOnly || ctx.isAdmin) &&
    (!item.workcenterKey || ctx.canView(item.workcenterKey as WorkcenterKey)) &&
    (!item.supervisorOnly || ctx.isWfmSupervisor);

  for (const group of NAV) {
    for (const item of group.items) {
      const children = item.children ?? [];
      if (children.length === 0) {
        if (canSee(item)) add({ id: `nav:${item.href}`, label: item.label, section: group.group, href: item.href, kind: "nav" });
        continue;
      }
      // A parent row only expands the sidebar; its children are the places.
      for (const child of children) {
        if (canSee(child)) add({ id: `nav:${child.href}`, label: child.label, section: item.label, href: child.href, kind: "nav" });
      }
    }
  }

  for (const g of visibleSettingsMenu({ isAdmin: ctx.isAdmin, canEdit: ctx.canEdit, features: ctx.features })) {
    for (const item of g.items) add({ id: `settings:${item.id}`, label: `Settings: ${item.label}`, section: `Settings · ${g.label}`, href: item.href, kind: "settings" });
  }

  for (const a of CREATE_ACTIONS) {
    if (ctx.features[a.featureKey] !== true) continue;
    if (a.workcenterKey && !ctx.canCreate(a.workcenterKey)) continue;
    add({ id: `create:${a.href}`, label: a.label, section: "Create", href: a.href, kind: "create" });
  }

  return [...out.values()];
}

/** A path the dock may navigate to: internal, no scheme, no `//`, none of the characters that break out of a string. */
export function isInternalPath(href: unknown): href is string {
  return typeof href === "string" && /^\/(?!\/)[A-Za-z0-9/_\-.?=&%]*$/.test(href);
}

// ── Plain-words navigation, answered without a model call ───────────────────────────────────────────────────

const ALIASES: Record<string, string[]> = {
  "nav:/quotations": ["quotes", "quotations", "quotation", "quote"],
  "nav:/": ["home", "dashboard"],
  "nav:/accounts": ["customers", "companies"],
  "nav:/cases": ["tickets", "service cases"],
  "nav:/reports": ["reports", "analytics"],
  "nav:/pipeline": ["deals", "opportunities", "pipeline"],
  // Settings pages that were folded into tabs (batch S2) keep answering to their old names.
  "settings:company": ["company profile", "entities and tax", "currency", "tax", "number ranges"],
  "settings:appearance": ["theme", "theme and colours", "navigation visibility", "reset layout", "dashboard content"],
  "settings:products": ["product categories", "item types"],
  "settings:quotations": ["quote statuses", "quote types", "offer types", "text templates", "email templates", "asset print fields"],
  "settings:pricing": ["small scale pricing", "dynamic pricing"],
};

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)).join(" ");

const OPEN_RE = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:open|go to|goto|take me to|show me|navigate to|jump to|show)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:page|screen|list))?[\s.!?]*$/i;
const CREATE_RE = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:(?:create|add|start|make|open)\s+)?(?:a\s+|an\s+)?(new\s+.+?)[\s.!?]*$/i;

const NAV_VERB_RE = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:open|go to|goto|take me to|navigate to|jump to)\b/i;

/** The message starts like a request to go somewhere ("open ...", "take me to ..."). "Show me" is left out: it is usually a data question. */
export const isNavigationRequest = (message: string): boolean => NAV_VERB_RE.test(message);

const KIND_ORDER: Record<NavTargetKind, number> = { nav: 0, create: 1, settings: 2 };

/**
 * "open quotations", "go to settings: currency", "new quotation": the one target the message names exactly, or
 * null. Anything that is not the bare name of a place (a question, a filter, a breakdown) is left to the model.
 */
export function matchNavigation(message: string, targets: readonly NavTarget[]): NavTarget | null {
  const text = message.trim();
  if (!text || text.length > 80) return null;
  const queries: string[] = [];
  const open = OPEN_RE.exec(text);
  if (open) queries.push(norm(open[1]));
  const create = CREATE_RE.exec(text);
  if (create) queries.push(norm(create[1]));
  if (queries.length === 0) return null;

  const hits = targets.filter((t) => {
    const names = [t.label, t.label.replace(/^Settings:\s*/, ""), ...(ALIASES[t.id] ?? [])].map(norm);
    return queries.some((q) => names.includes(q));
  });
  if (hits.length === 0) return null;
  const best = Math.min(...hits.map((h) => KIND_ORDER[h.kind]));
  const top = hits.filter((h) => KIND_ORDER[h.kind] === best);
  return top.length === 1 ? top[0] : null;
}

const RECORD_WORDS: [RegExp, AssistantObjectType][] = [
  [/standard quotes?/, "standard_quote"], [/quotations?|quotes?/, "quote"], [/deals?|opportunit(?:y|ies)/, "opportunity"],
  [/estimates?/, "estimate"], [/cases?/, "case"], [/invoices?/, "invoice"], [/rfqs?/, "rfq"],
  [/work orders?/, "work_order"], [/products?/, "product"], [/assets?/, "asset"], [/suppliers?/, "supplier"],
];
const RECORD_OPEN_RE = /^\s*(?:please\s+)?(?:open|go to|show me|show|find)\s+(?:the\s+)?([a-z ]+?)\s+([A-Za-z0-9][A-Za-z0-9._/-]*\d[A-Za-z0-9._/-]*)[\s.!?]*$/i;

/** "open quote SQ-2026-0012": the object and the reference named, or null. Resolution happens on the server. */
export function matchRecordOpen(message: string): { objectType: AssistantObjectType; ref: string } | null {
  const m = RECORD_OPEN_RE.exec(message.trim());
  if (!m) return null;
  const word = m[1].toLowerCase().trim();
  for (const [re, type] of RECORD_WORDS) {
    if (new RegExp(`^${re.source}$`).test(word)) return { objectType: type, ref: m[2].replace(/[./-]+$/, "") };
  }
  return null;
}

/** The detail path for a record of an object type. */
export function recordHref(type: AssistantObjectType, id: string): string {
  return OBJECT_DEFS.find((d) => d.type === type)!.detail(id);
}
