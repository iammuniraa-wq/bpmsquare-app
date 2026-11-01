import { norm, screenCatalog, TENDER_BOQ_LIST_TARGET, TENDER_BOQ_OPEN_PREFIX, type CatalogEntry, type MissingReason, type NavGateCtx, type NavTarget } from "./navTargets";

// The navigate tool lets the model pick a screen. This module is the server's check on that pick, so a screen that
// is not in the caller's list is never swapped for "the closest one" (KAMCO 2026-11-01: "where is data workbench"
// answered with a button to Analytics). Pure and deterministic: no model, no database.
//
//   1. If the person NAMED a screen the product knows (label or alias, in any workspace), the answer is about that
//      screen: its own button when the caller reaches it, otherwise the honest reason it is missing.
//   2. If they named nothing the product knows, the model's pick must still share a meaningful word with what was
//      asked for; otherwise the answer is "I do not know a screen called ...".

export const NAV_NONE = "none";

export type NavDecision =
  | { kind: "open"; targets: NavTarget[] }
  | { kind: "unavailable"; message: string }
  | { kind: "unknown"; message: string; suggestions: NavTarget[] };

const KIND_ORDER: Record<NavTarget["kind"], number> = { nav: 0, create: 1, settings: 2 };

/** Words that carry no meaning about WHICH screen is meant. Compared after `norm`. */
const STOP = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "your", "you", "can", "how", "where", "what", "when", "which", "who",
  "new", "open", "show", "find", "see", "all", "any", "get", "take", "want", "need", "please", "page", "screen", "list", "view", "setting",
  "add", "create", "make", "set", "have", "has", "are", "was", "does", "not", "about", "there", "here", "go", "goto", "own",
]);

const tokensOf = (s: string): string[] => norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));

const overlap = (a: Iterable<string>, b: Iterable<string>): number => {
  const set = new Set(b);
  let n = 0;
  for (const w of new Set(a)) if (set.has(w)) n++;
  return n;
};

/** The model's free text, cut to something safe to print back to the person. */
export const cleanAskedFor = (s: unknown): string =>
  typeof s === "string" ? s.replace(/[^A-Za-z0-9 .,'&/-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";

/** The tender that is open now answers to the same names as the Tenders list. */
const canonicalId = (id: string): string =>
  id.startsWith(TENDER_BOQ_OPEN_PREFIX) && id.endsWith("?tab=boq") ? TENDER_BOQ_LIST_TARGET : id;

// ── What the message names ──────────────────────────────────────────────────────────────────────────────────

export type NamedGroup = { name: string; entries: CatalogEntry[] };

/** Every screen name found in `phrase`, as whole words. A name inside a longer name ("quote" in "standard quote") is dropped. */
export function namedGroups(phrase: string, catalog: readonly CatalogEntry[] = screenCatalog()): NamedGroup[] {
  const words = norm(phrase).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  type Hit = { start: number; end: number; entry: CatalogEntry };
  const hits: Hit[] = [];
  for (const entry of catalog) {
    for (const name of entry.names) {
      const nw = norm(name).split(" ").filter(Boolean);
      if (nw.length === 0) continue;
      for (let i = 0; i + nw.length <= words.length; i++) {
        if (nw.every((w, k) => words[i + k] === w)) hits.push({ start: i, end: i + nw.length, entry });
      }
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => (o.end - o.start) > (h.end - h.start) && o.start <= h.start && o.end >= h.end));
  const byKey = new Map<string, NamedGroup>();
  for (const h of kept) {
    const key = `${h.start}-${h.end}`;
    const g = byKey.get(key) ?? { name: words.slice(h.start, h.end).join(" "), entries: [] };
    if (!g.entries.some((e) => e.id === h.entry.id)) g.entries.push(h.entry);
    byKey.set(key, g);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Honest answers ──────────────────────────────────────────────────────────────────────────────────────────

const shownName = (e: CatalogEntry): string => (e.kind === "settings" ? `${e.label.replace(/^Settings:\s*/, "")} settings` : e.label);

export function missingMessage(e: CatalogEntry, reason: MissingReason): string {
  const name = shownName(e);
  switch (reason) {
    case "not_enabled": return `${name} is not switched on in your workspace. Ask your administrator to enable it.`;
    case "admin_only": return `${name} is only for workspace administrators.`;
    case "no_access": return `You do not have access to ${name}.`;
    default: return `${name} is not available in your workspace.`;
  }
}

const bestOf = <T extends { kind: NavTarget["kind"] }>(xs: T[]): T | undefined => [...xs].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])[0];

function unknownDecision(askedFor: string, message: string, targets: readonly NavTarget[]): NavDecision {
  // The person's words only: the model's asked_for could name anything.
  const sought = new Set(tokensOf(message));
  const catalog = new Map(screenCatalog().map((e) => [e.id, e]));
  const scored = targets
    .map((t) => {
      const e = catalog.get(canonicalId(t.id));
      const nameWords = e ? e.names.flatMap(tokensOf) : tokensOf(t.label);
      return { t, score: overlap(sought, nameWords) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || KIND_ORDER[a.t.kind] - KIND_ORDER[b.t.kind]);
  return {
    kind: "unknown",
    message: askedFor ? `I do not know a screen called "${askedFor}".` : "I could not match that to a screen in your workspace.",
    suggestions: scored.slice(0, 3).map((x) => x.t),
  };
}

// ── The check ───────────────────────────────────────────────────────────────────────────────────────────────

export type NavJudgeInput = {
  /** What the model put in `target`: an id from the list, or NAV_NONE. */
  pick: string | undefined;
  /** What the model put in `asked_for`: the screen as the person named it. */
  askedFor?: unknown;
  /** The person's last message, verbatim. */
  message: string;
  /** This caller's allowed targets (the list the model was given, plus the open tender's BOQ tab). */
  targets: readonly NavTarget[];
  ctx: NavGateCtx;
};

export function judgeNavigation(i: NavJudgeInput): NavDecision {
  const catalog = screenCatalog();
  const byId = new Map(i.targets.map((t) => [t.id, t]));
  const allowedCanon = new Map<string, NavTarget[]>();
  for (const t of i.targets) allowedCanon.set(canonicalId(t.id), [...(allowedCanon.get(canonicalId(t.id)) ?? []), t]);
  const pick = i.pick && i.pick !== NAV_NONE ? byId.get(i.pick) : undefined;
  const askedFor = cleanAskedFor(i.askedFor);
  const messageTokens = tokensOf(i.message);

  const reachable = (e: CatalogEntry): NavTarget[] => allowedCanon.get(e.id) ?? [];

  // The person's own words come first. The model's `asked_for` only names a screen when the message named none,
  // and then it can open one only if the message shares a word with that screen: it cannot invent its own reason.
  let groups = namedGroups(i.message, catalog);
  if (groups.length === 0 && askedFor) {
    groups = namedGroups(askedFor, catalog).filter(
      (g) => !g.entries.some((e) => reachable(e).length > 0) || g.entries.some((e) => overlap(messageTokens, e.terms.flatMap(tokensOf)) > 0),
    );
  }

  if (groups.length > 0) {
    const pickCanon = pick ? canonicalId(pick.id) : null;
    if (pick && groups.some((g) => g.entries.some((e) => e.id === pickCanon))) return { kind: "open", targets: [pick] };

    const opens: NavTarget[] = [];
    const missing: string[] = [];
    for (const g of groups) {
      const open = bestOf(g.entries.flatMap(reachable));
      if (open) { if (!opens.some((o) => o.id === open.id)) opens.push(open); continue; }
      const entry = bestOf(g.entries);
      if (entry) missing.push(missingMessage(entry, entry.gate(i.ctx) ?? "unavailable"));
    }
    if (opens.length > 0) return { kind: "open", targets: opens.slice(0, 3) };
    if (missing.length > 0) return { kind: "unavailable", message: [...new Set(missing)].slice(0, 2).join(" ") };
  }

  // Nothing the product knows by name. A pick has to be justified by what was asked for, in the person's words or the model's.
  if (pick) {
    const e = catalog.find((c) => c.id === canonicalId(pick.id));
    const terms = e ? e.terms.flatMap(tokensOf) : [...tokensOf(pick.label), ...tokensOf(pick.section)];
    // asked_for counts only when it is traceable to the person's own words, so the model cannot supply its own reason.
    const askTokens = tokensOf(askedFor);
    if (overlap(messageTokens, terms) > 0 || (overlap(askTokens, messageTokens) > 0 && overlap(askTokens, terms) > 0)) return { kind: "open", targets: [pick] };
  }
  return unknownDecision(askedFor, i.message, i.targets);
}

// ── Before any model call ───────────────────────────────────────────────────────────────────────────────────

const WHERE_RE = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:where(?:'s|\s+is|\s+are|\s+can i (?:find|see|open|get)|\s+do i (?:find|see|open|get))|how (?:do|can) i (?:get to|go to|find|open|reach)|(?:open|go to|goto|take me to|navigate to|jump to|find))\b/i;

/**
 * "where is data workbench", "open invoices": a request for one place by name, when every place named is one this
 * caller cannot reach. The honest reason comes back with no model call. Anything else (a place that IS reachable,
 * a question about data, a name the product does not know) returns null and is left to the model and the check above.
 */
export function answerUnavailableAsk(message: string, targets: readonly NavTarget[], ctx: NavGateCtx): string | null {
  const text = message.trim();
  if (!text || text.length > 120 || !WHERE_RE.test(text)) return null;
  const allowed = new Set(targets.map((t) => canonicalId(t.id)));
  const groups = namedGroups(text);
  if (groups.length === 0) return null;
  const missing: string[] = [];
  for (const g of groups) {
    if (g.entries.some((e) => allowed.has(e.id))) return null;
    const entry = bestOf(g.entries);
    if (entry) missing.push(missingMessage(entry, entry.gate(ctx) ?? "unavailable"));
  }
  return missing.length ? [...new Set(missing)].slice(0, 2).join(" ") : null;
}
