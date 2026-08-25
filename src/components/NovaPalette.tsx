"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV, ROUTES } from "@/lib/constants";
import type { NavItem } from "@/lib/constants";
import type { SearchResult } from "@/lib/globalSearch";
import { getSearchObject } from "@/lib/globalSearch";
import { useTenant, useViewableWorkcenters, useIsWfmSupervisor } from "@/lib/tenant-context";

/**
 * The Nova command palette — pillar one of BPMSquare Nova, the Business OS
 * (bpmsquarecore §10). ⌘K / Ctrl+K from anywhere opens one overlay that
 * does everything: jump to any screen you're allowed to see, create any
 * record your modules include, and find any record by name — all without
 * touching the mouse.
 *
 * Mounted once in Shell, only when the tenant is on Nova (the parent gates
 * on useIsNextgen3Layer, which itself requires the platform-admin
 * next_experience flag). Record search goes through the same /api/search
 * the global bar uses, so workcenter permissions are enforced server-side.
 */

type Item =
  | { kind: "nav"; label: string; sub: string; href: string; event?: string; eventDetail?: Record<string, unknown> }
  | { kind: "create"; label: string; sub: string; href: string; event?: string; mode?: string }
  | { kind: "record"; label: string; sub: string; href: string; matched: string; event?: undefined; eventDetail?: undefined }
  // A record CATEGORY header (client request 2026-08-22): results group by
  // object type instead of one long mixed list; the arrow expands that
  // category, newest-first. Enter/click toggles -- it never closes the palette.
  | { kind: "group"; label: string; sub: string; href: string; type: string; expanded: boolean; event?: undefined; eventDetail?: undefined };

const CREATE_ACTIONS: { label: string; href: string; featureKey: string }[] = [
  { label: "New Account",   href: "/accounts/new",    featureKey: "accounts" },
  { label: "New Contact",   href: "/contacts/new",    featureKey: "contacts" },
  { label: "New Quotation", href: "/quotations/new",  featureKey: "quotations" },
  { label: "New Asset",     href: "/assets/new",      featureKey: "assets" },
  { label: "New Supplier",  href: "/suppliers/new",   featureKey: "suppliers" },
  { label: "New Product",   href: "/products/new",    featureKey: "products" },
  { label: "New Technician", href: "/technicians/new", featureKey: "technicians" },
];

const SECTION_LABEL: Record<Item["kind"], string> = {
  nav: "Go to", create: "Create", record: "Records", group: "Records",
};

const DEBOUNCE_MS = 250;

function Icon({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={d} fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"}
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
const ICON_NAV = "M6.5 3.5 12.5 8 6.5 12.5";                                   // chevron: navigate
const ICON_ADD = "M8 3.5v9M3.5 8h9";                                           // plus: create
const ICON_DOC = "M4.5 2h5L12 4.5V14h-7.5zM9.5 2v3H12";                        // record

// A single sentence directed AT Nova ("prep me for my call with X") is not
// pasted correspondence to extract a record from -- it was misclassified as
// one purely by length (owner-flagged 2026-08-25: "prep me for next call
// with Hosapate steels" offered "Draft an account from this text" and
// nothing else). Real pasted contact info is either genuinely multi-line
// (an email/WhatsApp thread) or carries an actual email/phone marker even
// on one line (a forwarded signature); a plain question or command has
// neither. This tightens the heuristic without a length cutoff at all --
// long is not the same signal as "looks like a record to draft".
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(?:\+?\d[\d\s-]{7,}\d)/;
function looksLikePastedContent(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  if (t.includes("\n")) return true;
  return EMAIL_RE.test(t) || PHONE_RE.test(t);
}

// "prep me for my next call with X" is the command bar's OWN advertised
// example (owner-flagged 2026-08-25, alongside the misfire above) -- this
// extracts just the account name X so it can be looked up directly, rather
// than fuzzy-matching the whole sentence against every account name (which
// is what made the misfire this looks so similar to). Matching account
// opens Account 360 -- the actual call-prep content (health rating,
// next-best-action, cards) -- not a plain account page (2026-08-27 fix:
// this used to just router.push() the account's own href, which looked
// like nothing had happened once you got there).
//
// Determiner/connector list widened same date -- "prep me for A call"
// and "call ABOUT X" were real, reported misses against the exact
// advertised phrasing's own natural variants.
//
// "meeting" as an alternate to "call" added 2026-08-27 (real, reported
// miss -- "prepare for meeting with X" flatly didn't match "call\s+" at
// all). Captures which noun was used so the label can say the right thing
// back, instead of always claiming "call" for a meeting request.
const CALL_PREP_RE = /\bprep(?:are)?\s+(?:me\s+)?for\s+(?:my\s+|our\s+|your\s+|a\s+|an\s+|this\s+|that\s+|the\s+)?(?:next\s+|upcoming\s+)?(call|meeting)\s+(?:with|about|regarding|on|for)\s+(.+?)[.?!]*$/i;

export default function NovaPalette() {
  const router = useRouter();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // Which record categories are expanded; resets with each new query.
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  useEffect(() => { setExpandedTypes(new Set()); }, [query]);
  const [active, setActive] = useState(0);
  const [callPrepAccount, setCallPrepAccount] = useState<SearchResult | null>(null);
  // Which noun the user actually typed -- "call" or "meeting" -- so the
  // offer's label says the right thing back instead of always "call".
  const [callPrepKind, setCallPrepKind] = useState<"call" | "meeting">("call");
  // The extracted name, once a search for it has resolved with NO match --
  // distinct from callPrepAccount(null) which is also the "haven't searched
  // yet" state. Without this, a genuine "no account named X" read as the
  // whole palette silently doing nothing, same as it would for a typo.
  const [callPrepNotFound, setCallPrepNotFound] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callPrepDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const features = tenant?.features as Record<string, boolean> | undefined;

  // ── The static universe: navigation + create actions, permission-filtered
  // exactly the way the sidebar filters (features + workcenter grants +
  // supervisor-only rows), so the palette can never offer a door the
  // sidebar wouldn't. ──
  const universe = useMemo<Item[]>(() => {
    const canSee = (item: NavItem) =>
      (!item.featureKey || features?.[item.featureKey] === true) &&
      (viewable === "all" || !item.workcenterKey || (viewable as string[]).includes(item.workcenterKey)) &&
      (!item.supervisorOnly || isWfmSupervisor);

    const nav: Item[] = [];
    for (const group of NAV) {
      for (const item of group.items) {
        if (!canSee(item)) continue;
        nav.push({ kind: "nav", label: item.label, sub: group.group, href: item.href });
        for (const child of item.children ?? []) {
          if (!canSee(child)) continue;
          nav.push({ kind: "nav", label: child.label, sub: item.label, href: child.href });
        }
      }
    }
    if (viewable === "all") nav.push({ kind: "nav", label: "Settings", sub: "Workspace", href: ROUTES.settings });

    const create: Item[] = CREATE_ACTIONS
      .filter((a) => features?.[a.featureKey] === true)
      .map((a) => ({ kind: "create", label: a.label, sub: "Create", href: a.href }));

    // Pillar 2: AI record creation -- top of the Create list, the way a
    // record SHOULD start on Nova. Listed in reverse of unshift order so
    // Account ends up first (the most common paste-to-create starting point).
    if (features?.products === true) {
      create.unshift({ kind: "create", label: "New product from paste", sub: "Nova AI", href: "@nova-draft", event: "nova:open-draft", mode: "products" });
    }
    if (features?.quotations === true) {
      create.unshift({ kind: "create", label: "New quote from paste", sub: "Nova AI", href: "@nova-draft", event: "nova:open-draft", mode: "quotes" });
    }
    if (features?.contacts === true) {
      create.unshift({ kind: "create", label: "New contact from paste", sub: "Nova AI", href: "@nova-draft", event: "nova:open-draft", mode: "contacts" });
    }
    if (features?.accounts === true) {
      create.unshift({ kind: "create", label: "New account from paste", sub: "Nova AI", href: "@nova-draft", event: "nova:open-draft", mode: "accounts" });
    }

    return [...create, ...nav];
  }, [features, viewable, isWfmSupervisor]);

  // ── Open/close: global hotkey + the top-bar search trigger ──
  // The Nova top bar renders a search-shaped BUTTON (not a live input) that
  // dispatches this event -- one search surface, two entry points: click for
  // mouse people, ⌘K for keyboard people.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    function onOpenEvent() { setOpen(true); }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("nova:open-palette", onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("nova:open-palette", onOpenEvent);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery(""); setRecords([]); setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // ── Record search: same endpoint as the global bar, debounced ──
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // A pasted paragraph is never a record name -- don't burn a search on it.
    if (query.trim().length < 2 || looksLikePastedContent(query)) { setRecords([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((json) => setRecords(Array.isArray(json.results) ? json.results : []))
        .catch(() => setRecords([]))
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // ── "prep me for my call with X" -- look up X directly rather than
  // fuzzy-matching the whole sentence (see CALL_PREP_RE above) ──
  useEffect(() => {
    if (callPrepDebounceRef.current) clearTimeout(callPrepDebounceRef.current);
    const match = query.match(CALL_PREP_RE);
    const kind = match?.[1]?.toLowerCase() === "meeting" ? "meeting" : "call";
    const name = match?.[2]?.trim();
    if (!name || features?.accounts !== true) { setCallPrepAccount(null); setCallPrepNotFound(null); return; }
    setCallPrepKind(kind);
    setCallPrepNotFound(null);
    callPrepDebounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(name)}`)
        .then((r) => r.json())
        .then((json) => {
          const results: SearchResult[] = Array.isArray(json.results) ? json.results : [];
          const found = results.find((r) => r.type === "account") ?? null;
          setCallPrepAccount(found);
          setCallPrepNotFound(found ? null : name);
        })
        .catch(() => { setCallPrepAccount(null); setCallPrepNotFound(name); });
    }, DEBOUNCE_MS);
    return () => { if (callPrepDebounceRef.current) clearTimeout(callPrepDebounceRef.current); };
  }, [query, features?.accounts]);

  // ── Visible items: filtered universe + record results ──
  // Multi-line, or long AND carrying an email/phone marker, isn't a query --
  // it's pasted CONTENT (the WhatsApp message, the email). A plain sentence
  // asking Nova something, however long, is not (see looksLikePastedContent).
  const pastedContent = looksLikePastedContent(query);
  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const statics = q
      ? universe.filter((i) => i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q))
      : universe.slice(0, 12);
    // Group records by object type, in order of first appearance (which is
    // relevance order). One category alone is auto-expanded -- a header with
    // nothing under it would just be a click tax.
    const groups = new Map<string, SearchResult[]>();
    for (const r of records) {
      const list = groups.get(r.type);
      if (list) list.push(r); else groups.set(r.type, [r]);
    }
    const recs: Item[] = [];
    for (const [type, list] of groups) {
      const label = getSearchObject(type)?.label ?? type;
      const isOpen = expandedTypes.has(type) || groups.size === 1;
      recs.push({
        kind: "group", type, label, expanded: isOpen, href: `@group-${type}`,
        sub: `${list.length} result${list.length === 1 ? "" : "s"}`,
      });
      if (isOpen) {
        const sorted = [...list].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        for (const r of sorted) {
          recs.push({ kind: "record", label: r.title, sub: r.subtitle || r.type, href: r.href, matched: r.matched });
        }
      }
    }
    const draftOffer: Item[] = pastedContent && features?.accounts === true
      ? [{ kind: "create", label: "Draft an account from this text", sub: "Nova AI", href: "@nova-draft", event: "nova:open-draft", mode: "accounts" }]
      : [];
    // "prep me for my call with X" resolved to a real account -- surface
    // it above everything else, since it's the one thing the user actually
    // asked for. Opens Account 360 (health rating, next-best-action, cards)
    // via the same event Account360Button uses -- not a plain account nav.
    const callPrepOffer: Item[] = callPrepAccount
      ? [{
          kind: "nav", label: `Prep for ${callPrepKind}: ${callPrepAccount.title}`, sub: "Nova · Account 360",
          href: callPrepAccount.href, event: "nova:open-account-360", eventDetail: { id: callPrepAccount.id },
        }]
      : [];
    return [...callPrepOffer, ...draftOffer, ...statics.slice(0, 10), ...recs.slice(0, 40)];
  }, [query, universe, records, pastedContent, features?.accounts, expandedTypes, callPrepAccount, callPrepKind]);

  // New query -> highlight back to the top; a mere expand/collapse only
  // clamps, so the cursor stays where the user was.
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { setActive((a) => Math.max(0, Math.min(a, items.length - 1))); }, [items.length]);

  const go = useCallback((item: Item) => {
    if (item.kind === "group") {
      setExpandedTypes((prev) => {
        const next = new Set(prev);
        if (next.has(item.type)) next.delete(item.type); else next.add(item.type);
        return next;
      });
      return;
    }
    setOpen(false);
    if (item.event) {
      // "create" carries the draft-mode + pasted-text shape (so the draft
      // modal starts working immediately instead of asking for the same
      // paste twice); any other event-carrying item (e.g. the call-prep
      // offer opening Account 360) supplies its own eventDetail directly.
      const detail = item.kind === "create"
        ? { mode: item.mode, ...(pastedContent ? { text: query } : {}) }
        : item.eventDetail;
      window.dispatchEvent(new CustomEvent(item.event, { detail }));
      return;
    }
    router.push(item.href);
  }, [router, query, pastedContent]);

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); go(items[active]); }
  }

  if (!open) return null;

  // Section headers appear when the SECTION changes between consecutive rows
  // (group + record rows share the "Records" section).
  let lastSection: string | null = null;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: "fixed", inset: 0, zIndex: 900,
        background: "rgba(5, 10, 18, .55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "12vh 16px 16px",
      }}
    >
      <div
        role="dialog" aria-label="Nova command palette"
        style={{
          width: 520, maxWidth: "100%",
          background: "var(--sb-panel-bg)", border: "1px solid var(--sb-panel-border)",
          borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.55)", overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 15px", borderBottom: "1px solid var(--sb-panel-border)" }}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ color: "var(--sb-panel-text-dim)", flexShrink: 0 }}>
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Jump to, create, or find anything…"
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontSize: 14.5, color: "var(--sb-panel-text)", fontFamily: "inherit",
            }}
          />
          <span style={{
            fontSize: 9.5, padding: "2px 6px", borderRadius: 4, flexShrink: 0,
            border: "1px solid var(--sb-panel-border)", color: "var(--sb-panel-text-dim)",
          }}>
            esc
          </span>
        </div>

        <div style={{ maxHeight: "52vh", overflowY: "auto", padding: 6 }}>
          {items.length === 0 && (
            <div style={{ padding: "22px 14px", fontSize: 12.5, color: "var(--sb-panel-text-dim)", textAlign: "center" }}>
              {searching
                ? "Searching…"
                : callPrepNotFound
                ? `No account matches "${callPrepNotFound}" — check the spelling or try the full name.`
                : query.trim().length >= 2 ? "Nothing matches — try a name, ref, or screen." : "Type to search screens, actions and records."}
            </div>
          )}
          {items.map((item, idx) => {
            const showHeader = SECTION_LABEL[item.kind] !== lastSection;
            lastSection = SECTION_LABEL[item.kind];
            const isActive = idx === active;
            const isGroup = item.kind === "group";
            return (
              <div key={`${item.kind}-${item.href}-${idx}`}>
                {showHeader && (
                  <div style={{
                    fontSize: 9.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase",
                    color: "var(--sb-panel-text-dim)", padding: "8px 10px 4px",
                  }}>
                    {SECTION_LABEL[item.kind]}
                  </div>
                )}
                <button
                  onClick={() => go(item)}
                  onMouseEnter={() => setActive(idx)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%",
                    padding: "9px 10px", border: "none", borderRadius: 8, cursor: "pointer",
                    textAlign: "left", font: "inherit",
                    background: isActive ? "color-mix(in srgb, var(--nova-pink) 16%, transparent)" : "transparent",
                    color: "var(--sb-panel-text)",
                  }}
                >
                  <span style={{
                    color: isActive ? "var(--nova-pink)" : "var(--sb-panel-text-dim)", display: "flex",
                    marginLeft: item.kind === "record" ? 14 : 0,
                    transform: isGroup && item.expanded ? "rotate(90deg)" : undefined, transition: "transform .12s",
                  }}>
                    <Icon d={item.kind === "create" ? ICON_ADD : item.kind === "record" ? ICON_DOC : ICON_NAV} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: isGroup ? 700 : 550 }}>
                    {item.label}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--sb-panel-text-dim)", flexShrink: 0, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.sub}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div style={{
          display: "flex", gap: 14, padding: "8px 14px", borderTop: "1px solid var(--sb-panel-border)",
          fontSize: 10, color: "var(--sb-panel-text-dim)", background: "var(--sb-panel-hover)",
        }}>
          <span>↑↓ navigate</span><span>↵ open</span><span style={{ marginLeft: "auto" }}>BPMSquare Nova</span>
        </div>
      </div>
    </div>
  );
}
