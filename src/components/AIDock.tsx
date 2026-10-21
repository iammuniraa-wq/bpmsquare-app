"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { useIsNextgen3Layer, useTenantFeature } from "@/lib/tenant-context";
import ChartRenderer from "@/components/charts/ChartRenderer";
import InfoTip from "@/components/ui/InfoTip";
import { normalizeReport, type ReportPayload } from "@/lib/reportView";
import { parsePageContext } from "@/lib/assistant/objects";
import { isInternalPath } from "@/lib/assistant/navTargets";
import { ASSISTANT_TIPS, usageTip } from "@/lib/assistant/tips";
import type { Suggestion } from "@/lib/assistant/suggestions";

type Card = { id: string; label: string; href: string };
type Msg = { from: "bot" | "me"; text: string; report?: ReportPayload; cards?: Card[] };
type Usage = { percent: number; off: boolean };

// Per-user, per-browser preference -- separate from the tenant-level
// ai_assistant feature flag (Shell only mounts this component when that's
// on). A tenant can offer the assistant while an individual user still
// hides the launcher for themselves, same pattern as bms_nextgen_dark etc.
const ENABLED_KEY = "bms_ai_dock_enabled";

// Create-from-paste, on Nova tenants only. This is deliberately NOT the
// chat/ask() path answering with a mutation -- it opens NovaDraft, the
// same human-review-before-create modal the ⌘K palette uses.
const CREATE_MODES: { mode: string; label: string; featureKey: "accounts" | "contacts" | "quotations" | "products" }[] = [
  { mode: "accounts", label: "New account", featureKey: "accounts" },
  { mode: "contacts", label: "New contact", featureKey: "contacts" },
  { mode: "quotes", label: "New quote", featureKey: "quotations" },
  { mode: "products", label: "New product", featureKey: "products" },
];

/**
 * Assistant dock -- a persistent bottom-right launcher that expands into a chat panel (full screen under 900 px).
 *
 * It knows where the person is: the current route goes with every ask and every open, and the server (never this
 * component) loads the record behind it through the caller's own permissions. The panel shows labels, values and
 * buttons only; every explanation sits behind an "i" (bpmsquarecore.md 6b, texts in assistant/tips.ts).
 *
 * Three things in the panel: the context fact ("On SQ-2026-0012 · Al-Otaibi Contracting"), the suggestions strip
 * (rules, not AI; each chip opens a screen or asks a prepared question), and the chat. Answers can carry buttons
 * that open a screen or a record, and an inline chart (ChartRenderer, same engine as Talk to data). Nothing here
 * can change data. On Nova tenants the empty state also offers "draft from a paste", reusing NovaDraft.
 */
export default function AIDock({ liftForTabBar = false }: {
  /** Set on mobile where MobileTabBar (Nova only) is fixed to the same bottom
   *  edge -- without it the launcher sits on top of the tabs. */
  liftForTabBar?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [capabilities, setCapabilities] = useState<string[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [context, setContext] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nova = useIsNextgen3Layer();
  const hasAccounts = useTenantFeature("accounts");
  const hasContacts = useTenantFeature("contacts");
  const hasQuotations = useTenantFeature("quotations");
  const hasProducts = useTenantFeature("products");
  const featureByKey: Record<string, boolean> = { accounts: hasAccounts, contacts: hasContacts, quotations: hasQuotations, products: hasProducts };
  const createChips = nova ? CREATE_MODES.filter((m) => featureByKey[m.featureKey]) : [];

  function openDraft(mode: string) {
    window.dispatchEvent(new CustomEvent("nova:open-draft", { detail: { mode } }));
  }

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(ENABLED_KEY) !== "0");
    } catch { /* ignore */ }
  }, []);

  function toggleEnabled() {
    setEnabled((v) => {
      const next = !v;
      try { localStorage.setItem(ENABLED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      if (!next) setOpen(false);
      return next;
    });
  }

  // Fetched when the panel opens and again when the person moves to another screen -- not on mount: this dock
  // renders on every page and most sessions never open it. The server resolves the route to a record itself.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/ai/ask?route=${encodeURIComponent(pathname ?? "")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        setCapabilities(j?.capabilities ?? []);
        setSuggestions(Array.isArray(j?.suggestions) ? j.suggestions : []);
        setContext(j?.context?.label ?? null);
        if (j?.usage) setUsage(j.usage);
      })
      .catch(() => { if (alive) setCapabilities((prev) => prev ?? []); });
    return () => { alive = false; };
  }, [open, pathname]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function go(href: string) {
    if (!isInternalPath(href)) return;
    router.push(href);
    // Full-screen on a phone: leave it, or the page that was asked for stays hidden behind the chat.
    if (typeof window !== "undefined" && window.innerWidth < 900) setOpen(false);
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    // History travels with the question so follow-ups keep their context --
    // text only; the server treats it as conversation, never as a query.
    const history = [...messages, { from: "me" as const, text }]
      .slice(-12)
      .map((m) => ({ role: m.from === "me" ? "user" : "assistant", text: m.text }));
    setMessages((prev) => [...prev, { from: "me", text }]);
    setDraft("");
    setBusy(true);
    try {
      // The page goes as ids only: the route, and the object type and record id read from it. Never record content.
      const page = parsePageContext(pathname);
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text, history, route: pathname,
          objectType: page?.objectType ?? null, recordId: page?.recordId ?? null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        if (json.usage) setUsage(json.usage);
        const cards: Card[] | undefined = Array.isArray(json.cards) ? json.cards : undefined;
        setMessages((prev) => [...prev, { from: "bot", text: json.answer, report: json.report as ReportPayload | undefined, cards }]);
        if (json.autoFollow && cards?.length === 1) go(cards[0].href);
      } else {
        setMessages((prev) => [...prev, { from: "bot", text: json.error ?? "Something went wrong." }]);
      }
    } catch {
      setMessages((prev) => [...prev, { from: "bot", text: "Could not reach the server." }]);
    } finally {
      setBusy(false);
    }
  }

  function sendMessage() { ask(draft); }

  function runSuggestion(s: Suggestion) {
    if (s.kind === "navigate" && s.target) go(s.target);
    else if (s.kind === "ask" && s.question) ask(s.question);
  }

  // The dock stacks upward from the bottom-right corner. Two rules keep it on
  // screen: every offset clears the safe-area inset (a phone's home indicator,
  // and any browser chrome that eats the bottom edge), and the LAUNCHER owns
  // the bottom anchor whenever it is showing -- the on/off switch sits above
  // it. The switch used to hold the bottom slot with the launcher stacked over
  // it, which put a 22px control hard against the window edge where a short
  // viewport clipped it (owner-reported 2026-09-06).
  const FLOOR = liftForTabBar
    ? "calc(58px + env(safe-area-inset-bottom, 0px))"
    : "env(safe-area-inset-bottom, 0px)";
  const at = (px: number) => `calc(${px}px + ${FLOOR})`;

  const pill = usage && (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "2px 8px", letterSpacing: 0.2,
          color: usage.percent >= 100 ? "var(--bad, #b42318)" : c.muted, background: "var(--panel2)", border: "1px solid var(--line)",
        }}
      >
        AI usage {usage.percent}%
      </span>
      <InfoTip label="AI usage">{usage.percent >= 100 ? ASSISTANT_TIPS.overBudget : usageTip(usage.percent, usage.off)}</InfoTip>
    </span>
  );

  return (
    <>
      <button
        data-dock-open={open}
        onClick={toggleEnabled}
        aria-label={enabled ? "Turn off AI assistant" : "Turn on AI assistant"}
        title={enabled ? "Turn off AI assistant" : "Turn on AI assistant"}
        style={{
          position: "fixed", right: 22, bottom: enabled ? at(86) : at(20), zIndex: 301,
          width: 40, height: 22, borderRadius: 11, cursor: "pointer",
          border: "1px solid var(--line)",
          background: enabled ? "var(--tenant-accent, #1e3a6e)" : "var(--panel2)",
          padding: 2, display: "flex", justifyContent: enabled ? "flex-end" : "flex-start",
          boxShadow: "0 4px 12px rgba(0,0,0,.18)",
        }}
      >
        <span style={{
          width: 16, height: 16, borderRadius: "50%",
          background: enabled ? "#fff" : "var(--muted)",
        }} />
      </button>

      {enabled && (
        <button
          data-dock-open={open}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close assistant" : "Open assistant"}
          style={{
            position: "fixed", right: 22, bottom: at(20), zIndex: 300,
            width: 52, height: 52, borderRadius: "50%", border: "none", cursor: "pointer",
            background: "var(--tenant-accent, #1e3a6e)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 10px 26px rgba(0,0,0,.25)",
          }}
        >
          {!open && (
            <span style={{
              position: "absolute", inset: -4, borderRadius: "50%",
              border: "2px solid var(--tenant-accent, #1e3a6e)", opacity: 0.35,
              animation: "vvcrm-pulse-ring 2.2s ease-out infinite",
            }} />
          )}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 L14.2 8.8 L21 11 L14.2 13.2 L12 20 L9.8 13.2 L3 11 L9.8 8.8 Z" />
          </svg>
        </button>
      )}

      {enabled && open && (
        <div className="bms-dock-panel" style={{
          position: "fixed", right: 22, bottom: at(122), zIndex: 300,
          // Wide enough for an inline chart to stay legible (a bar chart's
          // labels shrink illegibly below this), capped so it never spills
          // off a narrow viewport.
          width: 400, maxWidth: "calc(100vw - 44px)",
          // Never taller than the room above the launcher, or the panel runs
          // off the TOP of a laptop viewport and its header scrolls out of
          // reach (visible in the same 2026-09-06 report). 560 stays the cap
          // on a tall screen; the viewport wins on a short one.
          maxHeight: `min(560px, calc(100vh - ${at(150)}))`,
          display: "flex", flexDirection: "column",
          background: "var(--card-bg, #fff)", border: "1px solid var(--line)",
          borderRadius: "var(--card-radius, 10px)", boxShadow: "0 24px 60px rgba(10,15,25,.28)",
          overflow: "hidden",
        }}>
          <div style={{ padding: "10px 12px 10px 16px", background: "var(--accentbg)", color: c.accent, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span>✦ Assistant</span>
            <InfoTip label="the assistant">{ASSISTANT_TIPS.header}</InfoTip>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {pill}
              <button
                className="bms-dock-close"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                style={{ background: "transparent", border: "none", color: c.muted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}
              >
                ×
              </button>
            </span>
          </div>

          {context && (
            <div style={{ padding: "8px 16px", borderBottom: `1px solid ${c.line}`, fontSize: 12, color: c.ink, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>On {context}</span>
              <InfoTip label="the open record">{ASSISTANT_TIPS.context}</InfoTip>
            </div>
          )}

          {suggestions.length > 0 && (
            <div style={{ padding: "8px 16px", borderBottom: `1px solid ${c.line}`, display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
              {suggestions.map((s) => (
                <span key={s.id} className="bms-dock-chip-wrap" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  <button
                    className="bms-dock-chip"
                    onClick={() => runSuggestion(s)}
                    disabled={busy && s.kind === "ask"}
                    style={{
                      background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999,
                      padding: "6px 12px", fontSize: 11.5, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {s.label}{s.kind === "navigate" ? " →" : ""}
                  </button>
                  <InfoTip label={s.label}>{s.why}</InfoTip>
                </span>
              ))}
              <InfoTip label="suggestions">{ASSISTANT_TIPS.suggestions}</InfoTip>
            </div>
          )}

          <div ref={scrollRef} style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5, flex: 1, overflowY: "auto", minHeight: 0 }}>
            {messages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {createChips.length > 0 && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 4 }}>
                      Draft from a paste <InfoTip label="draft from a paste">{ASSISTANT_TIPS.draft}</InfoTip>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {createChips.map((item) => (
                        <button
                          key={item.mode}
                          className="bms-dock-chip"
                          onClick={() => openDraft(item.mode)}
                          style={{
                            background: "var(--accentbg)", border: `1px solid var(--line)`,
                            borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 650,
                            color: c.accent, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          ✦ {item.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {capabilities === null && <div style={{ color: c.hint }}>Loading…</div>}
                {capabilities?.length === 0 && (
                  <div style={{ color: c.hint }}>There&apos;s no data I can report on for your account yet.</div>
                )}
                {capabilities && capabilities.length > 0 && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>
                      Try asking
                    </div>
                    {capabilities.map((cap) => (
                      <button
                        key={cap}
                        className="bms-dock-row"
                        onClick={() => ask(cap)}
                        style={{
                          textAlign: "left", background: "var(--panel2)", border: "1px solid var(--line)",
                          borderRadius: "var(--card-radius, 10px)", padding: "8px 11px", fontSize: 12,
                          color: c.ink, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.4,
                        }}
                      >
                        {cap}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, alignSelf: m.from === "me" ? "flex-end" : "stretch" }}>
                <div
                  style={{
                    alignSelf: m.from === "me" ? "flex-end" : "flex-start",
                    maxWidth: "88%",
                    background: m.from === "me" ? "var(--tenant-accent, #1e3a6e)" : "var(--panel2)",
                    color: m.from === "me" ? "#fff" : c.ink,
                    borderRadius: "var(--card-radius, 10px)",
                    padding: "9px 12px",
                    lineHeight: 1.45,
                    // Answers are multi-line for list intents (recent quotes,
                    // recent cases) -- without this they collapse to one line.
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.text}
                </div>
                {m.cards?.map((card) => (
                  <button
                    key={card.id}
                    className="bms-dock-row"
                    onClick={() => go(card.href)}
                    style={{
                      alignSelf: "flex-start", textAlign: "left", background: "var(--accentbg)", border: "1px solid var(--line)",
                      borderRadius: "var(--card-radius, 10px)", padding: "9px 12px", fontSize: 12, fontWeight: 650,
                      color: c.accent, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {card.label} →
                  </button>
                ))}
                {m.report && (
                  <div style={{ padding: 12, borderRadius: "var(--card-radius, 10px)", border: `1px solid ${c.line}`, background: "var(--card-bg, #fff)" }}>
                    <ChartRenderer report={normalizeReport(m.report)} />
                  </div>
                )}
              </div>
            ))}
            {busy && <div style={{ alignSelf: "flex-start", color: c.hint }}>Looking that up…</div>}
          </div>
          <div className="bms-dock-input" style={{ padding: "8px 16px 14px", display: "flex", gap: 8, flexShrink: 0, background: "var(--card-bg, #fff)" }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
              placeholder="Ask, or say where to go…"
              aria-label="Message the assistant"
              disabled={busy}
              style={{ flex: 1, minWidth: 0, border: "1px solid var(--line)", borderRadius: "var(--card-radius, 10px)", padding: "9px 12px", fontSize: 16, fontFamily: "inherit", outline: "none" }}
            />
            <button
              className="bms-dock-send"
              onClick={sendMessage}
              disabled={busy}
              aria-label="Send"
              style={{ background: "var(--tenant-accent, #1e3a6e)", color: "#fff", border: "none", borderRadius: "var(--card-radius, 10px)", padding: "9px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              →
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes vvcrm-pulse-ring {
          0% { transform: scale(.92); opacity: .5; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        /* Phone and narrow tablet: the panel is the whole screen, the input row stays pinned at its bottom edge and
           every control is at least 44 px. The launcher hides behind it, so the header carries a Close button. */
        @media (max-width: 899px) {
          .bms-dock-panel {
            inset: 0 !important; width: 100% !important; max-width: none !important; max-height: none !important;
            height: 100dvh; border-radius: 0 !important; border: none !important;
            padding-top: env(safe-area-inset-top, 0px);
          }
          .bms-dock-input { padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px)) !important; border-top: 1px solid var(--line); }
          .bms-dock-chip, .bms-dock-row, .bms-dock-send, .bms-dock-close { min-height: 44px; min-width: 44px; }
          .bms-dock-chip-wrap { max-width: 100%; }
          [data-dock-open="true"] { display: none !important; }
        }
      `}</style>
    </>
  );
}
