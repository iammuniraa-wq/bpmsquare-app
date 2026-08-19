"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV, ROUTES } from "@/lib/constants";
import type { NavItem } from "@/lib/constants";
import type { SearchResult } from "@/lib/globalSearch";
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
  | { kind: "nav"; label: string; sub: string; href: string }
  | { kind: "create"; label: string; sub: string; href: string; event?: string }
  | { kind: "record"; label: string; sub: string; href: string; matched: string };

const CREATE_ACTIONS: { label: string; href: string; featureKey: string }[] = [
  { label: "New Account",   href: "/accounts/new",    featureKey: "accounts" },
  { label: "New Contact",   href: "/contacts/new",    featureKey: "contacts" },
  { label: "New Quotation", href: "/quotations/new",  featureKey: "quotations" },
  { label: "New Asset",     href: "/assets/new",      featureKey: "assets" },
  { label: "New Supplier",  href: "/suppliers/new",   featureKey: "suppliers" },
  { label: "New Technician", href: "/technicians/new", featureKey: "technicians" },
];

const SECTION_LABEL: Record<Item["kind"], string> = {
  nav: "Go to", create: "Create", record: "Records",
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

export default function NovaPalette() {
  const router = useRouter();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // record SHOULD start on Nova.
    if (features?.accounts === true) {
      create.unshift({ kind: "create", label: "New account from paste", sub: "Nova AI", href: "@nova-draft", event: "nova:open-draft" });
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
    if (query.trim().length < 2 || query.trim().length >= 40 || query.includes("\n")) { setRecords([]); return; }
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((json) => setRecords(Array.isArray(json.results) ? json.results : []))
        .catch(() => setRecords([]));
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // ── Visible items: filtered universe + record results ──
  // A long or multi-line query isn't a query -- it's pasted CONTENT (the
  // WhatsApp message, the email). Recognize the intent and offer to draft
  // a record from it right here, instead of a dead "nothing matches".
  const pastedContent = query.trim().length >= 40 || query.includes("\n");
  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const statics = q
      ? universe.filter((i) => i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q))
      : universe.slice(0, 12);
    const recs: Item[] = records.map((r) => ({
      kind: "record", label: r.title, sub: r.subtitle || r.type, href: r.href, matched: r.matched,
    }));
    const draftOffer: Item[] = pastedContent && features?.accounts === true
      ? [{ kind: "create", label: "Draft an account from this text", sub: "Nova AI", href: "@nova-draft", event: "nova:open-draft" }]
      : [];
    return [...draftOffer, ...statics.slice(0, 10), ...recs.slice(0, 8)];
  }, [query, universe, records, pastedContent, features?.accounts]);

  useEffect(() => { setActive(0); }, [items.length, query]);

  const go = useCallback((item: Item) => {
    setOpen(false);
    if (item.kind === "create" && item.event) {
      // Pasted content travels with the event so the draft modal starts
      // working immediately instead of asking for the same paste twice.
      window.dispatchEvent(new CustomEvent(item.event, {
        detail: pastedContent ? { text: query } : undefined,
      }));
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

  // Section headers appear when the kind changes between consecutive rows.
  let lastKind: Item["kind"] | null = null;

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
              {query.trim().length >= 2 ? "Nothing matches — try a name, ref, or screen." : "Type to search screens, actions and records."}
            </div>
          )}
          {items.map((item, idx) => {
            const showHeader = item.kind !== lastKind;
            lastKind = item.kind;
            const isActive = idx === active;
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
                    background: isActive ? "color-mix(in srgb, var(--modern-accent, var(--accent)) 16%, transparent)" : "transparent",
                    color: "var(--sb-panel-text)",
                  }}
                >
                  <span style={{ color: isActive ? "var(--modern-accent, var(--accent))" : "var(--sb-panel-text-dim)", display: "flex" }}>
                    <Icon d={item.kind === "create" ? ICON_ADD : item.kind === "record" ? ICON_DOC : ICON_NAV} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 550 }}>
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
