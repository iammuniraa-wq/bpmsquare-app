"use client";

import { useEffect, useRef, useState } from "react";
import { AI_DOCK_ASK_EVENT, type DockAskDetail } from "@/lib/analysis/dockAsk";
import { usePathname, useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { useIsNextgen3Layer, useTenantFeature } from "@/lib/tenant-context";
import ChartRenderer from "@/components/charts/ChartRenderer";
import InfoTip from "@/components/ui/InfoTip";
import { BriefingCard } from "@/components/BriefingTile";
import { normalizeReport, type ReportPayload } from "@/lib/reportView";
import { parsePageContext } from "@/lib/assistant/objects";
import { isInternalPath } from "@/lib/assistant/navTargets";
import { ASSISTANT_TIPS, usageTip } from "@/lib/assistant/tips";
import type { Suggestion } from "@/lib/assistant/suggestions";
import type { ConfirmCard } from "@/lib/assistant/cards";
import ConfirmCardView from "@/components/assistant/ConfirmCardView";
import { AnalysisConsentRow, WebConsentRow, WebSources } from "@/components/assistant/WebResearch";
import AnalysisCardView from "@/components/analysis/AnalysisCardView";
import type { DockAnalysis } from "@/lib/assistant/analysisTool";
import { applyChoice, settleOnNewAsk, type ConsentState, type WebAllow, type WebChoice } from "@/lib/assistant/webConsent";
import { Markdown, InlineMarkdown } from "@/components/assistant/Markdown";
import { plainText } from "@/lib/assistant/markdown";
import { DOCK_PANEL_CSS } from "@/components/assistant/dockLayout";
import type { GuideReply } from "@/lib/assistant/guide";
import GuideOverlay, { type GuideTargetState } from "@/components/GuideOverlay";

type Card = { id: string; label: string; href: string };
type WebSource = { title: string; url: string };
type Msg = {
  from: "bot" | "me"; text: string; report?: ReportPayload; cards?: Card[]; guide?: GuideReply;
  /** A create the assistant proposes: the confirm card. */
  confirm?: ConfirmCard;
  /** The assistant asked to search the web, or to analyse a company with web research; answered with the chips. */
  consent?: { kind: "web_search" | "analyse_company"; query: string; subject?: string; state: ConsentState; token: string };
  web?: WebSource[];
  /** A company analysis, drawn as a card from its fields. */
  analysis?: DockAnalysis;
};
/** What an Analyse or Refresh press sends: the company, never record content. */
type AnalyseRequest = { account_id?: string; name?: string; domain?: string; country?: string; refresh?: boolean };
type GuideOffer = { id: string; label: string };
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
 * buttons only; the three explanations that earn an "i" sit behind it (bpmsquarecore.md 6b, texts in
 * assistant/tips.ts), and the assistant's text is read as markdown before it is shown (assistant/Markdown.tsx).
 *
 * Three things in the panel: the context fact ("On SQ-2026-0012 · Al-Otaibi Contracting"), the suggestions strip
 * (rules, not AI; each chip opens a screen or asks a prepared question), and the chat. Answers can carry buttons
 * that open a screen or a record, and an inline chart (ChartRenderer, same engine as Talk to data). Nothing here
 * changes data except a confirm card's own button (ConfirmCardView, flag ai_assistant_actions). On Nova tenants the empty state also offers "draft from a paste", reusing NovaDraft.
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
  const [searching, setSearching] = useState(false);
  const [guides, setGuides] = useState<GuideOffer[]>([]);
  const [canAnalyse, setCanAnalyse] = useState(false);
  // Guide mode: the steps being followed, the one the person is on, and where its control stands on the page.
  const [guide, setGuide] = useState<{ reply: GuideReply; i: number } | null>(null);
  const [target, setTarget] = useState<GuideTargetState>("none");
  const [narrow, setNarrow] = useState(false);
  // Under 900 px the panel is full screen and would hide the control: in guide mode it gives way to a bottom bar.
  const [chatShown, setChatShown] = useState(true);
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

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // A guide belongs to the screen it was written for.
  useEffect(() => { setGuide(null); setChatShown(true); }, [pathname]);
  // A screen (Account 360 card, the Analyse buttons) asks the slider to run a prepared question as if the person typed it.
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<DockAskDetail>).detail;
      if (!d || typeof d.question !== "string" || !d.question.trim()) return;
      setOpen(true);
      setTimeout(() => { void askRef.current(d.question); }, 60);
    };
    window.addEventListener(AI_DOCK_ASK_EVENT, onAsk);
    return () => window.removeEventListener(AI_DOCK_ASK_EVENT, onAsk);
  }, []);

  function startGuide(reply: GuideReply) {
    setGuide({ reply, i: 0 });
    setTarget("none");
    if (narrow) setChatShown(false);
  }
  function stopGuide() { setGuide(null); setTarget("none"); setChatShown(true); }
  const stepCount = guide?.reply.steps.length ?? 0;
  function nextStep() {
    setGuide((g) => (g ? { ...g, i: g.i + 1 } : g));
  }
  useEffect(() => { if (guide && guide.i >= stepCount) stopGuide(); }, [guide, stepCount]);
  function backStep() { setGuide((g) => (g && g.i > 0 ? { ...g, i: g.i - 1 } : g)); }

  function closePanel() {
    if (narrow && guide) { setChatShown(false); return; }
    setGuide(null);
    setOpen(false);
  }

  function toggleEnabled() {
    setEnabled((v) => {
      const next = !v;
      try { localStorage.setItem(ENABLED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      if (!next) { setOpen(false); setGuide(null); }
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
        setGuides(Array.isArray(j?.guides) ? j.guides : []);
        setCanAnalyse(j?.analysis === true);
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

  // Yes / No on a web-search proposal. Yes sends the same question again, with the chip's signed token for that one
  // search; No sends nothing.
  function answerConsent(index: number, choice: WebChoice) {
    const m = messages[index];
    if (!m?.consent || m.consent.state !== "pending" || busy) return;
    const out = applyChoice(choice);
    setMessages((prev) => prev.map((x, k) => (k === index && x.consent ? { ...x, consent: { ...x.consent, state: out.state } } : x)));
    const base = messages.slice(0, index);
    const asked = base[base.length - 1];
    if (out.allow && asked?.from === "me") void ask(asked.text, undefined, { base, allow: out.allow, query: m.consent.query, token: m.consent.token });
  }

  async function ask(question: string, guideTask?: string, resume?: { base: Msg[]; allow: WebAllow; query: string; token: string }, analyse?: AnalyseRequest) {
    const text = question.trim();
    if (!text || busy) return;
    // History travels with the question so follow-ups keep their context --
    // text only; the server treats it as conversation, never as a query. An analysis goes as its sentence plus a compact
    // digest of the card, flagged like any web answer so the tools that act stay off for the follow-up window.
    const history = (resume ? resume.base : [...messages, { from: "me" as const, text }])
      .slice(-12)
      .map((m) => ({
        role: m.from === "me" ? "user" : "assistant",
        text: m.analysis ? `${m.text}\n${m.analysis.digest}` : m.text,
        ...(m.from === "bot" && (m.web || m.analysis?.webDerived) ? { web: true } : {}),
      }));
    if (!resume) setMessages((prev) => [...prev.map((m) => (m.consent ? { ...m, consent: { ...m.consent, state: settleOnNewAsk(m.consent.state) } } : m)), { from: "me", text }]);
    setDraft("");
    setBusy(true);
    setSearching(!!resume);
    try {
      // The page goes as ids only: the route, and the object type and record id read from it. Never record content.
      const page = parsePageContext(pathname);
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text, history, route: pathname,
          objectType: page?.objectType ?? null, recordId: page?.recordId ?? null,
          allow_web: resume?.allow,
          consent_query: resume?.query,
          consent_token: resume?.token,
          guideTask: guideTask ?? undefined,
          analyse,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        if (json.usage) setUsage(json.usage);
        const cards: Card[] | undefined = Array.isArray(json.cards) ? json.cards : undefined;
        const kind = json.consent?.kind === "web_search" || json.consent?.kind === "analyse_company" ? (json.consent.kind as "web_search" | "analyse_company") : null;
        const consent = kind && typeof json.consent.query === "string" && typeof json.consent.token === "string"
          ? { kind, query: json.consent.query as string, subject: typeof json.consent.subject === "string" ? (json.consent.subject as string) : undefined, state: "pending" as const, token: json.consent.token as string } : undefined;
        const analysis: DockAnalysis | undefined = json.analysis?.card && typeof json.analysis.digest === "string" ? json.analysis : undefined;
        const web: WebSource[] | undefined = Array.isArray(json.web?.sources) && json.web.sources.length ? json.web.sources : undefined;
        const reply: GuideReply | undefined = json.guide && Array.isArray(json.guide.steps) ? json.guide : undefined;
        setMessages((prev) => [...prev, { from: "bot", text: json.answer, report: json.report as ReportPayload | undefined, cards, guide: reply, consent, web, analysis, confirm: json.card as ConfirmCard | undefined }]);
        if (reply) startGuide(reply);
        if (json.autoFollow && cards?.length === 1) go(cards[0].href);
      } else {
        setMessages((prev) => [...prev, { from: "bot", text: json.error ?? "Something went wrong." }]);
      }
    } catch {
      setMessages((prev) => [...prev, { from: "bot", text: "Could not reach the server." }]);
    } finally {
      setBusy(false);
      setSearching(false);
    }
  }

  function sendMessage() { ask(draft); }

  // Refresh and Analyse are requests of their own: the server answers with the Yes / No chip (or the saved card) and no model runs.
  function refreshAnalysis(a: DockAnalysis) {
    const s = a.subject;
    void ask(`Refresh the analysis of ${s.name}`, undefined, undefined, s.accountId
      ? { account_id: s.accountId, refresh: true }
      : { name: s.name, domain: s.domain ?? undefined, country: s.country ?? undefined, refresh: true });
  }
  const here = parsePageContext(pathname);
  const analyseHere = canAnalyse && here?.objectType === "account" && here.recordId && context ? { id: here.recordId, name: context } : null;

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

      {enabled && guide && (
        <GuideOverlay step={guide.reply.steps[guide.i] ?? null} onAdvance={nextStep} onStop={stopGuide} onState={setTarget} />
      )}

      {enabled && open && narrow && guide && !chatShown && guide.i < stepCount && (
        <div className="bms-guide-bar" role="region" aria-label="Guide" style={{
          position: "fixed", left: 0, right: 0, bottom: liftForTabBar ? "calc(58px + env(safe-area-inset-bottom, 0px))" : 0, zIndex: 300,
          background: "var(--card-bg, #fff)", borderTop: "1px solid var(--line)", boxShadow: "0 -8px 24px rgba(10,15,25,.2)",
          padding: `10px 12px calc(10px + ${liftForTabBar ? "0px" : "env(safe-area-inset-bottom, 0px)"})`, display: "flex", flexDirection: "column", gap: 8,
        }}>
          <button className="bms-dock-row" onClick={() => setChatShown(true)} style={{ textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", color: c.ink }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>Step {guide.i + 1} of {stepCount}</div>
            <div style={{ fontSize: 13, lineHeight: 1.35, marginTop: 2 }}><InlineMarkdown text={guide.reply.steps[guide.i].text} /></div>
            {guide.reply.steps[guide.i].hidden && <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>{plainText(guide.reply.steps[guide.i].hidden!.reason)}</div>}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="bms-dock-chip" onClick={stopGuide} style={guideBtn(false)}>Stop</button>
            <span style={{ flex: 1 }} />
            <button className="bms-dock-chip" onClick={backStep} disabled={guide.i === 0} style={guideBtn(false)}>Back</button>
            <button className="bms-dock-chip" onClick={nextStep} style={guideBtn(true)}>{guide.i >= stepCount - 1 ? "Done" : "Next"}</button>
          </div>
        </div>
      )}

      {enabled && open && !(narrow && guide && !chatShown) && (
        // Size, position and the phone sheet live in dockLayout.ts (a stylesheet, so a media query can override them);
        // only the lift under the panel (safe area, tab bar) is known here.
        <div className="bms-dock-panel" style={{ ["--dock-floor" as string]: FLOOR }}>
          <div style={{ padding: "10px 12px 10px 16px", background: "var(--accentbg)", color: c.accent, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span>✦ Assistant</span>
            <InfoTip label="the assistant">{ASSISTANT_TIPS.header}</InfoTip>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {pill}
              <button
                className="bms-dock-close"
                onClick={closePanel}
                aria-label="Close assistant"
                style={{ background: "transparent", border: "none", color: c.muted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}
              >
                ×
              </button>
            </span>
          </div>

          {context && (
            <div style={{ padding: "8px 16px", borderBottom: `1px solid ${c.line}`, fontSize: 12, color: c.ink, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>On {plainText(context)}</span>
            </div>
          )}

          {(suggestions.length > 0 || analyseHere) && (
            <div className="bms-dock-suggest" style={{ padding: "8px 16px", borderBottom: `1px solid ${c.line}`, display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
              {analyseHere && (
                <span className="bms-dock-chip-wrap" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                  <button
                    className="bms-dock-chip"
                    onClick={() => ask(`Analyse ${plainText(analyseHere.name)}`, undefined, undefined, { account_id: analyseHere.id })}
                    disabled={busy}
                    style={{
                      background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999,
                      padding: "6px 12px", fontSize: 11.5, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Analyse company
                  </button>
                </span>
              )}
              {suggestions.map((s) => (
                <span key={s.id} className="bms-dock-chip-wrap" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
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
                </span>
              ))}
            </div>
          )}

          <div ref={scrollRef} style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5, flex: 1, overflowY: "auto", minHeight: 0 }}>
            {messages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                <BriefingCard />
                {createChips.length > 0 && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 4 }}>
                      Draft from a paste
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
                {guides.length > 0 && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 4 }}>
                      Show me how
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {guides.map((g) => (
                        <button
                          key={g.id}
                          className="bms-dock-chip"
                          onClick={() => ask(`Show me how: ${g.label}`, g.id)}
                          disabled={busy}
                          style={{
                            background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999,
                            padding: "6px 12px", fontSize: 11.5, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          {g.label}
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
                    overflowWrap: "anywhere",
                  }}
                >
                  {/* The assistant's text is markdown (lists, bold); what the person typed is shown as typed. */}
                  {m.from === "bot" ? <Markdown text={m.text} links={!m.web} /> : <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>}
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
                {m.confirm && <ConfirmCardView card={m.confirm} onOpen={go} onAsk={ask} />}
                {m.analysis && (
                  <AnalysisCardView data={m.analysis} busy={busy} onOpen={go} onRefresh={() => refreshAnalysis(m.analysis!)} onAsk={(q) => ask(q)} />
                )}
                {m.consent?.kind === "analyse_company" && (
                  <AnalysisConsentRow subject={m.consent.subject ?? "this company"} state={m.consent.state} disabled={busy} onChoice={(choice) => answerConsent(i, choice)} />
                )}
                {m.consent?.kind === "web_search" && <WebConsentRow query={m.consent.query} state={m.consent.state} disabled={busy} onChoice={(choice) => answerConsent(i, choice)} />}
                {m.web && <WebSources sources={m.web} />}
                {m.guide && (
                  <GuideCard
                    reply={m.guide}
                    active={guide?.reply === m.guide}
                    index={guide?.reply === m.guide ? guide.i : 0}
                    target={target}
                    onStart={() => startGuide(m.guide!)}
                    onBack={backStep}
                    onNext={nextStep}
                    onStop={stopGuide}
                  />
                )}
                {m.report && (
                  <div style={{ padding: 12, borderRadius: "var(--card-radius, 10px)", border: `1px solid ${c.line}`, background: "var(--card-bg, #fff)" }}>
                    <ChartRenderer report={normalizeReport(m.report)} />
                  </div>
                )}
              </div>
            ))}
            {busy && <div style={{ alignSelf: "flex-start", color: c.hint }}>{searching ? "Searching the web…" : "Looking that up…"}</div>}
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
        .bms-guide-hl {
          outline: 3px solid var(--tenant-accent, #1e3a6e); outline-offset: 3px; border-radius: 6px;
          box-shadow: 0 0 0 8px color-mix(in srgb, var(--tenant-accent, #1e3a6e) 22%, transparent);
          animation: bms-guide-pulse 1.6s ease-in-out infinite;
        }
        @keyframes bms-guide-pulse { 50% { box-shadow: 0 0 0 12px color-mix(in srgb, var(--tenant-accent, #1e3a6e) 10%, transparent); } }
        @media (prefers-reduced-motion: reduce) { .bms-guide-hl { animation: none; } }
        @keyframes vvcrm-pulse-ring {
          0% { transform: scale(.92); opacity: .5; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        ${DOCK_PANEL_CSS}
      `}</style>
    </>
  );
}

const guideBtn = (primary: boolean): React.CSSProperties => ({
  background: primary ? "var(--tenant-accent, #1e3a6e)" : "var(--panel2)", color: primary ? "#fff" : c.ink,
  border: "1px solid var(--line)", borderRadius: "var(--card-radius, 10px)", padding: "8px 16px", fontSize: 12.5, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit", minHeight: 44, minWidth: 44,
});

/**
 * The numbered steps of a guide. The current step is marked, a step this person cannot take stays in the list greyed
 * with its reason (a blocker is never hidden behind the "i"), and Next also moves by itself when the highlighted
 * control is pressed. Nothing here presses a control of the page.
 */
function GuideCard({ reply, active, index, target, onStart, onBack, onNext, onStop }: {
  reply: GuideReply; active: boolean; index: number; target: GuideTargetState;
  onStart: () => void; onBack: () => void; onNext: () => void; onStop: () => void;
}) {
  const last = reply.steps.length - 1;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--card-radius, 10px)", background: "var(--card-bg, #fff)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: c.accent }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Guide · {plainText(reply.task)}</span>
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {reply.steps.map((st, n) => {
          const done = active && n < index;
          const current = active && n === index;
          return (
            <li key={n} aria-current={current ? "step" : undefined} style={{ display: "flex", gap: 8, opacity: st.hidden ? 0.6 : 1 }}>
              <span aria-hidden="true" style={{ width: 16, flexShrink: 0, color: current ? c.accent : c.hint, fontWeight: 700 }}>{done ? "✓" : current ? "●" : "○"}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.4, fontWeight: current ? 650 : 400, color: c.ink }}>
                <InlineMarkdown text={st.text} />
                {st.hidden && <span style={{ display: "block", fontSize: 11.5, color: c.hint }}>Not available: {plainText(st.hidden.reason)}.{st.hidden.alternative ? ` ${plainText(st.hidden.alternative)}` : ""}</span>}
                {current && !st.hidden && st.control && target === "missing" && <span style={{ display: "block", fontSize: 11.5, color: c.hint }}>Not on the screen right now.</span>}
                {current && !st.hidden && st.control && target === "parent" && <span style={{ display: "block", fontSize: 11.5, color: c.hint }}>Open this first; the step then shows.</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {active ? (
          <>
            <button className="bms-dock-chip" onClick={onStop} style={{ ...guideBtn(false), marginRight: "auto" }}>Stop guide</button>
            <button className="bms-dock-chip" onClick={onBack} disabled={index === 0} style={guideBtn(false)}>Back</button>
            <button className="bms-dock-chip" onClick={onNext} style={guideBtn(true)}>{index >= last ? "Done" : "Next"}</button>
          </>
        ) : (
          <button className="bms-dock-chip" onClick={onStart} style={guideBtn(true)}>Show me</button>
        )}
      </div>
    </div>
  );
}
