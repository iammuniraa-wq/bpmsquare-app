"use client";

import { useEffect, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { formatMoney, latest } from "@/lib/analysis/report/figures";
import type { BriefHistory } from "@/lib/analysis/report/history";
import { LEGACY_NOTICE, LEGACY_SECTIONS, LEGACY_SECTION_LABEL, legacySectionCount, type LegacyReport, type LegacySectionId } from "@/lib/analysis/report/legacy";
import { REPORT_TIPS } from "@/lib/analysis/report/tips";
import {
  blockCount, FAIL_REASON_TEXT, MAX_REPORT_SEARCHES, REPORT_BLOCK_LABEL, REPORT_PARTS, REPORT_PART_LABEL, REPORT_PART_MISSING_TEXT, ROLE_FUNCTION_LABEL, SIGNAL_KIND_LABEL, WATCHOUT_KIND_LABEL,
  type CompanyReport, type ReportBlockId, type ReportItem, type ReportPartId,
} from "@/lib/analysis/report/types";
import { REPORT_CHIP_TEXT, REPORT_RETRY_CHIP_TEXT, type DockReport, type ReportSaveTarget } from "@/lib/assistant/reportTool";
import type { ConsentState, WebChoice } from "@/lib/assistant/webConsent";
import { refreshedText } from "./AnalysisCardView";
import { BRIEF_CSS } from "./briefCss";
import { fitFrom, historyPieces, missingForBlock, shortDate, tilesOf } from "./briefModel";

// The company brief as the dock and the account's Company brief tab draw it (docs/design/company-brief-sales.md, mock-up
// company-brief-mockup.html): a header, a band of six tiles, "Your history" (read live, never part of the brief), then blocks in
// the order a seller needs them. Every string arrives as a field and is drawn as a React text node, so a word from the web can
// never become markup, and the only links are https addresses the validator already checked (checked again here). Pure view: it
// decides nothing, and it adapts to its own width (container queries), so one component serves a phone and a PC.

export { shortDate };

const isHttps = (u: string): boolean => { try { return new URL(u).protocol === "https:"; } catch { return false; } };

function Ref({ report, n }: { report: { sources: { n: number; title: string; url: string }[] }; n: number }) {
  const s = report.sources.find((x) => x.n === n);
  if (!s || !isHttps(s.url)) return null;
  return <a className="ref" href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`Source ${n}: ${s.title}`}>[{n}]</a>;
}

const Inferred = ({ label = "Assistant's reading" }: { label?: string }) => <span className="infer">{label}</span>;

// ── Collapsible blocks. Open state is a per-person convenience kept in this browser only; the card renders without it. ───────────

const OPEN_KEY = "bms_brief_open_v1";
const DEFAULT_OPEN: readonly ReportBlockId[] = ["why_now", "who"];

function useOpenBlocks(initial: readonly ReportBlockId[] | undefined): [Set<ReportBlockId>, (id: ReportBlockId) => void] {
  const [open, setOpen] = useState<Set<ReportBlockId>>(() => new Set(initial ?? DEFAULT_OPEN));
  useEffect(() => {
    if (initial) return;
    try {
      const raw = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
      if (Array.isArray(raw)) setOpen(new Set(raw.filter((x): x is ReportBlockId => typeof x === "string")));
    } catch { /* a default layout is the fallback */ }
  }, [initial]);
  const toggle = (id: ReportBlockId) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (!initial) try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* storage blocked: the choice lasts for this visit */ }
    return next;
  });
  return [open, toggle];
}

function Block({ id, title, count, tip, tipLabel, isOpen, onToggle, children }: {
  id: ReportBlockId; title: string; count?: string | number; tip?: string; tipLabel?: string; isOpen: boolean; onToggle: (id: ReportBlockId) => void; children: React.ReactNode;
}) {
  const panel = `brief-${id}`;
  return (
    <div className="blk" data-guide={`brief.block.${id}`}>
      <div className="bhrow">
        <button type="button" className="bhead" aria-expanded={isOpen} aria-controls={panel} onClick={() => onToggle(id)}>
          <span className="chev" aria-hidden="true" />
          <span>{title}</span>
          {count !== undefined && <span className="cnt">{count}</span>}
        </button>
        {tip && <span className="tipw"><InfoTip label={tipLabel ?? title.toLowerCase()}>{tip}</InfoTip></span>}
      </div>
      {isOpen && <div id={panel} className="bbody">{children}</div>}
    </div>
  );
}

const SHOW_FIRST = 5;

/** A list that shows a few rows and a "Show all" for the rest. */
function Rows<T>({ rows, render }: { rows: T[]; render: (row: T, i: number) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOW_FIRST);
  return (
    <>
      {shown.map((r, i) => render(r, i))}
      {rows.length > SHOW_FIRST && !all && <li style={{ listStyle: "none" }}><button type="button" className="chipb more" onClick={() => setAll(true)}>{`Show all ${rows.length}`}</button></li>}
    </>
  );
}

function MissingNote({ report, id }: { report: CompanyReport; id: ReportBlockId | "money" }) {
  const parts = missingForBlock(report, id);
  if (parts.length === 0) return null;
  return <div className="note" role="status">{parts.map((p) => <span key={p}>{REPORT_PART_MISSING_TEXT[p]}<WhyMissing r={report} part={p} />{" "}</span>)}</div>;
}

/** The short plain reason a part failed, behind an "i": from a fixed list of codes, never the provider's own error text. */
function WhyMissing({ r, part }: { r: CompanyReport; part: ReportPartId }) {
  const why = r.reasons?.[part];
  return why ? <InfoTip label={`why ${REPORT_PART_LABEL[part].toLowerCase()} failed`}>{FAIL_REASON_TEXT[why]}</InfoTip> : null;
}

// ── The blocks ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function Tiles({ r }: { r: CompanyReport }) {
  return (
    <>
      <div className="tiles" data-guide="brief.tiles">
        {tilesOf(r).map((t) => (
          <div className="tile" key={t.key}>
            <div className="tl">{t.label}</div>
            <div className={`tv${t.nopub ? " nopub" : ""}${t.tone ? ` ${t.tone}` : ""}${t.check ? " unv" : ""}`}>{t.value}</div>
            <div className="ts">
              {t.sub}{t.sub && t.src ? " " : ""}{t.src && !t.check ? <Ref report={r} n={t.src} /> : null}
              {t.check && t.src ? <span className="chk">{`${t.sub ? " · " : ""}not confirmed on the page, check `}<Ref report={r} n={t.src} /></span> : null}
            </div>
            {t.prior && (
              <div className="ts">
                {t.prior.text}{" "}
                {t.prior.check ? <span className="chk">{"not confirmed, check "}<Ref report={r} n={t.prior.src} /></span> : <Ref report={r} n={t.prior.src} />}
              </div>
            )}
            {t.calc && (
              <div className="ts" data-guide="brief.calculated">
                {t.calc.text ? `${t.calc.text}, calculated from ` : "Calculated from "}
                {t.calc.from.map((n, i) => <span key={n}>{i > 0 ? " and " : ""}<Ref report={r} n={n} /></span>)}
                {t.calc.unconfirmed ? <span className="chk">{" · a figure behind it is not confirmed"}</span> : null}
              </div>
            )}
          </div>
        ))}
      </div>
      {r.money.status !== "published" && r.money.proxies.length > 0 && (
        <div className="proxy" data-guide="brief.proxies">
          <b>What we found instead</b> <span className="m">as proxies, not as turnover</span> <InfoTip label="what we found instead">{REPORT_TIPS.notPublished}</InfoTip>
          <ul className="lst">{r.money.proxies.map((p, i) => <li key={i}>{p.text} <Ref report={r} n={p.src} /></li>)}</ul>
        </div>
      )}
    </>
  );
}

function HistoryStrip({ r, history, onOpen }: { r: CompanyReport; history: BriefHistory; onOpen?: (href: string) => void }) {
  const { pieces, gap } = historyPieces(history, r.roles.map((x) => x.fn));
  return (
    <div className="hist" data-guide="brief.history">
      <div className="hh">Your history with them <InfoTip label="your history">{REPORT_TIPS.history}</InfoTip></div>
      {!history.inCrm ? (
        <div className="hrow">
          <span>Not in your CRM.</span>
          {history.similar.map((s) => (
            <a key={s.id} className="lnk" href={s.href} onClick={(e) => { if (onOpen) { e.preventDefault(); onOpen(s.href); } }}>{`Similar: ${s.name}`}</a>
          ))}
        </div>
      ) : (
        <>
          <div className="hrow">
            {pieces.map((p, i) => (
              <span key={i}>{p.n !== undefined ? <b>{p.n}</b> : null}{p.n !== undefined ? " " : ""}{p.text}</span>
            ))}
            {pieces.length === 0 && <span className="m">Nothing recorded yet.</span>}
          </div>
          {gap && <div className="hgap">{gap}</div>}
        </>
      )}
    </div>
  );
}

function WhyNow({ r }: { r: CompanyReport }) {
  if (r.signals.length === 0) {
    return missingForBlock(r, "why_now").length > 0 && r.missing.includes("signals")
      ? <MissingNote report={r} id="why_now" />
      : <><div className="m">No dated events found in the last 12 months.</div><MissingNote report={r} id="why_now" /></>;
  }
  return (
    <>
      <ul className="why">
        <Rows rows={r.signals} render={(s, i) => (
          <li key={i} className={s.old ? "old" : undefined}>
            <span className="dchip">{shortDate(s.on)}</span>
            <div>
              <div className="wt">{s.text} <Ref report={r} n={s.src} />{s.old && <span className="olds">{" older"}</span>}{" "}<span className="m">{SIGNAL_KIND_LABEL[s.kind]}</span></div>
              {s.why && <div className="sw"><b>Why it matters:</b> {s.why}</div>}
            </div>
          </li>
        )} />
      </ul>
      <MissingNote report={r} id="why_now" />
    </>
  );
}

function Who({ r, history }: { r: CompanyReport; history: BriefHistory | null }) {
  const showCrm = !!history && history.inCrm && history.contactCount !== null;
  return (
    <>
      {r.roles.length === 0 ? <div className="m">No buying functions found.</div> : (
        <div className="tbl">
          <div className={`tr th${showCrm ? "" : " three"}`}>
            <div>Function</div><div>Talk about <Inferred label="our reading" /></div><div>Published by the company</div>{showCrm && <div>In your CRM</div>}
          </div>
          {r.roles.map((row) => {
            const held = history?.byFunction[row.fn];
            return (
              <div className={`tr${showCrm ? "" : " three"}`} key={row.fn} data-guide={`brief.role.${row.fn}`}>
                <div className="fn" data-l="Function">{ROLE_FUNCTION_LABEL[row.fn]}</div>
                <div className="inf" data-l="Talk about">{row.talkAbout || <span className="m">No reading</span>}</div>
                <div data-l="Published by the company">
                  {row.named.length === 0 ? <span className="m">No name published</span> : row.named.map((p, i) => (
                    <div key={i}><b>{p.name}</b><br /><span className="m">{p.title} <Ref report={r} n={p.src} /></span></div>
                  ))}
                </div>
                {showCrm && <div data-l="In your CRM" className={held ? undefined : "gap"}>{held ? `${held.first.name}${held.first.title ? `, ${held.first.title}` : ""}${held.count > 1 ? ` and ${held.count - 1} more` : ""}` : "No contact yet"}</div>}
              </div>
            );
          })}
        </div>
      )}
      <div className="note">Names and titles exactly as the company publishes them. No contact details are collected.</div>
      <MissingNote report={r} id="who" />
    </>
  );
}

function Fit({ r }: { r: CompanyReport }) {
  if (!r.fit) return null;
  return (
    <div className="fit" data-guide="brief.fit">
      <div className="fh"><b>{REPORT_BLOCK_LABEL.fit}</b><Inferred label="Assistant's reading, not from a page" /><InfoTip label="where we fit">{REPORT_TIPS.fit}</InfoTip></div>
      {r.fit.angle && <div><b>Opening angle.</b> {r.fit.angle}</div>}
      <div className="pairs">
        {r.fit.priorities.map((p, i) => (
          <div className="pair" key={i}>
            <div className="from">{`From: ${fitFrom(r, p.basedOn)}`}</div>
            <div>{p.why} <span className="m">matches your offering</span> <b>{p.offering}</b></div>
          </div>
        ))}
      </div>
      {r.fit.questions.length > 0 && (
        <>
          <div className="qh">Questions to ask</div>
          <ol className="qs">{r.fit.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
        </>
      )}
    </div>
  );
}

function Compete({ r }: { r: CompanyReport }) {
  if (r.compete.length === 0) return null;
  return (
    <div className="fit" data-guide="brief.compete">
      <div className="fh"><b>How they compete with us</b><Inferred label="Assistant's reading, not from a page" /><InfoTip label="how they compete with us">{REPORT_TIPS.inference}</InfoTip></div>
      <ul className="lst" style={{ marginTop: 0 }}>{r.compete.map((x, i) => <li key={i}><b>{x.offering}</b>{`: ${x.text}`}</li>)}</ul>
    </div>
  );
}

function ItemList({ r, rows, prefix, cls }: { r: CompanyReport; rows: ReportItem[]; prefix?: string; cls?: string }) {
  return <>{rows.map((i, k) => <li key={k} className={cls}>{prefix ? <b>{prefix}</b> : null}{prefix ? " " : ""}{i.text}{i.on ? <span className="m">{` · ${shortDate(i.on)}`}</span> : null} <Ref report={r} n={i.src} /></li>)}</>;
}

function Performance({ r }: { r: CompanyReport }) {
  const years = [...r.money.revenue].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const top = Math.max(0, ...years.map((y) => y.amount));
  const cur = latest(r.money.revenue)?.currency;
  const profits = [...r.money.profit].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const unit = top >= 1e9 ? { div: 1e9, word: "billion" } : top >= 1e6 ? { div: 1e6, word: "million" } : { div: 1, word: "" };
  const p = r.performance;
  return (
    <>
      {years.length > 0 && (
        <div className="bars">
          <div className="barset" role="img" aria-label={`Revenue by year${cur ? `, ${cur}${unit.word ? ` ${unit.word}` : ""}` : ""}: ${years.map((y) => `FY${y.fiscalYear} ${String(Math.round((y.amount / unit.div) * 100) / 100)}`).join(", ")}`}>
            {years.map((y) => (
              <div className="bar" key={`${y.fiscalYear}${y.currency}`}>
                <div className="col" style={{ ["--h" as string]: `${Math.max(20, Math.round((y.amount / top) * 100))}%` }}><span>{String(Math.round((y.amount / unit.div) * 100) / 100)}</span></div>
                <div className="bl">{`FY${y.fiscalYear}`}</div>
              </div>
            ))}
          </div>
          <div className="barn">
            {`Revenue, ${cur ?? ""}${unit.word ? ` ${unit.word}` : ""}. `}{years.some((y) => !y.matched) && <span className="chk">Some figures: check the source. </span>}
            {profits.length > 0 && `Net profit: ${profits.map((x) => formatMoney(x.amount, x.currency).replace(`${x.currency} `, "")).join(", ")}.`}
            {" "}{latest(r.money.revenue) ? (latest(r.money.revenue)!.matched ? <Ref report={r} n={latest(r.money.revenue)!.src} /> : <span className="chk">{"check "}<Ref report={r} n={latest(r.money.revenue)!.src} /></span>) : null}
          </div>
        </div>
      )}
      <ul className="lst">
        <ItemList r={r} rows={p.market} />
        <ItemList r={r} rows={p.highlights} />
        <ItemList r={r} rows={p.tailwinds} prefix="Tailwind." cls="tw" />
        <ItemList r={r} rows={p.headwinds} prefix="Headwind." cls="hw" />
      </ul>
      <MissingNote report={r} id="performance" />
    </>
  );
}

function Watchouts({ r }: { r: CompanyReport }) {
  return (
    <>
      {r.watchouts.length > 0 && (
        <ul className="lst" style={{ marginTop: 0 }}>
          {r.watchouts.map((w, i) => <li key={i}><span className="dchip s">{shortDate(w.on)}</span><span className="m">{`${WATCHOUT_KIND_LABEL[w.kind]}. `}</span>{w.text} <Ref report={r} n={w.src} /></li>)}
        </ul>
      )}
      {!r.missing.includes("market") && (
        <div className="note">
          {r.watchouts.length === 0 ? "None found in the searches run."
            : r.watchouts.some((w) => w.kind === "payment" || w.kind === "negative_news") ? null : "Payment risk and negative news: none found in the searches run."}
        </div>
      )}
      <MissingNote report={r} id="watchouts" />
    </>
  );
}

function Market({ r }: { r: CompanyReport }) {
  return (
    <>
      {r.market.facts.length > 0 && <ul className="lst" style={{ marginTop: 0 }}><ItemList r={r} rows={r.market.facts} /></ul>}
      {r.market.competitors.length > 0 && (
        <div className="comp">{r.market.competitors.map((x, i) => <div key={i}><b>{x.name}</b><span className="m">{` ${x.how} `}<Ref report={r} n={x.src} /></span></div>)}</div>
      )}
    </>
  );
}

function Profile({ r }: { r: CompanyReport }) {
  const p = r.profile;
  return (
    <ul className="lst" style={{ marginTop: 0 }}>
      <ItemList r={r} rows={p.what} />
      <ItemList r={r} rows={p.clients} prefix="Client." />
      <ItemList r={r} rows={p.projects} prefix="Project." />
    </ul>
  );
}

function Sources({ r }: { r: CompanyReport }) {
  return (
    <>
      <ol className="srcs" data-guide="report.sources">
        {r.sources.filter((s) => isHttps(s.url)).map((s) => (
          <li key={s.n}><span className="m">{`[${s.n}] `}</span><a className="lnk" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>{s.publisher ? <span className="m">{` · ${s.publisher}`}</span> : null}</li>
        ))}
      </ol>
      {r.leftOut > 0 && <div className="note">{`${r.leftOut} ${r.leftOut === 1 ? "statement was" : "statements were"} left out because no page backed ${r.leftOut === 1 ? "it" : "them"}.`}</div>}
    </>
  );
}

// ── Save for a company that is not in the CRM ──────────────────────────────────────────────────────────────────────────────

export type AccountHit = { id: string; name: string; place?: string | null };

/** "Save to an account": similar names first, a search, or create the account with the typed name, website and country filled in. */
function SaveToAccount({ data, history, busy, onSave, search, onOpen }: {
  data: DockReport;
  history: BriefHistory | null;
  busy: boolean;
  onSave: (t: ReportSaveTarget) => Promise<{ ok: boolean; message: string }>;
  search: (q: string) => Promise<AccountHit[]>;
  onOpen?: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AccountHit[]>([]);
  const [state, setState] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    let alive = true;
    const t = setTimeout(() => { search(q.trim()).then((r) => { if (alive) setHits(r); }).catch(() => { if (alive) setHits([]); }); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, search]);

  const similar: AccountHit[] = (history?.similar ?? []).map((s) => ({ id: s.id, name: s.name }));
  const list = [...similar, ...hits.filter((h) => !similar.some((s) => s.id === h.id))];
  const s = data.subject;
  const params = new URLSearchParams();
  if (s.name) params.set("name", s.name);
  if (s.domain) params.set("website", s.domain);
  if (s.country) params.set("country", s.country);
  const createHref = `/accounts/new?${params.toString()}`;

  async function pick(a: AccountHit) {
    setState({ state: "saving" });
    const r = await onSave({ kind: "account", id: a.id, label: "account" }).catch(() => ({ ok: false, message: "Could not save just now." }));
    setState({ state: r.ok ? "saved" : "error", message: r.message });
  }

  return (
    <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 6 }} data-guide="brief.unmatched">
      <div className="m">{`${data.report.name} is not an account here.`}</div>
      {state.state === "saved" ? <div role="status" style={{ color: statusInk.good }}>{state.message}</div> : (
        <div><button type="button" className="chipb" disabled={busy} aria-expanded={open} onClick={() => setOpen((v) => !v)}>Save to an account</button></div>
      )}
      {open && state.state !== "saved" && (
        <div className="pick">
          <b>Choose an account</b> <span className="m">similar names first</span>
          <input className="finp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your accounts" aria-label="Search your accounts" />
          {list.length === 0 && q.trim().length >= 2 && <div className="m">No account matches.</div>}
          {list.map((a) => (
            <div className="pi" key={a.id}>
              <span>{a.name}{a.place ? <span className="m">{` · ${a.place}`}</span> : null}</span>
              <button type="button" className="chipb" disabled={busy || state.state === "saving"} onClick={() => void pick(a)}>{state.state === "saving" ? "Saving…" : "Save here"}</button>
            </div>
          ))}
          {data.unmatched?.canCreate && (
            <div>
              <b>Create the account</b> <span className="m">name, website and country are filled in</span>{" "}
              <a className="lnk" href={createHref} onClick={(e) => { if (onOpen) { e.preventDefault(); onOpen(createHref); } }}>Open the new account form</a>
            </div>
          )}
          {state.state === "error" && state.message && <div className="err" role="alert">{state.message}</div>}
        </div>
      )}
    </div>
  );
}

// ── The card ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const SAVE_WORD: Record<ReportSaveTarget["kind"], string> = { account: "account", lead: "lead", deal: "deal", competitor: "competitor" };

export type SaveState = { state: "idle" | "saving" | "saved" | "error"; message?: string };

async function defaultSearch(q: string): Promise<AccountHit[]> {
  const res = await fetch(`/api/ai/report/accounts?q=${encodeURIComponent(q)}`);
  const json = await res.json().catch(() => ({}));
  return res.ok && Array.isArray(json.accounts) ? (json.accounts as { id: string; name: string; place?: string | null }[]).map((a) => ({ id: a.id, name: a.name, place: a.place ?? null })) : [];
}

export default function ReportCardView({ data, busy = false, now = new Date(), history = null, open: openProp, onRefresh, onRetry, onSave, onOpen, search = defaultSearch }: {
  data: DockReport;
  busy?: boolean;
  now?: Date;
  /** The person's own history with this company, read live. Never part of `data`; absent while loading or when not allowed. */
  history?: BriefHistory | null;
  /** The blocks drawn open. Absent: Why now and Who to talk to, then whatever this person last opened or closed. */
  open?: readonly ReportBlockId[];
  onRefresh: () => void;
  /** "Try the missing parts". Absent: the button is not drawn. */
  onRetry?: () => void;
  /** Saves to one target and says how it went. The caller owns the request. */
  onSave: (target: ReportSaveTarget) => Promise<{ ok: boolean; message: string }>;
  onOpen?: (href: string) => void;
  search?: (q: string) => Promise<AccountHit[]>;
}) {
  const [open, toggle] = useOpenBlocks(openProp);
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const keyOf = (t: ReportSaveTarget) => `${t.kind}:${t.competitorId ?? t.id}`;

  async function save(t: ReportSaveTarget) {
    const k = keyOf(t);
    setSaves((p) => ({ ...p, [k]: { state: "saving" } }));
    const res = await onSave(t).catch(() => ({ ok: false, message: "Could not save just now." }));
    setSaves((p) => ({ ...p, [k]: { state: res.ok ? "saved" : "error", message: res.message } }));
  }

  if (data.report.v === 1) return <LegacyReportView data={data as DockReport & { report: LegacyReport }} busy={busy} now={now} onRefresh={onRefresh} />;
  const r: CompanyReport = data.report;
  const partsDone = REPORT_PARTS.length - r.missing.length;
  const competitor = r.lens === "competitor";
  const showFit = competitor ? r.compete.length > 0 : !!r.fit;
  const perfCount = blockCount(r, "performance");
  const showPerf = perfCount > 0 || missingForBlock(r, "performance").length > 0;
  const showWatch = r.watchouts.length > 0 || !r.missing.includes("market") || missingForBlock(r, "watchouts").length > 0;
  const showMarket = blockCount(r, "market") > 0;
  const showProfile = blockCount(r, "profile") > 0;

  return (
    <section className="bms-brief" aria-label={`Company brief: ${r.name}`} data-guide="report.card">
      <style>{BRIEF_CSS}</style>
      <div className="head">
        <div className="who">
          <div className="name">{r.name}</div>
          {r.oneLiner && <div className="one">{r.oneLiner.text} <Ref report={r} n={r.oneLiner.src} /></div>}
          <div className="made">
            <span>{data.cached ? "Saved" : "Made"} {refreshedText(data.computedAt || r.generatedAt, now)}</span>
            {r.searches > 0 && <span>{`· ${r.searches} ${r.searches === 1 ? "search" : "searches"}`}</span>}
            <span>{`· ${partsDone} of ${REPORT_PARTS.length} parts`}</span>
            <InfoTip label="this brief">{REPORT_TIPS.searches}</InfoTip>
          </div>
        </div>
        <div className="acts">
          <button type="button" className="chipb" disabled={busy} onClick={onRefresh} data-guide="report.refresh">Refresh</button>
          <InfoTip label="refreshing a brief">{REPORT_TIPS.refresh}</InfoTip>
          {data.saved && data.targets.length > 0 && (
            <span data-guide="report.save" style={{ display: "contents" }}>
              {data.targets.map((t) => {
                const s = saves[keyOf(t)] ?? { state: "idle" as const };
                return (
                  <span key={keyOf(t)} style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                    <button type="button" className="chipb" disabled={busy || s.state === "saving" || s.state === "saved"} onClick={() => void save(t)}>
                      {s.state === "saving" ? "Saving…" : s.state === "saved" ? `Saved to ${SAVE_WORD[t.kind]}` : `Save to ${SAVE_WORD[t.kind]}`}
                    </button>
                    {s.state === "error" && s.message && <span role="alert" className="err">{s.message}</span>}
                  </span>
                );
              })}
            </span>
          )}
        </div>
      </div>

      {data.notice && <div role="status" className="status">{data.notice}</div>}
      {!data.saved && <div role="status" className="status">Not saved: a database update is pending, so this brief is not kept and cannot be saved to a record.</div>}
      {r.missing.length > 0 && (
        <div className="miss" role="status" data-guide="brief.missing">
          <b>{r.missing.map((p) => <span key={p}>{REPORT_PART_MISSING_TEXT[p]}<WhyMissing r={r} part={p} />{" "}</span>)}</b>
          <span>The rest of the brief is below.</span>
          {onRetry && <button type="button" className="chipb" disabled={busy} onClick={onRetry} data-guide="brief.retry">Try the missing parts</button>}
        </div>
      )}

      <Tiles r={r} />
      {history && <HistoryStrip r={r} history={history} onOpen={onOpen} />}
      {data.unmatched && data.saved && <SaveToAccount data={data} history={history} busy={busy} onSave={onSave} search={search} onOpen={onOpen} />}

      {(
        <Block id="why_now" title={REPORT_BLOCK_LABEL.why_now} count={blockCount(r, "why_now")} tip={REPORT_TIPS.whyNow} isOpen={open.has("why_now")} onToggle={toggle}><WhyNow r={r} /></Block>
      )}
      {(
        <Block id="who" title={REPORT_BLOCK_LABEL.who} count={r.roles.length > 0 ? `${r.roles.length} ${r.roles.length === 1 ? "function" : "functions"}` : 0} tip={REPORT_TIPS.who} isOpen={open.has("who")} onToggle={toggle}><Who r={r} history={history} /></Block>
      )}
      {showFit && (competitor ? <Compete r={r} /> : <Fit r={r} />)}
      {showPerf && (
        <Block id="performance" title={REPORT_BLOCK_LABEL.performance} count={perfCount} tip={REPORT_TIPS.performance} isOpen={open.has("performance")} onToggle={toggle}><Performance r={r} /></Block>
      )}
      {showWatch && (
        <Block id="watchouts" title={REPORT_BLOCK_LABEL.watchouts} count={r.watchouts.length} tip={REPORT_TIPS.watchouts} isOpen={open.has("watchouts")} onToggle={toggle}><Watchouts r={r} /></Block>
      )}
      {showMarket && (
        <Block id="market" title={REPORT_BLOCK_LABEL.market} count={blockCount(r, "market")} tip={REPORT_TIPS.market} isOpen={open.has("market")} onToggle={toggle}><Market r={r} /></Block>
      )}
      {showProfile && (
        <Block id="profile" title={REPORT_BLOCK_LABEL.profile} count={blockCount(r, "profile")} tip={REPORT_TIPS.profile} isOpen={open.has("profile")} onToggle={toggle}><Profile r={r} /></Block>
      )}
      <Block id="sources" title={REPORT_BLOCK_LABEL.sources} count={r.sources.length} tip={REPORT_TIPS.sources} isOpen={open.has("sources")} onToggle={toggle}><Sources r={r} /></Block>
    </section>
  );
}

// ── A report saved before the brief ─────────────────────────────────────────────────────────────────────────────────────────

const legacyBody: React.CSSProperties = { padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 6 };
const legacyList: React.CSSProperties = { margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 5 };

/** A version 1 report, drawn as it was: its sections, its numbered sources, and one line saying the format is older. */
function LegacyReportView({ data, busy, now, onRefresh }: { data: DockReport & { report: LegacyReport }; busy: boolean; now: Date; onRefresh: () => void }) {
  const r = data.report;
  const [open, setOpen] = useState<Set<LegacySectionId>>(() => new Set<LegacySectionId>(["overview"]));
  const toggle = (id: LegacySectionId) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const shown = LEGACY_SECTIONS.filter((id) => legacySectionCount(r, id) > 0);
  return (
    <section className="bms-brief" aria-label={`Company report: ${r.name}`} data-guide="report.card">
      <style>{BRIEF_CSS}</style>
      <div className="head">
        <div className="who">
          <div className="name">{r.name}</div>
          {r.summary && <div className="one">{r.summary}</div>}
          <div className="made"><span>Saved {refreshedText(data.computedAt || r.generatedAt, now)}</span></div>
        </div>
        <div className="acts">
          <button type="button" className="chipb" disabled={busy} onClick={onRefresh} data-guide="report.refresh">Refresh</button>
          <InfoTip label="refreshing a brief">{REPORT_TIPS.refresh}</InfoTip>
        </div>
      </div>
      <div role="status" className="status">{data.notice ?? LEGACY_NOTICE}</div>
      {shown.map((id) => {
        const isOpen = open.has(id);
        return (
          <div key={id} className="blk" data-guide={`report.section.${id}`}>
            <div className="bhrow">
              <button type="button" className="bhead" aria-expanded={isOpen} aria-controls={`report-${id}`} onClick={() => toggle(id)}>
                <span className="chev" aria-hidden="true" /><span>{LEGACY_SECTION_LABEL[id]}</span><span className="cnt">{legacySectionCount(r, id)}</span>
              </button>
            </div>
            {isOpen && (
              <div id={`report-${id}`} style={legacyBody}>
                {id === "leadership" ? (
                  <ul style={legacyList}>{r.leadership.map((l, i) => <li key={i}><b>{l.name}</b><span style={{ color: c.muted }}>{` · ${l.title}`}</span> <Ref report={r} n={l.src} /></li>)}</ul>
                ) : id === "compete" ? (
                  <ul style={legacyList}>{r.compete.map((x, i) => <li key={i}><b>{x.offering}</b>{`: ${x.text}`}</li>)}</ul>
                ) : (
                  <ul style={legacyList}>{(r[id] as { text: string; src: number; on?: string }[]).map((it, i) => <li key={i}>{it.text}{it.on ? <span style={{ color: c.hint }}>{` · ${shortDate(it.on)}`}</span> : null} <Ref report={r} n={it.src} /></li>)}</ul>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="blk" style={{ padding: "10px 14px" }} data-guide="report.sources">
        <ol className="srcs">
          {r.sources.filter((s) => isHttps(s.url)).map((s) => (
            <li key={s.n}><span className="m">{`[${s.n}] `}</span><a className="lnk" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ── The question, and the four rows while the parts run ──────────────────────────────────────────────────────────────────────

const cardBox: React.CSSProperties = {
  border: `1px solid ${c.line}`, borderRadius: "var(--card-radius, 10px)", background: "var(--card-bg, var(--panel))", padding: "10px 12px",
  display: "flex", flexDirection: "column", gap: 8,
};
const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 };
const chip: React.CSSProperties = {
  background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 14px",
  fontSize: 12, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit", minHeight: 44, minWidth: 44,
};

const SETTLED: Record<Exclude<ConsentState, "pending">, string> = {
  yes: "Researched with web research",
  no: "Not researched",
  skipped: "Not researched",
};

/** "Research on the web?" with Yes / No. It says the searches, the usual time and the allowance use, not dollars. Once answered it shrinks to one muted line. */
export function ReportConsentRow({ subject, searches = MAX_REPORT_SEARCHES, state, disabled, onChoice, mode = "brief" }: {
  subject: string;
  searches?: number;
  state: ConsentState;
  disabled?: boolean;
  onChoice: (choice: WebChoice) => void;
  mode?: "brief" | "retry";
}) {
  if (state !== "pending") return <div style={{ fontSize: 11.5, color: c.hint }}>{SETTLED[state]}</div>;
  return (
    <div style={cardBox} role="group" aria-label="Research with web research?" data-guide="report.consent">
      <div style={{ ...label, display: "flex", alignItems: "center", gap: 4 }}>Research on the web? <InfoTip label="report searches">{REPORT_TIPS.parts}</InfoTip></div>
      <div style={{ fontSize: 12.5, color: c.ink, lineHeight: 1.4, overflowWrap: "anywhere" }}>{subject}</div>
      <div style={{ fontSize: 11.5, color: c.hint }}>{mode === "retry" ? REPORT_RETRY_CHIP_TEXT : searches === MAX_REPORT_SEARCHES ? REPORT_CHIP_TEXT : `Up to ${searches} searches.`}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("yes")} data-guide="report.consent.yes">Yes</button>
        <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("no")} data-guide="report.consent.no">No</button>
      </div>
    </div>
  );
}

export type PartState = "waiting" | "running" | "done" | "missing";

/** The four rows shown while the parts run; replaced by the brief when they finish. */
export function ReportProgressRows({ parts, subject }: { parts: Record<ReportPartId, PartState>; subject?: string }) {
  const word: Record<PartState, string> = { waiting: "waiting", running: "running", done: "done", missing: "could not be researched" };
  return (
    <div style={cardBox} role="status" aria-live="polite" aria-label="Brief progress" data-guide="report.progress">
      <style>{BRIEF_CSS}</style>
      <div style={{ ...label, display: "flex", alignItems: "center", gap: 4 }}>{subject ? `Researching ${subject}` : "Researching"} <InfoTip label="the four parts">{REPORT_TIPS.parts}</InfoTip></div>
      <ul className="bms-prog">
        {REPORT_PARTS.map((p) => (
          <li key={p}><span className={`pd ${parts[p]}`} aria-hidden="true" />{REPORT_PART_LABEL[p]} <span style={{ color: c.hint }}>{word[parts[p]]}</span></li>
        ))}
      </ul>
    </div>
  );
}
