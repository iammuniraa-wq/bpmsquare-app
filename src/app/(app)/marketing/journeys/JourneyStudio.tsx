"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import MoreMenu, { type MenuItem } from "@/components/ui/MoreMenu";
import OptionGroup from "@/components/ui/OptionGroup";
import { CheckOpt, Opt } from "@/components/ui/Opt";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useFeel } from "@/components/FeelProvider";
import { CONDITION_FIELDS, TEMPLATES, TRIGGERS, describeStep, templateById } from "@/lib/marketing/journeys/definition";
import { explainEntry, explainStep, guardSummary } from "@/lib/marketing/journeys/explain";
import type { JourneyLimits } from "@/lib/marketing/journeys/safety";
import { JOURNEY_TIPS, inTroubleTip, limitsTip } from "@/lib/marketing/journeys/tips";
import { MAX_LOOKBACK_DAYS, MAX_STEPS, type JourneyDefinition, type JourneyStatus, type JourneyStep, type StepKind } from "@/lib/marketing/journeys/types";
import { ROUTES } from "@/lib/constants";
import {
  completeTask, loadActivity, lookupContacts, lookupVersions, previewJourney, removeJourney, saveJourney, setStatus, simulate,
  type ActivityData, type PreviewData,
} from "./journeyApi";
import type { TraceLine } from "@/lib/marketing/journeys/simulate";
import JourneyTour, { type TourStep } from "./JourneyTour";
import styles from "./journey.module.css";

export type JourneyStudioProps = {
  journey: { id: string; ref: string | null; name: string; status: JourneyStatus; definition: JourneyDefinition; hasRuns: boolean };
  topics: { key: string; label: string }[];
  limits: JourneyLimits;
  timezone: string;
  studioOn: boolean;
  canEdit: boolean;
};

const cx = (...p: (string | false | null | undefined)[]): string => p.filter(Boolean).join(" ");
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const UP = "M6 15l6-6 6 6";
const DOWN = "M6 9l6 6 6-6";
const TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";

type Sec = "startSec" | "whenSec" | "rulesSec";
/** Setup is the panel's groups; it is a tab only on a phone, where the panel and the canvas share one strip. */
type Tab = "setup" | "build" | "test" | "running";
const TAB_IDS: Tab[] = ["setup", "build", "test", "running"];
const CANVAS_TABS = [{ id: "build", label: "Build" }, { id: "test", label: "Test" }, { id: "running", label: "Running" }];
const PHONE_TABS = [{ id: "setup", label: "Setup" }, ...CANVAS_TABS];

/** How many chips or rows a long list shows before "Show all (N)". */
const SHOWN = 5;

const ADDABLE: { kind: StepKind; label: string }[] = [
  { kind: "wait", label: "+ Wait" }, { kind: "send_newsletter", label: "+ Send a newsletter version" },
  { kind: "create_task", label: "+ Create a task for the owner" }, { kind: "notify_owner", label: "+ Notify the owner" }, { kind: "end", label: "+ End" },
];

function newStep(kind: StepKind, steps: JourneyStep[]): JourneyStep {
  const n = steps.reduce((m, s) => Math.max(m, Number(s.id.replace(/\D/g, "")) || 0), 0) + 1;
  const id = `s${n}`;
  switch (kind) {
    case "wait": return { id, kind, amount: 1, unit: "days" };
    case "send_newsletter": return { id, kind, newsletter_version_id: null, topic: "offers", languages: [], fallback_language: "en" };
    case "create_task": return { id, kind, title: "Call {contact_name}", due_in_days: 1 };
    case "notify_owner": return { id, kind, text: "Please follow up" };
    case "end": return { id, kind };
  }
}

const fmtWhen = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const onPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;

export default function JourneyStudio({ journey, topics, limits, timezone, studioOn, canEdit }: JourneyStudioProps) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [name, setName] = useState(journey.name);
  const [def, setDef] = useState<JourneyDefinition>(journey.definition);
  const [status, setStatusState] = useState<JourneyStatus>(journey.status);
  const [saved, setSaved] = useState(() => JSON.stringify({ n: journey.name, d: journey.definition }));
  const [open, setOpen] = useState<Sec | null>("whenSec");
  const [tabId, setTab] = useUrlTab(TAB_IDS, "tab", "build");
  const tab = tabId as Tab;
  // On a wide screen the panel is always beside the canvas, so a stale ?tab=setup just means Build.
  const canvasTab = tab === "setup" ? "build" : tab;
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const [showDef, setShowDef] = useState(false);
  const [versions, setVersions] = useState<{ id: string; label: string; languages: string[] }[]>([]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [allEntrants, setAllEntrants] = useState(false);
  const [allGroups, setAllGroups] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; account: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string; account: string } | null>(null);
  const [trace, setTrace] = useState<{ person: { name: string; account: string }; lines: TraceLine[] } | null>(null);
  const [tracing, setTracing] = useState(false);

  const live = status === "live";
  const editable = canEdit && !live && status !== "archived";
  const dirty = JSON.stringify({ n: name, d: def }) !== saved;
  const topicLabel = useCallback((key: string | null) => topics.find((t) => t.key === key)?.label ?? (key ?? "this subject"), [topics]);

  const toast = useCallback((m: string) => { setToastText(m); window.setTimeout(() => setToastText(null), 4200); }, []);

  const refreshPreview = useCallback(async () => {
    setPreviewing(true);
    const r = await previewJourney(journey.id);
    setPreviewing(false);
    if (r.ok) setPreview(r.data);
  }, [journey.id]);
  const refreshActivity = useCallback(async () => { const r = await loadActivity(journey.id); if (r.ok) setActivity(r.data); }, [journey.id]);

  useEffect(() => {
    void refreshActivity();
    if (status !== "live") void refreshPreview();
    if (studioOn) void lookupVersions().then((r) => { if (r.ok) setVersions(r.data.versions); });
    // run once for the page that was opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = window.setTimeout(async () => { const r = await lookupContacts(q.trim()); if (r.ok) setFound(r.data.contacts); }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const patchDef = (fn: (d: JourneyDefinition) => JourneyDefinition) => { setDef(fn); setTrace(null); };
  const setStep = (i: number, p: Partial<JourneyStep>) => patchDef((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? ({ ...s, ...p } as JourneyStep) : s)) }));
  const moveStep = (i: number, dir: -1 | 1) => patchDef((d) => {
    const steps = [...d.steps]; const k = i + dir;
    if (k < 0 || k >= steps.length) return d;
    [steps[i], steps[k]] = [steps[k], steps[i]];
    return { ...d, steps };
  });

  async function save(quiet = false): Promise<boolean> {
    if (!canEdit) return true;
    setSaving(true); setError(null);
    const body: { name: string; definition?: JourneyDefinition } = { name: name.trim() || journey.name };
    if (!live) body.definition = def;
    const r = await saveJourney(journey.id, body);
    setSaving(false);
    if (!r.ok) { setError(r.pending ? "Journeys are waiting for a database update." : r.error); return false; }
    setSaved(JSON.stringify({ n: name, d: def }));
    if (!quiet) toast("Saved.");
    if (!live) void refreshPreview();
    return true;
  }

  async function goLive() {
    setError(null); setBusy(true);
    try {
      if (dirty && !(await save(true))) return;
      let r = await setStatus(journey.id, "turn_on", false);
      if (!r.ok && r.status === 409 && r.body?.needs_confirm) {
        const checks = (r.body.checks as { text: string; level: string }[] | undefined) ?? [];
        const ok = await confirm({ title: "Make this journey live?", body: checks.filter((c) => c.level === "confirm" || c.level === "warn").map((c) => c.text).join(" ") || "More people than usual would enter.", confirmLabel: "Go live" });
        if (!ok) return;
        r = await setStatus(journey.id, "turn_on", true);
      }
      if (!r.ok) { setError(r.error); return; }
      setStatusState("live");
      toast(r.data.enrolled ? `Live. ${r.data.enrolled} ${r.data.enrolled === 1 ? "person" : "people"} entered; the first steps run within five minutes.` : "Live. People enter as the event happens; steps run within five minutes.");
      void refreshActivity();
      router.refresh();
    } finally { setBusy(false); }
  }

  async function pause() {
    setBusy(true); setError(null);
    const r = await setStatus(journey.id, "pause");
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setStatusState("paused");
    toast("Paused. People already inside wait where they are; nothing is sent until you go live again.");
    void refreshPreview();
  }

  async function remove() {
    if (!(await confirm({ title: "Remove this journey?", body: "A journey that never ran is deleted. One with history is archived so its log stays readable.", confirmLabel: "Remove", tone: "danger" }))) return;
    const r = await removeJourney(journey.id);
    if (!r.ok) { setError(r.error); return; }
    router.push(ROUTES.marketingJourneys);
  }

  async function runTry() {
    if (!picked) return;
    setTracing(true); setError(null);
    const r = await simulate(journey.id, picked.id, def);
    setTracing(false);
    if (!r.ok) { setError(r.error); return; }
    setTrace(r.data);
  }

  const condition = def.trigger.condition;
  const condChoice = !condition ? "none" : condition.field === "object_type" ? String(condition.value) : "amount";
  const isQuote = def.trigger.event.startsWith("quote.");
  const setCondition = (choice: string, amount?: number) => patchDef((d) => ({
    ...d, trigger: { ...d.trigger, condition: choice === "none" ? null : choice === "amount" ? { field: "payload.total", op: "gte", value: amount ?? 50000 } : { field: "object_type", op: "eq", value: choice } },
  }));

  const entry = explainEntry(def);
  const versionLabel = (id: string | null) => versions.find((v) => v.id === id)?.label ?? (id ? "A kept version" : "");
  // A group in the panel lives under Setup on a phone; on a wide screen the panel is already beside the canvas.
  const showGroup = (s: Sec) => { if (onPhone()) setTab("setup"); setOpen(s); };
  const showCanvas = (t: "build" | "test" | "running") => setTab(t);
  const tour: TourStep[] = [
    { target: "whenSec", text: "Choose what starts the journey. It can come from Sales, Service or a form, not only from marketing.", before: () => showGroup("whenSec") },
    { target: "rulesSec", text: "These rules protect your customers. Consent is always checked again at the moment of sending.", before: () => showGroup("rulesSec") },
    { target: "jnSteps", text: "Each line is a step. Under every step is a plain sentence saying when it fires; the guards chip says what can stop it.", before: () => showCanvas("build") },
    { target: "jnEntry", text: "Before you go live, see who would enter today and read the messages about consent and volume.", before: () => showCanvas("build") },
    { target: "jnTry", text: "Pick a real person and see the exact path and dates they would get, with the reason at every turn. Nothing is sent.", before: () => showCanvas("test") },
    { target: "jnActivity", text: "Once it is live, this shows who is waiting, who is stuck and who was skipped and why. Click a reason to see the people.", before: () => showCanvas("running") },
  ];

  const statusLabel = dirty ? "Unsaved changes" : status === "live" ? "Live" : status === "paused" ? "Paused" : status === "archived" ? "Archived" : "Draft";
  const activeGroup = activity?.skipped.find((g) => g.group === group) ?? null;
  const shownEntrants = preview ? (allEntrants ? preview.entry.first : preview.entry.first.slice(0, SHOWN)) : [];
  const shownGroups = activity ? (allGroups ? activity.skipped : activity.skipped.slice(0, SHOWN)) : [];

  const compiled = useMemo(() => [
    `trigger: ${def.trigger.event}${condition ? `  where ${condition.field} ${condition.op} ${condition.value}` : ""}`,
    `entry:   once per ${def.entry.one_per_account ? "company" : "person"} · pause_when_in_trouble=${def.entry.pause_when_in_trouble} · lookback=${def.entry.lookback_days}d`,
    ...def.steps.map((s, i) => `step ${i + 1}:  ${s.kind}${s.kind === "wait" ? ` ${s.amount} ${s.unit}` : s.kind === "send_newsletter" ? ` version=${s.newsletter_version_id ?? "none"} topic=${s.topic ?? "none"}` : ""}`),
    "runner:  /api/marketing/cron/journeys every 5 min · one row per (run, step, attempt) · consent checked by the send path",
  ].join("\n"), [def, condition]);

  const menuItems: MenuItem[] = [
    { label: "Definition", onSelect: () => setShowDef(true) },
    { label: journey.hasRuns ? "Archive" : "Delete", danger: true, hidden: !canEdit, onSelect: () => void remove() },
  ];
  const primary = live
    ? <Button variant="primary" disabled={!canEdit || busy} loading={busy} onClick={() => void pause()}>Pause</Button>
    : <Button variant="primary" disabled={!canEdit || busy || status === "archived"} loading={busy} onClick={() => void goLive()}>Go live</Button>;
  const saveBtn = <Button disabled={!canEdit || saving || !dirty} loading={saving} onClick={() => void save()}>Save</Button>;

  return (
    <div className={styles.accent} data-tab={tab}>
      <PageHeader
        title={name || "Journey"}
        subtitle={[journey.ref, `${def.steps.length} step${def.steps.length === 1 ? "" : "s"}`, "runs within 5 minutes"].filter(Boolean).join(" · ")}
        badge={<span className={cx(styles.pill, live && !dirty && styles.live, status === "paused" && !dirty && styles.paused)}>{statusLabel}</span>}
        action={
          <span className={styles.headRow}>
            <JourneyTour steps={tour} />
            <span className={styles.headBtns}>{saveBtn}{primary}</span>
            <MoreMenu items={menuItems} />
          </span>
        }
      />

      {!canEdit && <div className={cx(styles.banner, styles.info)}>You can look at this journey but not change it.</div>}
      {live && canEdit && <div className={cx(styles.banner, styles.info)}>It is live, so the steps are locked. Pause it to change them.</div>}
      {error && <div className={styles.err} role="alert">{error}</div>}

      {showDef && (
        <div className={styles.utility}>
          <div className={styles.utilHead}>
            <span className="bpm-label-row"><b>Definition</b><InfoTip label="Definition">{JOURNEY_TIPS.definition}</InfoTip></span>
            <Button size="sm" variant="quiet" onClick={() => setShowDef(false)}>Close</Button>
          </div>
          <pre className={styles.pre}>{compiled}</pre>
        </div>
      )}

      <div className={styles.stripDesk}><Tabs tabs={CANVAS_TABS} value={canvasTab} onChange={(t) => setTab(t as Tab)} label="Journey" /></div>
      <div className={styles.stripPhone}><Tabs tabs={PHONE_TABS} value={tab} onChange={(t) => setTab(t as Tab)} label="Journey sections" /></div>

      <div className={styles.studio}>
        <div className={styles.panel}>
          <OptionGroup id="startSec" title="Name and start" info={JOURNEY_TIPS.start} summary={name || "Unnamed"} open={open === "startSec"} onToggle={() => setOpen(open === "startSec" ? null : "startSec")}>
            <Opt label="Name" info={JOURNEY_TIPS.name} htmlFor="jnName">
              <input id="jnName" className={styles.nameInput} value={name} maxLength={120} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
            </Opt>
            <Opt label="Replace the steps with a template" info={JOURNEY_TIPS.template} htmlFor="jnTpl">
              <select id="jnTpl" className={styles.select} value="" disabled={!editable} onChange={async (e) => {
                const t = templateById(e.target.value);
                if (!t) return;
                if (def.steps.length > 0 && !(await confirm({ title: "Replace the steps?", body: "The steps on screen are replaced. Nothing is lost until you press Save.", confirmLabel: "Replace" }))) return;
                patchDef(() => t.build());
              }}>
                <option value="">Choose a template…</option>
                {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Opt>
          </OptionGroup>

          <OptionGroup id="whenSec" title="When it starts" info={JOURNEY_TIPS.when} summary={TRIGGERS.find((t) => t.event === def.trigger.event)?.label ?? def.trigger.event} open={open === "whenSec"} onToggle={() => setOpen(open === "whenSec" ? null : "whenSec")}>
            <Opt label="It starts when" info={TRIGGERS.find((t) => t.event === def.trigger.event)?.hint} htmlFor="jnTrig">
              <select id="jnTrig" className={styles.select} value={def.trigger.event} disabled={!editable} onChange={(e) => patchDef((d) => ({ ...d, trigger: { event: e.target.value, condition: e.target.value.startsWith("quote.") ? d.trigger.condition : null } }))}>
                {TRIGGERS.map((t) => <option key={t.event} value={t.event}>{t.label}</option>)}
              </select>
            </Opt>
            {isQuote && (
              <Opt label="But only if" info={JOURNEY_TIPS.condition} htmlFor="jnCond">
                <select id="jnCond" className={styles.select} value={condChoice} disabled={!editable} onChange={(e) => setCondition(e.target.value)}>
                  <option value="none">No extra condition</option>
                  {CONDITION_FIELDS[0].choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  <option value="amount">The amount is at least…</option>
                </select>
                {condChoice === "amount" && condition && (
                  <input className={cx(styles.field, styles.num)} type="number" min={0} aria-label="Amount at least" value={Number(condition.value)} disabled={!editable} onChange={(e) => setCondition("amount", Number(e.target.value))} />
                )}
              </Opt>
            )}
            <Opt label="Include the last (days)" info={JOURNEY_TIPS.lookback} htmlFor="jnLook">
              <input id="jnLook" className={cx(styles.field, styles.num)} type="number" min={0} max={MAX_LOOKBACK_DAYS} value={def.entry.lookback_days} disabled={!editable} onChange={(e) => patchDef((d) => ({ ...d, entry: { ...d.entry, lookback_days: Math.max(0, Math.min(MAX_LOOKBACK_DAYS, Number(e.target.value) || 0)) } }))} />
            </Opt>
          </OptionGroup>

          <OptionGroup id="rulesSec" title="Rules" info={JOURNEY_TIPS.rules} summary="Safe defaults" open={open === "rulesSec"} onToggle={() => setOpen(open === "rulesSec" ? null : "rulesSec")}>
            <div className={cx("bpm-label-row", styles.fact)}><b>Re-entry:</b>&nbsp;never<InfoTip label="Re-entry">{JOURNEY_TIPS.reentry}</InfoTip></div>
            <CheckOpt label="One person per company" info={JOURNEY_TIPS.onePerCompany} checked={def.entry.one_per_account} disabled={!editable} onChange={(v) => patchDef((d) => ({ ...d, entry: { ...d.entry, one_per_account: v } }))} />
            <CheckOpt label="Pause when the company is in trouble" info={inTroubleTip(limits.troubleCaseDays)} checked={def.entry.pause_when_in_trouble} disabled={!editable} onChange={(v) => patchDef((d) => ({ ...d, entry: { ...d.entry, pause_when_in_trouble: v } }))} />
            <Opt label="Quiet hours and limits" info={limitsTip(timezone)}>
              <div className={styles.chips}>
                <span className={styles.chip}>No sends {String(limits.quietFromHour).padStart(2, "0")}:00 to {String(limits.quietToHour).padStart(2, "0")}:00</span>
                <span className={styles.chip}>{limits.offWeekdays.length ? `Not on ${limits.offWeekdays.map((d) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d]).join(", ")}` : "Every day allowed"}</span>
                <span className={styles.chip}>Max {limits.maxPerDay} email{limits.maxPerDay === 1 ? "" : "s"} a day per person</span>
              </div>
            </Opt>
          </OptionGroup>
        </div>

        <div className={styles.canvas}>
          {canvasTab === "build" && (<>
            <div className={styles.card} id="jnEntry">
              <div className="bpm-label-row"><h2>Who would enter today</h2><InfoTip label="Who would enter today">{JOURNEY_TIPS.entry}</InfoTip></div>
              {previewing && !preview ? <><div className={styles.skel} /><div className={styles.skel} /></> : live ? (
                <p className={styles.help}>It is live. {entry.fires}</p>
              ) : preview ? (
                <>
                  <div className={styles.row}>
                    <span className={styles.big}>{preview.entry.at_least ? `${preview.entry.count}+` : preview.entry.count}</span>
                    <span className={styles.help}>{preview.entry.lookback_days > 0 ? `people from events in the last ${preview.entry.lookback_days} day${preview.entry.lookback_days === 1 ? "" : "s"} who are not already in it` : "Only new events enter, so nobody enters today"}</span>
                  </div>
                  {preview.entry.first.length > 0 && (
                    <div className={styles.chips}>
                      {shownEntrants.map((p, i) => <span key={`${p.contact_id}-${i}`} className={styles.chip}>{p.contact_name}{p.account_name ? ` · ${p.account_name}` : ""}</span>)}
                      {preview.entry.first.length > SHOWN && <button type="button" className={cx(styles.chip, styles.n, styles.chipBtn)} onClick={() => setAllEntrants((v) => !v)}>{allEntrants ? "Show fewer" : `Show all (${preview.entry.first.length})`}</button>}
                      {allEntrants && preview.entry.count > preview.entry.first.length && <span className={cx(styles.chip, styles.n)}>+{preview.entry.count - preview.entry.first.length} more</span>}
                    </div>
                  )}
                  <p className={styles.help}>{entry.fires}</p>
                </>
              ) : <p className={styles.help}>{entry.fires}</p>}
              {!live && preview && preview.checks.length > 0 && (
                <div className={styles.checks} aria-live="polite">
                  {preview.checks.map((c, i) => <div key={i} className={cx(styles.check, c.level === "stop" && styles.stop, (c.level === "confirm" || c.level === "warn") && styles.warn)}>{c.text}</div>)}
                </div>
              )}
            </div>

            <div className={styles.card} id="jnSteps">
              <div className="bpm-label-row"><h2>The journey</h2><InfoTip label="The journey">{JOURNEY_TIPS.steps}</InfoTip></div>
              <ol className={styles.steps}>
                {def.steps.map((s, i) => {
                  const why = explainStep(def, i, limits, { topicLabel });
                  const guards = guardSummary(def, i, limits, { topicLabel });
                  const stepLanguages = s.kind === "send_newsletter" && s.newsletter_version_id ? versions.find((v) => v.id === s.newsletter_version_id)?.languages ?? [] : [];
                  return (
                    <li key={s.id} className={styles.step}>
                      <div className={styles.stepHead}>
                        <span className={styles.stepNo}>{i + 1}</span>
                        <span className={styles.stepTitle}>{s.kind === "send_newsletter" ? "Send a newsletter version" : s.kind === "wait" ? "Wait" : s.kind === "create_task" ? "Create a task for the owner" : s.kind === "notify_owner" ? "Notify the owner" : describeStep(s)}</span>
                        <span className={styles.tools}>
                          <button type="button" className={styles.ic} aria-label="Move up" disabled={!editable || i === 0} onClick={() => moveStep(i, -1)}><Icon d={UP} /></button>
                          <button type="button" className={styles.ic} aria-label="Move down" disabled={!editable || i === def.steps.length - 1} onClick={() => moveStep(i, 1)}><Icon d={DOWN} /></button>
                          <button type="button" className={styles.ic} aria-label="Remove step" disabled={!editable} onClick={() => patchDef((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))}><Icon d={TRASH} /></button>
                        </span>
                      </div>
                      {s.kind === "wait" && (
                        <div className={styles.stepBody}>
                          <input className={cx(styles.field, styles.num)} type="number" min={1} aria-label="How long" value={s.amount} disabled={!editable} onChange={(e) => setStep(i, { amount: Math.max(1, Number(e.target.value) || 1) })} />
                          <select className={styles.select} style={{ width: "auto" }} aria-label="Unit" value={s.unit} disabled={!editable} onChange={(e) => setStep(i, { unit: e.target.value as "hours" | "days" })}><option value="hours">hours</option><option value="days">days</option></select>
                        </div>
                      )}
                      {s.kind === "send_newsletter" && (
                        <div className={styles.stepBody}>
                          {studioOn ? (
                            <select className={styles.select} style={{ flex: "1 1 220px", width: "auto" }} aria-label="Newsletter version" value={s.newsletter_version_id ?? ""} disabled={!editable} onChange={(e) => setStep(i, { newsletter_version_id: e.target.value || null })}>
                              <option value="">Choose a kept newsletter version…</option>
                              {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                              {s.newsletter_version_id && !versions.some((v) => v.id === s.newsletter_version_id) && <option value={s.newsletter_version_id}>{versionLabel(s.newsletter_version_id)}</option>}
                            </select>
                          ) : <span className={styles.help}>The Newsletter Studio is not switched on for this workspace, so there is nothing to send yet.</span>}
                          <select className={styles.select} style={{ width: "auto" }} aria-label="Consent topic" value={s.topic ?? ""} disabled={!editable} onChange={(e) => setStep(i, { topic: e.target.value || null })}>
                            <option value="">Any consent topic</option>
                            {topics.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                          </select>
                        </div>
                      )}
                      {s.kind === "create_task" && (
                        <div className={styles.stepBody}>
                          <input className={styles.field} style={{ flex: "1 1 240px", width: "auto" }} aria-label="Task" value={s.title} maxLength={120} disabled={!editable} onChange={(e) => setStep(i, { title: e.target.value })} />
                          <span className={styles.help}>due in</span>
                          <input className={cx(styles.field, styles.num)} type="number" min={0} max={60} aria-label="Due in days" value={s.due_in_days} disabled={!editable} onChange={(e) => setStep(i, { due_in_days: Math.max(0, Number(e.target.value) || 0) })} />
                          <span className={styles.help}>days</span>
                        </div>
                      )}
                      {s.kind === "notify_owner" && (
                        <div className={styles.stepBody}>
                          <input className={styles.field} style={{ flex: "1 1 240px", width: "auto" }} aria-label="What to tell the owner" value={s.text} maxLength={200} disabled={!editable} onChange={(e) => setStep(i, { text: e.target.value })} />
                        </div>
                      )}
                      {(why.fires || guards.count > 0 || stepLanguages.length > 0) && (
                        <div className={styles.why}>
                          {why.fires}
                          {stepLanguages.length > 0 && <span className={cx(styles.chip, styles.g, styles.chipTip)}>{stepLanguages.map((l) => l.toUpperCase()).join(" · ")}<InfoTip label={`languages on step ${i + 1}`}>{JOURNEY_TIPS.languages}</InfoTip></span>}
                          {guards.count > 0 && <span className={cx(styles.chip, styles.n, styles.chipTip)}>{`${guards.count} guard${guards.count === 1 ? "" : "s"}`}<InfoTip label={`guards on step ${i + 1}`}>{guards.text}</InfoTip></span>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              {def.steps.length === 0 && <EmptyState title="No steps yet" text="Add a step, or pick a template in Setup." />}
              <div className={styles.add}>
                {ADDABLE.map((a) => <button key={a.kind} type="button" className={styles.stepBtn} disabled={!editable || def.steps.length >= MAX_STEPS} onClick={() => patchDef((d) => ({ ...d, steps: [...d.steps, newStep(a.kind, d.steps)] }))}>{a.label}</button>)}
              </div>
            </div>
          </>)}

          {canvasTab === "test" && (
            <div className={styles.card} id="jnTry">
              <div className="bpm-label-row"><h2>Try it on one person</h2><InfoTip label="Try it on one person">{JOURNEY_TIPS.try}</InfoTip></div>
              <Opt label="Pick someone" info={JOURNEY_TIPS.pick} htmlFor="jnWho">
                <input id="jnWho" className={styles.field} value={picked ? `${picked.name}${picked.account ? ` · ${picked.account}` : ""}` : q} placeholder="Type at least two letters of a name" onChange={(e) => { setPicked(null); setQ(e.target.value); setTrace(null); }} />
              </Opt>
              {!picked && found.length > 0 && (
                <ul className={styles.list} aria-label="People found">
                  {found.map((c) => <li key={c.id}><button type="button" className={styles.group} onClick={() => { setPicked(c); setFound([]); }}>{c.name}{c.account ? ` · ${c.account}` : ""}</button></li>)}
                </ul>
              )}
              <div className={styles.row}><Button variant="primary" size="sm" disabled={!picked || tracing} loading={tracing} onClick={() => void runTry()}>Show the path</Button></div>
              {trace && (
                <ol className={styles.trace} aria-live="polite">
                  {trace.lines.map((l, i) => (
                    <li key={i} className={cx(styles.tl, styles[l.outcome])}>
                      <span className={styles.tlDay}>{l.outcome === "start" ? "Day 0" : `Day ${l.day}`}</span>
                      <span className={styles.tlDot} />
                      <span>
                        <span className={styles.tlTitle}>{l.title}</span>
                        <span className={styles.tlWhy} style={{ display: "block" }}>{l.why}</span>
                        {l.detail && <span className={styles.tlDetail} style={{ display: "block" }}>{l.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {canvasTab === "running" && (
            <div className={styles.card} id="jnActivity">
              <div className="bpm-label-row"><h2>Running</h2><InfoTip label="Running">{JOURNEY_TIPS.running}</InfoTip></div>
              {!activity ? <><div className={styles.skel} /><div className={styles.skel} /></> : activity.missing ? (
                <p className={styles.help}>Waiting for the database update (migrations 0165 to 0169).</p>
              ) : activity.entered === 0 && status === "draft" ? (
                <EmptyState title="Not live yet" text="Go live and people enter as the event happens." action={canEdit ? primary : undefined} />
              ) : (
                <>
                  <div className={styles.kpis}>
                    <div className={styles.kpi}><b>{activity.entered}</b><span>entered</span></div>
                    <div className={styles.kpi}><b>{activity.waiting}</b><span>waiting</span></div>
                    <div className={cx(styles.kpi, activity.stuck > 0 && styles.warn)}><b>{activity.stuck}</b><span>stuck</span></div>
                    <div className={styles.kpi}><b>{activity.skippedTotal}</b><span>skipped or held</span></div>
                    <div className={styles.kpi}><b>{activity.sent}</b><span>emails sent</span></div>
                    <div className={styles.kpi}><b>{activity.tasks}</b><span>tasks created</span></div>
                  </div>
                  {activity.skipped.length > 0 && (
                    <>
                      <div className={styles.groups} role="group" aria-label="Skipped, by reason">
                        {shownGroups.map((g) => <button key={g.group} type="button" className={styles.group} aria-pressed={group === g.group} onClick={() => setGroup(group === g.group ? null : g.group)}>{g.label} · {g.count}</button>)}
                        {activity.skipped.length > SHOWN && <button type="button" className={styles.group} onClick={() => setAllGroups((v) => !v)}>{allGroups ? "Show fewer" : `Show all (${activity.skipped.length})`}</button>}
                      </div>
                      {activeGroup && (
                        <ul className={styles.list} aria-label={`People: ${activeGroup.label}`}>
                          {activeGroup.people.map((p) => <li key={`${p.run_id}-${p.reason}`}><b>{p.contact_name}{p.account_name ? ` · ${p.account_name}` : ""}</b><span>{p.reason_label}{p.held ? " (waiting, will retry)" : ""}</span></li>)}
                        </ul>
                      )}
                    </>
                  )}
                  {activity.task_list.length > 0 && (
                    <div>
                      <span className={styles.lbl}>Tasks for the owner</span>
                      <ul className={styles.list}>
                        {activity.task_list.map((t) => (
                          <li key={t.id}><b>{t.title}</b><span>{t.due_on ? `due ${t.due_on}` : ""} · {t.status === "done" ? "done" : t.unassigned ? "unassigned" : t.mine ? "yours" : "assigned"}{t.status === "open" && (t.mine || t.unassigned) && <> · <button type="button" className={styles.group} onClick={async () => { await completeTask(t.id); void refreshActivity(); }}>Mark done</button></>}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <details className={styles.fold}>
                    <summary>Run log <small>{activity.log.length} most recent</small></summary>
                    <div className={styles.foldIn}>
                      {activity.log.length === 0 ? <p className={styles.help}>Nobody has entered yet.</p> : (
                        <div className={styles.scroll}>
                          <table className={styles.logTable}>
                            <thead><tr><th>Who</th><th>Where they are</th><th>Entered</th><th>What happened</th></tr></thead>
                            <tbody>
                              {activity.log.map((r) => (
                                <tr key={r.run_id}>
                                  <td>{r.contact_name}{r.account_name ? <><br /><span className={styles.help}>{r.account_name}</span></> : null}</td>
                                  <td>{r.where}<br /><span className={styles.help}>{r.status === "stuck" ? "Stuck" : r.status === "waiting" && r.next_due_at ? `Next ${fmtWhen(r.next_due_at)}` : r.status === "done" ? "Done" : r.status === "exited" ? "Left" : ""}</span></td>
                                  <td>{fmtWhen(r.entered_at)}</td>
                                  <td>{r.note && <div>{r.note}</div>}{r.steps.map((s, i) => <div key={i} className={styles.help}>{s.sent ? "Sent" : s.status === "skipped" ? "Skipped" : s.status === "failed" ? "Failed" : "Done"}: {s.title}{s.label && s.label !== "Done" && s.label !== "Sent" ? ` (${s.label})` : ""}</div>)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div className={styles.row}><Button size="sm" onClick={() => void refreshActivity()}>Refresh</Button></div>
                    </div>
                  </details>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles.bar}>{saveBtn}{primary}</div>
      {toastText && <div className={styles.toast} role="status">{toastText}</div>}
    </div>
  );
}
