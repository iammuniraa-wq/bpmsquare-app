"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import Sparkline from "@/components/signals/Sparkline";
import AnalyseButton from "@/components/analysis/AnalyseButton";
import InfoTip from "@/components/ui/InfoTip";
import OptionGroup from "@/components/ui/OptionGroup";
import { Opt } from "@/components/ui/Opt";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { dayLabel } from "@/lib/signals/rubric";
import { GROUPS, GROUP_ORDER, SOURCE_LABEL, STAGE_LABEL, type SignalTopic, type Stage } from "@/lib/signals/types";
import { SIGNAL_TIPS } from "@/lib/signals/tips";
import type { AccountSignals, Workspace, WorkspaceRow } from "@/lib/signals/queries";
import type { DidItWork } from "@/lib/signals/didItWork";
import Tour, { type TourStep } from "@/components/marketing/Tour";
import { withBefore } from "@/lib/studio/tourSteps";
import { SIGNALS_TOUR } from "@/lib/signals/tourSteps";
import styles from "./signals.module.css";

// Buying signals keeps its own highlight look (an outline, not a dimmed page); only the behaviour is shared.
const TOUR_CLASSES = { hl: styles.tourHl, cap: styles.tourCap, n: styles.tourN, btns: styles.tourBtns };

// "Who is in market": the workspace on the right, one Filters group on the left (a bottom sheet on a phone).
// Labels, values and actions only; every explanation sits behind an "i" (docs/design/ux-simplification.md).
// An account opens inside the workspace (with Back); "Did it work?" and Interests open in the same place.

export type CampaignOption = { id: string; name: string; sent_at: string };
type StageFilter = Stage | "all" | "new";

const TABS = [{ id: "market", label: "In market" }, { id: "didit", label: "Did it work?" }, { id: "interests", label: "Interests" }];
const TAB_IDS = TABS.map((t) => t.id);

const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(" ");

/** A card title with its "i" beside it (never inside a clickable title). */
const Title = ({ text, info }: { text: string; info?: string }) => (
  info ? <span className="bpm-label-row"><h2>{text}</h2><InfoTip label={text}>{info}</InfoTip></span> : <h2>{text}</h2>
);

const StagePill = ({ stage }: { stage: Stage }) => <span className={cx(styles.pill, styles[stage])}>{STAGE_LABEL[stage]}</span>;

function hrefFor(row: Pick<WorkspaceRow, "account_id" | "next">): string {
  if (row.next.kind === "quote") return ROUTES.quotationNew;
  if (row.next.kind === "campaign") return ROUTES.marketingNew;
  return ROUTES.account(row.account_id);
}

export default function SignalsWorkspace({ workspace, campaigns, canEdit, isAdmin, canAnalyse }: { workspace: Workspace; campaigns: CampaignOption[]; canEdit: boolean; isAdmin: boolean; canAnalyse: boolean }) {
  const [tab, setTab] = useUrlTab(TAB_IDS);
  const [stage, setStage] = useState<StageFilter>("all");
  const [topic, setTopic] = useState("");
  const [owner, setOwner] = useState("");
  const [q, setQ] = useState("");
  const [account, setAccount] = useState<AccountSignals | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [topics, setTopics] = useState<SignalTopic[]>(workspace.topics);
  const [campaignId, setCampaignId] = useState("");
  const [didIt, setDidIt] = useState<{ name: string; result: DidItWork | null } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [sheet, setSheet] = useState(false);

  const owners = useMemo(() => [...new Set(workspace.rows.map((r) => r.owner).filter((x): x is string => !!x))].sort(), [workspace.rows]);
  const rows = useMemo(() => workspace.rows.filter((r) => {
    if (stage === "new" ? !r.movement.fresh : stage !== "all" && r.stage !== stage) return false;
    if (topic && !r.topics.includes(topic)) return false;
    if (owner && r.owner !== owner) return false;
    if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [workspace.rows, stage, topic, owner, q]);

  const activeFilters = [stage !== "all", !!topic, !!owner, !!q].filter(Boolean).length;
  const onList = tab === "market" && account === null;

  // A phone's Filters sheet: Esc closes it and the page behind it does not scroll.
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [sheet]);

  /** Any change to a filter goes back to the list, as the account view has nothing to filter. */
  const showList = () => { setAccount(null); setTab("market"); };
  const goTab = (id: string) => { setAccount(null); setTab(id); };

  async function openAccount(id: string) {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/signals/intent/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not open the account");
      setAccount(json as AccountSignals); setTab("market");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function mark(action: "not_in_market" | "clear") {
    if (!account) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/signals/intent/${account.account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setAccount(json.data as AccountSignals);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function rescore() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/signals/rescore", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not rescore");
      window.location.reload();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  async function loadDidIt(id: string) {
    setCampaignId(id); setDidIt(null);
    if (!id) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/signals/campaign/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load");
      setDidIt(json);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const phone = () => typeof window !== "undefined" && window.innerWidth <= 900;
  const tour: TourStep[] = withBefore(SIGNALS_TOUR, [
    () => { setSheet(false); goTab("market"); },
    undefined,
    undefined,
    undefined,
    undefined,
    () => { if (phone()) setSheet(true); setFiltersOpen(true); },
    () => { setSheet(false); goTab("market"); },
  ]);

  const stageOptions: { id: StageFilter; label: string; n: number }[] = [
    { id: "all", label: "All", n: workspace.counts.all },
    { id: "deciding", label: STAGE_LABEL.deciding, n: workspace.counts.deciding },
    { id: "comparing", label: STAGE_LABEL.comparing, n: workspace.counts.comparing },
    { id: "looking", label: STAGE_LABEL.looking, n: workspace.counts.looking },
    { id: "quiet", label: STAGE_LABEL.quiet, n: workspace.counts.quiet },
    { id: "new", label: "Moved up this week", n: workspace.counts.new },
  ];

  const updated = workspace.updatedAt ? `Updated ${dayLabel(workspace.updatedAt)}` : "Not scored yet";

  return (
    <div className={styles.wrap}>
      {workspace.pending && <div className={styles.banner}>Buying signals is waiting for a database update. The list will fill in once it has been applied.</div>}
      {error && <div className={styles.err} role="alert">{error}</div>}

      <div className={styles.studio}>
        {sheet && <div className={styles.backdrop} onClick={() => setSheet(false)} aria-hidden="true" />}
        <aside className={cx(styles.panel, "bpm-og-panel", sheet && styles.sheetOpen)} aria-label="Filters" {...(sheet ? { role: "dialog", "aria-modal": true } : {})}>
          <OptionGroup id="sgFilters" title="Filters" info={SIGNAL_TIPS.filters} summary={activeFilters ? `${activeFilters} on` : "None"} open={filtersOpen} on onToggle={() => setFiltersOpen((o) => !o)}>
            <Opt label="Buying stage" info={SIGNAL_TIPS.stage}>
              <div className={styles.chips} role="group" aria-label="Buying stage">
                {stageOptions.map((s) => (
                  <button key={s.id} type="button" className={styles.chip} aria-pressed={stage === s.id} onClick={() => { setStage(s.id); showList(); }}>
                    {s.label}<span className={styles.n}>{s.n}</span>
                  </button>
                ))}
              </div>
            </Opt>
            <div id="sgInterest">
              <Opt label="Interest" info={SIGNAL_TIPS.interest} htmlFor="sgTopicSel">
                <select id="sgTopicSel" className={styles.select} value={topic} onChange={(e) => { setTopic(e.target.value); showList(); }}>
                  <option value="">Any interest</option>
                  {[...new Set([...topics.map((t) => t.name), ...workspace.rows.flatMap((r) => r.topics)])].sort().map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Opt>
            </div>
            <Opt label="Owner" info={SIGNAL_TIPS.owner} htmlFor="sgOwnerSel">
              <select id="sgOwnerSel" className={styles.select} value={owner} onChange={(e) => { setOwner(e.target.value); showList(); }}>
                <option value="">Anyone</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Opt>
            <Opt label="Account name" htmlFor="sgQ">
              <input id="sgQ" className={styles.field} value={q} onChange={(e) => { setQ(e.target.value); showList(); }} placeholder="Search…" />
            </Opt>
            <div className={styles.sheetDone}>
              <button type="button" className={cx(styles.btn, styles.primary)} onClick={() => setSheet(false)}>Show {rows.length} account{rows.length === 1 ? "" : "s"}</button>
            </div>
          </OptionGroup>
        </aside>

        <section className={styles.ws} aria-label="Workspace">
          <div className={styles.head}>
            <div className={styles.tabsWrap} id="sgTabs">
              <Tabs tabs={TABS} value={tab} onChange={goTab} label="Views" />
            </div>
            <div className={styles.acts}>
              <span className={styles.line}>{updated}</span>
              {onList && <button type="button" className={cx(styles.btn, styles.filterBtn)} aria-haspopup="dialog" onClick={() => setSheet(true)}>Filters{activeFilters ? ` (${activeFilters})` : ""}</button>}
              {isAdmin && <button type="button" className={styles.btn} disabled={busy} onClick={rescore}>Rescore now</button>}
              <Tour steps={tour} storageKey="bpm.signals.tour.step" buttonId="sgTourBtn" classes={TOUR_CLASSES} />
            </div>
          </div>
          {onList && <p className={styles.line}><b>Marketing moved {workspace.moved30} account{workspace.moved30 === 1 ? "" : "s"}</b> up a stage in the last 30 days.</p>}

          {onList && (
            <div className={styles.card} id="sgList">
              <div className={styles.cardHead}>
                <Title text={`${rows.length} account${rows.length === 1 ? "" : "s"} in the list`} info={SIGNAL_TIPS.list} />
              </div>
              <div className={styles.hd} aria-hidden="true">
                <span>Account</span><span id="sgColStage">Stage</span><span id="sgColScore">Score</span><span id="sgColWhy">Why</span><span>Owner</span><span id="sgColNext">Next step</span>
              </div>
              {rows.length === 0 ? (
                <div className={styles.empty}>
                  <b>{workspace.rows.length === 0 ? "No signals yet" : "Nothing matches these filters"}</b>
                  {workspace.rows.length === 0
                    ? "Signals appear as your team sends quotes and campaigns. They are scored every few hours; an admin can press Rescore now."
                    : "Clear a filter to see the whole list."}
                </div>
              ) : rows.map((r) => (
                <div key={r.account_id} className={cx(styles.row, r.movement.fresh && styles.fresh)} role="button" tabIndex={0}
                  onClick={() => openAccount(r.account_id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void openAccount(r.account_id); } }}>
                  <div className={styles.acct}>
                    <b>{r.name}</b>
                    <small>{[r.city, r.industry].filter(Boolean).join(" · ") || "—"}</small>
                    {r.movement.movedText && <span className={styles.moved}>{r.movement.movedText}</span>}
                  </div>
                  <div className={styles.stageCell}>
                    <StagePill stage={r.stage} />
                    <span className={cx(styles.mv, styles[r.movement.direction])}>{r.movement.label}{r.movement.daysInStage !== null ? ` · ${r.movement.daysInStage}d in stage` : ""}</span>
                  </div>
                  <div className={styles.scoreCell}>
                    <span>{r.score}</span>
                    <span className={cx(styles.spark, styles[r.movement.direction])}><Sparkline values={r.series} tone={r.movement.direction} /></span>
                  </div>
                  <div className={styles.why}>{r.reason}<span className={styles.m}>{r.score}</span></div>
                  <div className={styles.owner}>{r.owner ?? "—"}</div>
                  <div className={styles.next} onClick={(e) => e.stopPropagation()}>
                    {r.next.kind && <Link className={styles.btn} href={hrefFor(r)}>{r.next.label}</Link>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "market" && account && (
            <AccountView data={account} canEdit={canEdit} canAnalyse={canAnalyse} busy={busy} onBack={() => setAccount(null)} onMark={mark} />
          )}

          {tab === "didit" && (
            <div className={styles.card}>
              <div className={styles.cardHead}><Title text="Did it work?" info={SIGNAL_TIPS.didItWork} /></div>
              <div style={{ marginTop: 8 }}>
                <Opt label="Send" htmlFor="sgCamp">
                  <select id="sgCamp" className={styles.select} value={campaignId} onChange={(e) => void loadDidIt(e.target.value)}>
                    <option value="">Choose a send…</option>
                    {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} · {dayLabel(c.sent_at)}</option>)}
                  </select>
                </Opt>
              </div>
              {campaigns.length === 0 && <div className={styles.empty}><b>No sends yet</b>Once a campaign or newsletter has been sent it appears here.</div>}
              {didIt && <DidItView data={didIt} />}
            </div>
          )}

          {tab === "interests" && (
            <TopicsView topics={topics} setTopics={setTopics} isAdmin={isAdmin} onError={setError} />
          )}
        </section>
      </div>
    </div>
  );
}

function AccountView({ data, canEdit, canAnalyse, busy, onBack, onMark }: { data: AccountSignals; canEdit: boolean; canAnalyse: boolean; busy: boolean; onBack: () => void; onMark: (a: "not_in_market" | "clear") => void }) {
  const byGroup = GROUP_ORDER.map((g) => ({ g, items: data.factors.filter((f) => f.group === g) })).filter((x) => x.items.length > 0);
  const notes = data.factors.filter((f) => f.group === "note");
  const nextHref = data.next.kind === "quote" ? ROUTES.quotationNew : data.next.kind === "campaign" ? ROUTES.marketingNew : ROUTES.account(data.account.id);
  return (
    <div className={styles.two}>
      <div className={styles.card}>
        <button type="button" className={styles.back} onClick={onBack}>← Back to the list</button>
        <div className={styles.cardHead} style={{ marginTop: 8 }}>
          <h2>{data.account.name}</h2>
          <StagePill stage={data.stage} />
        </div>
        <div className={styles.big}>
          <b>{data.score}</b>
          <span className={styles.bigSpark}><Sparkline values={data.series} tone={data.movement.direction} width={140} height={40} /></span>
          <span className={cx(styles.mv, styles[data.movement.direction])}>{data.movement.label}{data.movement.scoreDelta ? ` (${data.movement.scoreDelta > 0 ? "+" : ""}${data.movement.scoreDelta} this week)` : ""}</span>
        </div>
        {data.movement.movedText && <p className={styles.moved}>{data.movement.movedText}</p>}
        {data.movement.daysInStage !== null && <p className={styles.line}>{data.movement.daysInStage} day{data.movement.daysInStage === 1 ? "" : "s"} in {STAGE_LABEL[data.stage]}</p>}
        <p className={styles.reason}>{data.reason}</p>

        <div className={styles.fold}>
          <div className={styles.foldHead}><span className="bpm-label-row"><b>How this is worked out</b><InfoTip label="How this is worked out">{SIGNAL_TIPS.worked}</InfoTip></span></div>
          <div className={styles.foldIn}>
            {byGroup.length === 0 && notes.length === 0 && <p className={styles.line}>No signals in the last 60 days.</p>}
            {notes.map((n, i) => <div key={i} className={styles.fac}><div>{n.label}<small>{n.detail}</small></div><b>{n.points}</b></div>)}
            {byGroup.map(({ g, items }) => (
              <div key={g}>
                <div className={cx(styles.fac, styles.grpRow)}><span>{GROUPS[g].label}</span><b>{items.reduce((t, f) => t + f.points, 0)}</b></div>
                {items.map((f, i) => <div key={i} className={styles.fac}><div>{f.label}<small>{f.detail}</small></div><b>{f.points > 0 ? `+${f.points}` : f.points}</b></div>)}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          {data.next.kind && <Link className={cx(styles.btn, styles.primary)} href={nextHref}>{data.next.label}</Link>}
          <Link className={styles.btn} href={ROUTES.account(data.account.id)}>Open account</Link>
          <AnalyseButton name={data.account.name} accountId={data.account.id} label="Analyse" show={canAnalyse} className={styles.btn} />
          {canEdit && (data.held
            ? <button type="button" className={styles.btn} disabled={busy} onClick={() => onMark("clear")}>Clear “not in market”</button>
            : <button type="button" className={styles.btn} disabled={busy} onClick={() => onMark("not_in_market")}>Not in market</button>)}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}><Title text="Signals timeline" info={SIGNAL_TIPS.timeline} /></div>
        {data.timeline.length === 0 ? <div className={styles.empty}>Nothing recent.</div> : (
          <div className={styles.tl}>
            {data.timeline.map((s, i) => (
              <div key={i} className={styles.ev}>
                <span className={styles.d}>{dayLabel(s.occurred_at)}</span>
                <div>
                  {s.href ? <Link href={s.href}>{s.headline}</Link> : s.headline}
                  <small><span className={styles.src}>{SOURCE_LABEL[s.source]}</span>{GROUPS[s.group].label}</small>
                </div>
                <span className={styles.p}>{s.points > 0 ? `+${s.points}` : s.points}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DidItView({ data }: { data: { name: string; result: DidItWork | null } }) {
  const r = data.result;
  if (!r) return <div className={styles.empty}><b>{data.name}</b>This one has not been sent yet.</div>;
  return (
    <div style={{ marginTop: 10 }}>
      <p className={styles.line}><b>{data.name}</b> · sent {dayLabel(r.sentAt)} to {r.recipients} account{r.recipients === 1 ? "" : "s"}{r.partial ? " · the 14 days are not over, so this is so far" : ""}</p>
      <div className={styles.kpis}>
        <div><b>{r.movedUp}</b><span>Moved up a stage</span></div>
        <div><b>{r.clicked}</b><span>Clicked a link</span></div>
        <div><b>{r.nowDeciding}</b><span>Now Deciding</span></div>
      </div>
      <p className={styles.line}>Before the send these accounts averaged <b>{r.avgBefore}</b>; {r.partial ? "so far" : "two weeks after"}: <b>{r.avgAfter}</b>.
        {r.others ? <> Other accounts: {r.others.before} to {r.others.after}.</> : null}</p>
      {r.small && <p className={styles.line}>Fewer than 20 recipients: treat this as a list, not a trend.</p>}
      {r.rows.length === 0 ? <div className={styles.empty}>No recipient moved up or clicked yet.</div> : r.rows.map((m) => (
        <div key={m.account_id} className={styles.mvRow}>
          <Link href={ROUTES.account(m.account_id)}>{m.name}</Link>
          <span>{STAGE_LABEL[m.before]} → {STAGE_LABEL[m.after]}</span>
          <span className={styles.line}>{m.what}</span>
        </div>
      ))}
    </div>
  );
}

function TopicsView({ topics, setTopics, isAdmin, onError }: { topics: SignalTopic[]; setTopics: (t: SignalTopic[]) => void; isAdmin: boolean; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [saving, setSaving] = useState(false);

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Could not save");
    return json;
  }

  async function add() {
    setSaving(true); onError("");
    try {
      const json = await call("/api/signal-topics", "POST", { name, keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) });
      setTopics([...topics, json.topic as SignalTopic].sort((a, b) => a.name.localeCompare(b.name)));
      setName(""); setKeywords("");
    } catch (e) { onError((e as Error).message); } finally { setSaving(false); }
  }
  async function toggle(t: SignalTopic) {
    onError("");
    try {
      const json = await call(`/api/signal-topics/${t.id}`, "PATCH", { enabled: !t.enabled });
      setTopics(topics.map((x) => (x.id === t.id ? (json.topic as SignalTopic) : x)));
    } catch (e) { onError((e as Error).message); }
  }
  async function remove(t: SignalTopic) {
    onError("");
    try {
      await call(`/api/signal-topics/${t.id}`, "DELETE");
      setTopics(topics.filter((x) => x.id !== t.id));
    } catch (e) { onError((e as Error).message); }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}><Title text="Interests" info={SIGNAL_TIPS.interests} /></div>
      {topics.length === 0 ? <div className={styles.empty}><b>No interests yet</b>{isAdmin ? "Add the first one below." : "An admin can add them."}</div> : topics.map((t) => (
        <div key={t.id} className={styles.trow}>
          <div><b>{t.name}</b><small>{t.enabled ? "On" : "Off"}</small></div>
          <div className={styles.line}>{t.keywords.length ? t.keywords.join(", ") : "No keywords"}</div>
          {isAdmin && (
            <div className={styles.acts}>
              <button type="button" className={styles.btn} onClick={() => void toggle(t)}>{t.enabled ? "Turn off" : "Turn on"}</button>
              <button type="button" className={styles.btn} onClick={() => void remove(t)} aria-label={`Delete ${t.name}`}>Delete</button>
            </div>
          )}
        </div>
      ))}
      {isAdmin && (
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <Opt label="New interest" htmlFor="sgTName">
            <input id="sgTName" className={styles.field} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </Opt>
          <Opt label="Keywords" info={SIGNAL_TIPS.keywords} htmlFor="sgTKw">
            <input id="sgTKw" className={styles.field} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="precast, boundary wall" />
          </Opt>
          <div><button type="submit" className={cx(styles.btn, styles.primary)} disabled={saving || !name.trim()}>Add interest</button></div>
        </form>
      )}
    </div>
  );
}
