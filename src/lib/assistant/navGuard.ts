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
  | ({ kind: "unavailable" } & UnavailableAnswer)
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

/**
 * "not_enabled" is a module flag that only BPMSquare switches on (platform admin), so a workspace administrator is
 * never told to "ask your administrator": that was the owner's own experience on KAMCO, 2026-11-19.
 */
export function missingMessage(e: CatalogEntry, reason: MissingReason, ctx?: Pick<NavGateCtx, "isWorkspaceAdmin">): string {
  const name = shownName(e);
  switch (reason) {
    case "not_enabled":
      return ctx?.isWorkspaceAdmin === true
        ? `${name} is not part of your workspace yet. Modules are added by BPMSquare, not in Settings, so ask your BPMSquare contact to switch it on.`
        : `${name} is not switched on in your workspace. Ask your administrator to enable it.`;
    case "admin_only": return `${name} is only for workspace administrators.`;
    case "no_access": return `You do not have access to ${name}.`;
    default: return `${name} is not available in your workspace.`;
  }
}

// ── What the person CAN do instead, and the facts a model needs to explain it ──────────────────────────────

type Missing = { entry: CatalogEntry; reason: MissingReason };

export type UnavailableAnswer = {
  /** The fixed sentence, used the first time. */
  message: string;
  /** Places the caller reaches that are about the same subject; shown as buttons. */
  related: NavTarget[];
  /** The same content as facts for the model, for when the fixed sentence was already said. */
  fact: string;
};

/** A subject, and the settings pages that are really about it. Offered only when the caller reaches them. */
const RELATED_TOPICS: { words: RegExp; ids: string[]; lead: string }[] = [
  { words: /\b(?:e ?mail|mail|gmail|mailbox|smtp|outlook)\b/, ids: ["settings:connectors", "settings:email-output"], lead: "If this is about the mailbox your emails go out from, you can set that up here." },
];

function relatedFor(text: string, missing: readonly Missing[], targets: readonly NavTarget[]): { related: NavTarget[]; lead: string } {
  const hay = norm([text, ...missing.map((m) => m.entry.label)].join(" "));
  const related: NavTarget[] = [];
  let lead = "";
  for (const topic of RELATED_TOPICS) {
    if (!topic.words.test(hay)) continue;
    const found = topic.ids.map((id) => targets.find((t) => t.id === id)).filter((t): t is NavTarget => !!t && !related.includes(t));
    if (found.length && !lead) lead = topic.lead;
    related.push(...found);
  }
  return { related: related.slice(0, 2), lead };
}

const WHY: Record<MissingReason, string> = {
  not_enabled: "its module is not part of this workspace. Only BPMSquare (the vendor) can switch a module on; a workspace administrator cannot, and there is no switch for it anywhere in Settings. The person should ask their BPMSquare contact",
  admin_only: "only workspace administrators may open it",
  no_access: "this person's access does not include it; a workspace administrator decides that",
  unavailable: "it is not available in this workspace",
};

function factFor(missing: readonly Missing[], related: readonly NavTarget[], ctx: NavGateCtx): string {
  return (
    "SCREENS THIS PERSON CANNOT OPEN (trusted facts from the server): " +
    missing.map((m) => `"${shownName(m.entry)}" (${m.entry.section}): ${WHY[m.reason]}.`).join(" ") +
    ` The person ${ctx.isWorkspaceAdmin === true ? "IS a workspace administrator" : "is not a workspace administrator"}.` +
    (related.length ? ` Related places they CAN open, whose buttons the app is already showing under your reply: ${related.map((t) => t.label).join(", ")}.` : "") +
    " Answer what they actually asked, in one or two short, warm, plain sentences of your own. Do not repeat a sentence already said in this chat, do not call navigate for these screens, and never say such a screen can be opened or switched on from inside the workspace."
  );
}

function describeMissing(text: string, missing: readonly Missing[], targets: readonly NavTarget[], ctx: NavGateCtx): UnavailableAnswer {
  const { related, lead } = relatedFor(text, missing, targets);
  const lines = [...new Set(missing.map((m) => missingMessage(m.entry, m.reason, ctx)))].slice(0, 2);
  return { message: [...lines, ...(lead ? [lead] : [])].join(" "), related, fact: factFor(missing.slice(0, 2), related, ctx) };
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
    const missing: Missing[] = [];
    for (const g of groups) {
      const open = bestOf(g.entries.flatMap(reachable));
      if (open) { if (!opens.some((o) => o.id === open.id)) opens.push(open); continue; }
      const entry = bestOf(g.entries);
      if (entry) missing.push({ entry, reason: entry.gate(i.ctx) ?? "unavailable" });
    }
    if (opens.length > 0) return { kind: "open", targets: opens.slice(0, 3) };
    if (missing.length > 0) return { kind: "unavailable", ...describeMissing(i.message, missing, i.targets, i.ctx) };
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
export function unavailableAsk(message: string, targets: readonly NavTarget[], ctx: NavGateCtx): UnavailableAnswer | null {
  const text = message.trim();
  if (!text || text.length > 120 || !WHERE_RE.test(text)) return null;
  const missing = missingNamed(text, targets, ctx);
  return missing ? describeMissing(text, missing, targets, ctx) : null;
}

/** The fixed sentence alone; see unavailableAsk. */
export const answerUnavailableAsk = (message: string, targets: readonly NavTarget[], ctx: NavGateCtx): string | null =>
  unavailableAsk(message, targets, ctx)?.message ?? null;

/** The screens `text` names, when every one of them is out of this caller's reach; otherwise null. */
function missingNamed(text: string, targets: readonly NavTarget[], ctx: NavGateCtx): Missing[] | null {
  const allowed = new Set(targets.map((t) => canonicalId(t.id)));
  const groups = namedGroups(text);
  if (groups.length === 0) return null;
  const missing: Missing[] = [];
  for (const g of groups) {
    if (g.entries.some((e) => allowed.has(e.id))) return null;
    const entry = bestOf(g.entries);
    if (entry) missing.push({ entry, reason: entry.gate(ctx) ?? "unavailable" });
  }
  return missing.length ? missing : null;
}

// ── The follow-up: "but I am the admin", "where do I switch it on" ──────────────────────────────────────────
// The fixed sentence is right once. Said again to someone pushing back it reads like a machine (owner, KAMCO
// 2026-11-19: three identical answers in a row), so a follow-up goes to the model with the facts above.

export type GuardTurn = { role: "user" | "assistant"; text: string };

const UNAVAILABLE_TEXT_RE = /is not (?:switched on in|part of|available in) your workspace|is only for workspace administrators|You do not have access to/;
/** Words of a reply to "that is not available". Loose on purpose: it only counts next to a recent unavailable answer. */
const REPLY_RE = /\b(?:admin|administrator|owner|why|but|understand|understood|already|again|still|enable|activate|switch|turn|contact|who)\b/i;
const PUSHBACK_RE = /\b(?:i am|i'm|im)\b.*\badmin|\bbut\b|\bunderstand|\bwhy\b|\balready\b|\b(?:switch|turn)\s+(?:it|this|that)\s+on\b|\benable (?:it|this|that)\b|\bwho can\b/i;

/** The message reads like a reply to an answer already given, not a first request. */
export const isPushback = (message: string): boolean => message.trim().length <= 200 && PUSHBACK_RE.test(message);

const sameText = (a: string, b: string): boolean => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** `answer` is word for word what the assistant said in one of its recent turns. */
export function saidBefore(history: readonly GuardTurn[], answer: string, window = 6): boolean {
  return history.slice(-window).some((t) => t.role === "assistant" && sameText(t.text, answer));
}

/**
 * The facts for a follow-up about a screen this caller cannot reach, or null when this turn is not one. It is one
 * when the message itself names such a screen while pushing back or after being told already, or when it reads like
 * a reply and a recent answer of ours said a screen was unavailable. `history` ends with the person's new message.
 */
export function unavailableFollowUp(history: readonly GuardTurn[], targets: readonly NavTarget[], ctx: NavGateCtx): UnavailableAnswer | null {
  const lastTurn = history[history.length - 1];
  const question = lastTurn?.role === "user" ? lastTurn.text.trim() : "";
  if (!question || question.length > 200) return null;
  const prior = history.slice(0, -1).slice(-8);
  const told = prior.filter((t) => t.role === "assistant" && UNAVAILABLE_TEXT_RE.test(t.text)).map((t) => t.text);

  const own = missingNamed(question, targets, ctx);
  if (own && (isPushback(question) || (WHERE_RE.test(question) && told.length > 0))) return describeMissing(question, own, targets, ctx);
  if (told.length === 0 || !REPLY_RE.test(question)) return null;

  const missing: Missing[] = [];
  const asked = prior.filter((t) => t.role === "user" && t.text.length <= 200).map((t) => t.text).reverse();
  for (const text of asked) {
    for (const m of missingNamed(text, targets, ctx) ?? []) {
      if (told.some((t) => t.includes(shownName(m.entry))) && !missing.some((x) => x.entry.id === m.entry.id)) missing.push(m);
    }
  }
  return missing.length ? describeMissing([question, ...asked].join(" "), missing, targets, ctx) : null;
}

/** A last guard for any path: the same words twice in a row are never sent. */
export function notTheSameAgain(history: readonly GuardTurn[], answer: string): string {
  const last = [...history].reverse().find((t) => t.role === "assistant");
  if (!last || !answer.trim() || !sameText(last.text, answer)) return answer;
  return `I know that is the same answer as before, sorry. ${answer.trim()} Tell me what you are trying to get done and I will look for another way.`;
}
