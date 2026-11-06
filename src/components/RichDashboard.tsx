"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "@/styles/rich-dashboard.css";
import { formatMoney, formatMoneyCompact, type CurrencyDef } from "@/lib/currency";
import { AlertTriangle, Clock, FileText } from "@/components/Icons";
import CountUp from "@/components/ui/CountUp";
import InfoTip from "@/components/ui/InfoTip";
import PhotoFrame, { type PhotoMesh } from "@/components/ui/PhotoFrame";
import Ring from "@/components/ui/Ring";
import type { WelcomeModel } from "@/lib/richWelcome";
import { bidDaysText, type RichAttention, type RichBid, type RichDashModel, type RichKpi, type RichPipeline } from "@/lib/richDashboard";

// The Rich dashboard (docs/design/rich-ui.md, step 2a): greeting, four big numbers, one pipeline flow, what needs you, the bids closing soonest.
// Presentational: DashboardLayout hands it the view-model (src/lib/richDashboard.ts) and the classic dashboard as `more`, which stays behind one
// quiet expander so no card, view switch or Adapt control goes missing. Styles: src/styles/rich-dashboard.css, all under [data-rich="true"].

const MESHES: PhotoMesh[] = ["a", "b", "c"];

const kpiText = (k: RichKpi, cur: CurrencyDef, v: number): string =>
  k.kind === "money" ? formatMoneyCompact(v, cur, 1) : k.kind === "percent" ? `${Math.round(v)}%` : Math.round(v).toLocaleString(cur.locale);

const kpiFull = (k: RichKpi, cur: CurrencyDef): string =>
  k.kind === "money" ? formatMoney(k.value, cur) : k.kind === "percent" ? `${Math.round(k.value)}%` : String(k.value);

function Glyph({ icon }: { icon: RichAttention["icon"] }) {
  const p = { size: 22 };
  return icon === "clock" ? <Clock {...p} /> : icon === "file" ? <FileText {...p} /> : <AlertTriangle {...p} />;
}

function Arrow() {
  return (
    <svg className="rd-go" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Kpis({ kpis, cur }: { kpis: RichKpi[]; cur: CurrencyDef }) {
  if (kpis.length === 0) return null;
  return (
    <div className="rd-kpis rd-snap" role="list" aria-label="Key numbers" data-count={kpis.length}>
      {kpis.map((k) => (
        <Link
          key={k.key} href={k.href} role="listitem" className="rd-kpi" data-guide={`dashboard.rich.kpi.${k.key}`}
          aria-label={`${k.label}: ${kpiFull(k, cur)}, ${k.sub}`}
        >
          <span className="rd-kpi__n"><CountUp value={k.value} format={(v) => kpiText(k, cur, v)} /></span>
          <span className="rd-kpi__l">{k.label}</span>
          <span className={`rd-kpi__s rd-kpi__s--${k.subTone}`}>{k.sub}</span>
        </Link>
      ))}
    </div>
  );
}

function Pipeline({ p, cur }: { p: RichPipeline; cur: CurrencyDef }) {
  const [active, setActive] = useState<number | null>(null);
  const stage = active === null ? null : p.stages[active];
  const readoutVal = formatMoney(stage ? stage.value : p.total, cur);
  const readoutTxt = stage ? `${stage.label}, ${stage.count}` : `${p.count} ${p.noun}${p.count === 1 ? "" : "s"}`;
  return (
    <PhotoFrame mesh="a" radius={32} height="auto" style={{ padding: 0 }}>
      <section className="rd-pipe" aria-labelledby="rd-h-pipe" data-guide="dashboard.rich.pipeline">
        <div className="rd-pipe__head">
          <h2 id="rd-h-pipe">{p.title}</h2>
          {p.stages.length > 0 && (
            <div className="rd-readout" aria-live="polite"><strong>{readoutVal}</strong><span>{readoutTxt}</span></div>
          )}
        </div>
        {p.stages.length === 0 ? (
          <div className="rd-pipe__empty">
            <p>{p.emptyText}</p>
            <Link href={p.emptyHref} className="rd-btn">{p.emptyAction}</Link>
          </div>
        ) : (
          <>
          <div className="rd-bar" aria-hidden="true">
            {p.stages.map((s, i) => <span key={s.key} className={`rd-bar__s rd-seg--${(i % 4) + 1}`} style={{ flexGrow: s.weight }} />)}
          </div>
          <div className="rd-flow" role="group" aria-label={p.title} onMouseLeave={() => setActive(null)} onBlur={() => setActive(null)}>
            {p.stages.map((s, i) => (
              <Link
                key={s.key} href={s.href} className={`rd-seg rd-seg--${(i % 4) + 1}`} style={{ flexGrow: s.weight }}
                aria-label={`${s.label}: ${s.count} ${p.noun}${s.count === 1 ? "" : "s"}, ${formatMoney(s.value, cur)}`}
                onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}
              >
                <b>{s.label}</b>
                <span>{s.count}</span>
                <span className="rd-seg__val">{formatMoneyCompact(s.value, cur, 1)}</span>
              </Link>
            ))}
          </div>
          </>
        )}
      </section>
    </PhotoFrame>
  );
}

function Attention({ items, total }: { items: RichAttention[]; total: number }) {
  if (items.length === 0) {
    return (
      <div className="rd-attn rd-attn--clear" aria-label="Needs attention">
        <span className="rd-attn__ok" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        Nothing is waiting on you.
      </div>
    );
  }
  return (
    <div className="rd-attn" aria-label={`Needs attention, ${total} in all`} data-guide="dashboard.rich.attention">
      {items.map((it) => (
        <Link key={it.key} href={it.href} className="rd-attn__item">
          <span className="rd-attn__ic" aria-hidden="true"><Glyph icon={it.icon} /></span>
          <span className="rd-attn__t">{it.text}</span>
          <Arrow />
        </Link>
      ))}
    </div>
  );
}

function Bids({ bids, cur }: { bids: RichBid[]; cur: CurrencyDef }) {
  return (
    <section aria-labelledby="rd-h-bids" data-guide="dashboard.rich.bids">
      <div className="rd-title">
        <h2 id="rd-h-bids">Bids closing soonest</h2>
        <InfoTip label="Bids closing soonest">The ring fills over the last 28 days before a bid closes. It turns orange in the final week.</InfoTip>
      </div>
      {bids.length === 0 ? (
        <p className="rd-quiet">No bid is closing in the next few weeks.</p>
      ) : (
        <div className="rd-bids rd-snap">
          {bids.map((b, i) => (
            <Link key={b.id} href={b.href} className="rd-bid" aria-label={`${b.title}, closes in ${bidDaysText(b.daysLeft)}, ${formatMoney(b.value, cur)}`}>
              <PhotoFrame mesh={MESHES[i % MESHES.length]} height={190}>
                <span className="rd-bid__float">
                  <Ring value={b.pct} size={40} stroke={6} tone={b.tone} label="Time used" />
                  {bidDaysText(b.daysLeft)}
                </span>
              </PhotoFrame>
              <span className="rd-bid__body">
                <span className="rd-bid__t">{b.title}</span>
                <span className="rd-bid__m">{[b.client, formatMoneyCompact(b.value, cur, 1)].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}


const WELCOME_SKIP_KEY = "bpm_rich_welcome_skip";

function Check() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  );
}

// A workspace with no data: a short list of first steps in place of zeros. Each step ticks itself; the first open one carries the button.
function Welcome({ w, onSkip }: { w: WelcomeModel; onSkip: () => void }) {
  const total = w.steps.length;
  const nextKey = w.steps.find((s) => !s.done)?.key;
  return (
    <section className="rd-welcome" aria-labelledby="rd-h-welcome" data-guide="dashboard.rich.welcome">
      <PhotoFrame mesh="a" radius={32} height="auto" style={{ padding: 0 }}>
        <div className="rd-welcome__head">
          <Ring value={(w.doneCount / Math.max(1, total)) * 100} size={72} stroke={9} label="Setup progress">
            <b className="rd-welcome__n">{w.doneCount}/{total}</b>
          </Ring>
          <div>
            <h2 id="rd-h-welcome">Let&rsquo;s set up your workspace</h2>
            <p>Your numbers appear here as soon as you add data.</p>
          </div>
        </div>
      </PhotoFrame>
      <ol className="rd-steps">
        {w.steps.map((s, i) => (
          <li key={s.key} className={`rd-step${s.done ? " rd-step--done" : ""}${s.key === nextKey ? " rd-step--next" : ""}`}>
            <span className="rd-step__mark" aria-hidden="true">{s.done ? <Check /> : i + 1}</span>
            <span className="rd-step__t"><b>{s.title}</b><span>{s.sub}</span></span>
            {s.done
              ? <span className="rd-step__ok">Done</span>
              : s.key === nextKey
                ? <Link href={s.href} className="rd-btn">{s.cta}</Link>
                : <Link href={s.href} className="rd-step__go" aria-label={s.title}><Arrow /></Link>}
          </li>
        ))}
      </ol>
      <button type="button" className="rd-pill rd-pill--quiet" onClick={onSkip}>Skip for now, show my dashboard</button>
    </section>
  );
}

export default function RichDashboard({ greeting, userName, dateLabel, model, cur, toolbar, body, welcome }: {
  greeting: string;
  userName: string | null;
  dateLabel: string;
  model: RichDashModel;
  cur: CurrencyDef;
  /** The classic dashboard's switches and Adapt buttons; they open from "Customise" and nothing else is hidden. */
  toolbar: React.ReactNode;
  /** The rest of the dashboard's cards, drawn in the Rich skin below the opening (cards the opening already shows are left out upstream). */
  body: React.ReactNode;
  /** The first-steps list for a workspace with no data yet; null when it does not apply. */
  welcome?: WelcomeModel | null;
}) {
  const [trayOpen, setTrayOpen] = useState(false);
  // "?welcome=1" shows the first-steps screen on any workspace, so it can be reviewed without emptying one. A person can also skip it (per browser).
  const [preview, setPreview] = useState(false);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    try {
      setPreview(new URLSearchParams(window.location.search).get("welcome") === "1");
      setSkipped(localStorage.getItem(WELCOME_SKIP_KEY) === "1");
    } catch { /* keep the dashboard */ }
  }, []);
  const showWelcome = !!welcome && (preview || (welcome.fresh && !skipped));
  const skip = () => { setSkipped(true); try { localStorage.setItem(WELCOME_SKIP_KEY, "1"); } catch { /* ignore */ } };

  const total = model.attentionTotal;
  const line = showWelcome && welcome ? (welcome.steps.length - welcome.doneCount === 1 ? "One step left and you are running." : `${welcome.steps.length - welcome.doneCount} quick steps and you are running.`) : total === 0 ? "You are all caught up." : total === 1 ? "One thing needs you today." : `${total} things need you today.`;

  return (
    <div className="rd" data-guide="dashboard.rich">
      <header className="rd-hello">
        <div>
          <p className="rd-date">{dateLabel}</p>
          <h1>{greeting}{userName ? `, ${userName}` : ""}</h1>
          <p className="rd-line">{line}</p>
        </div>
        {!showWelcome && (
          <button type="button" className="rd-pill" aria-expanded={trayOpen} aria-controls="rd-tray" onClick={() => setTrayOpen((o) => !o)} data-guide="dashboard.rich.customise">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
            Customise
          </button>
        )}
      </header>
      {showWelcome && welcome ? <Welcome w={welcome} onSkip={skip} /> : (
        <>
          {trayOpen && <div id="rd-tray" className="rd-tray">{toolbar}</div>}

          <Kpis kpis={model.kpis} cur={cur} />
          {model.pipeline && <Pipeline p={model.pipeline} cur={cur} />}
          <Attention items={model.attention} total={total} />
          {model.bids && <Bids bids={model.bids} cur={cur} />}
        </>
      )}

      <div className="rd-rest" hidden={showWelcome}>{body}</div>
    </div>
  );
}
