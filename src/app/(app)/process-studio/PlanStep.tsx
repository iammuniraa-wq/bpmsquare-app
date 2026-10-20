"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { schedulePhases, todayIso, totalWorkingDays } from "@/lib/studio/plan";
import {
  OWNER_LABEL, PHASES, PHASE_LABEL, WEEKENDS, WEEKEND_LABEL,
  type PhaseId, type TaskOwner, type TaskRow, type Weekend,
} from "@/lib/studio/types";
import { studioApi, STUDIO_BASE, useStepRunner, type StepProps } from "./studioClient";
import { Head, OptionGroup, Opt, Switch, cx } from "./ui";
import styles from "./studio.module.css";

const fmt = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

type Added = { key: string; phase: PhaseId; name: string; owner: TaskOwner; duration_days: number };

export default function PlanStep(p: StepProps) {
  // The draft is initialised from what is stored; it is rebuilt (by key) whenever the stored plan changes.
  const sig = JSON.stringify([p.bundle.tasks.map((t) => [t.id, t.duration_days, t.owner]), p.bundle.comments.map((c) => [c.id, c.text, c.phase_ok]), p.bundle.study.plan_start_date, p.bundle.study.weekend]);
  return <PlanInner key={sig} {...p} />;
}

function PlanInner({ bundle, canEdit, toast, refresh }: StepProps) {
  const { study, tasks, comments } = bundle;
  const { run, busy } = useStepRunner(study.id, toast);

  const [start, setStart] = useState(study.plan_start_date ?? todayIso());
  const [weekend, setWeekend] = useState<Weekend>(study.weekend);
  const [onlyMine, setOnlyMine] = useState(false);
  const [dur, setDur] = useState<Record<string, number>>({});
  const [owners, setOwners] = useState<Record<string, TaskOwner>>({});
  const initialOk = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const c of [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at))) if (c.phase_ok !== null) m[c.phase] = c.phase_ok === true;
    return m;
  }, [comments]);
  const [oks, setOks] = useState<Record<string, boolean>>({});
  const [cmts, setCmts] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Added[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [newTask, setNewTask] = useState<Record<string, { name: string; days: number; owner: TaskOwner }>>({});

  const dirty = start !== (study.plan_start_date ?? todayIso()) || weekend !== study.weekend || Object.keys(dur).length + Object.keys(owners).length + Object.keys(oks).length + Object.keys(cmts).length + added.length + removed.length > 0;

  const storedComment = (phase: string, taskId: string | null): string =>
    comments.find((c) => c.text && c.phase === phase && (c.task_id ?? null) === taskId)?.text ?? "";
  const cKey = (phase: string, taskId: string | null) => `${phase}|${taskId ?? ""}`;
  const commentValue = (phase: string, taskId: string | null): string => cmts[cKey(phase, taskId)] ?? storedComment(phase, taskId);

  const live: (TaskRow & { key: string })[] = [
    ...tasks.filter((t) => !removed.includes(t.id)).map((t) => ({ ...t, key: t.id, duration_days: dur[t.id] ?? t.duration_days, owner: owners[t.id] ?? t.owner })),
    ...added.map((a, i) => ({ id: a.key, key: a.key, phase: a.phase, sort_order: 100000 + i, name: a.name, owner: a.owner, duration_days: a.duration_days, milestone: false, from_template: false, client_added: true })),
  ];
  const phases = schedulePhases(live, start, weekend);
  const total = totalWorkingDays(phases);
  const span = (ph: PhaseId) => phases.find((x) => x.phase === ph);
  const okOf = (ph: string) => oks[ph] ?? initialOk[ph] ?? false;

  async function save() {
    setSaving(true);
    const body = {
      start_date: start, weekend,
      durations: Object.entries(dur).filter(([id]) => tasks.some((t) => t.id === id)).map(([task_id, duration_days]) => ({ task_id, duration_days })),
      owners: Object.entries(owners).filter(([id]) => tasks.some((t) => t.id === id)).map(([task_id, owner]) => ({ task_id, owner })),
      oks: Object.entries(oks).map(([phase, ok]) => ({ phase, ok })),
      comments: Object.entries(cmts).map(([k, text]) => { const [phase, tid] = k.split("|"); return { phase, task_id: tid || null, text }; }),
      added: added.map((a) => ({ phase: a.phase, name: a.name, owner: a.owner, duration_days: a.duration_days })),
      removed,
    };
    const res = await studioApi("PATCH", `${STUDIO_BASE}/${study.id}/plan`, body);
    setSaving(false);
    if (!res.ok) { toast(res.error); return; }
    toast("Plan saved.");
    refresh();
  }

  const phaseList = PHASES.filter((ph) => live.some((t) => t.phase === ph));

  return (
    <>
      <aside className={styles.panel} aria-label="Options">
        <OptionGroup id="p5dates" title="Dates and view" hint="Start date and weekend; every date in the plan follows." defaultOpen>
          <Opt label="Start date" htmlFor="psd-start" hint="When you would like to begin. Every date in the plan moves with it.">
            <Input id="psd-start" type="date" value={start} disabled={!canEdit} onChange={(e) => e.target.value && setStart(e.target.value)} />
          </Opt>
          <Opt label="Weekend" htmlFor="psd-weekend" hint="Days we skip when counting working days.">
            <Select id="psd-weekend" value={weekend} disabled={!canEdit} onChange={(e) => setWeekend(e.target.value as Weekend)}>
              {WEEKENDS.map((w) => <option key={w} value={w}>{WEEKEND_LABEL[w]}</option>)}
            </Select>
          </Opt>
          <Switch label="Only my tasks" checked={onlyMine} onChange={setOnlyMine} hint="Hide BPMSquare's tasks and see just what your team has to do." />
        </OptionGroup>

        <OptionGroup title="Save" hint="Ticks, comments and durations are saved together." defaultOpen>
          <div className={styles.savebar}>
            <Button variant="primary" disabled={!dirty || !canEdit} loading={saving} onClick={() => void save()}>Save</Button>
            {dirty && <span className={styles.unsaved}>Unsaved changes</span>}
          </div>
          {canEdit && (
            <Opt label="Build the plan again" hint="Starts from the standard plan again. Tasks you added yourself stay; ticks are cleared.">
              <Button size="sm" loading={busy === "plan"} onClick={() => void run("plan")}>Build again</Button>
            </Opt>
          )}
        </OptionGroup>
      </aside>

      <div className={styles.work}>
        <Head title="Your plan" sub="Phases, tasks and who does what. Tick a phase when it looks right, change a duration, leave a comment anywhere." />
        {live.length === 0 ? (
          <Card><p className={styles.empty} style={{ margin: 0 }}>No plan yet. Press Build my plan on the previous step.</p></Card>
        ) : (
          <>
            <Card>
              <div id="w5gantt">
                <h3 style={{ margin: "0 0 8px", fontSize: 13.5 }}>Timeline</h3>
                <div className={styles.gantt}>
                  {phases.map((s) => {
                    let off = 0;
                    for (const q of phases) { if (q === s) break; off += q.days; }
                    const ms = live.some((t) => t.phase === s.phase && t.milestone);
                    return (
                      <div key={s.phase} className={styles.gr}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{PHASE_LABEL[s.phase]}</span>
                        <div className={styles.gtrack}><div className={cx(styles.gbar, ms && styles.m)} style={{ left: `${(off / total) * 100}%`, width: `${Math.max(1.5, (s.days / total) * 100)}%` }} /></div>
                        <span className={styles.gdt}>{fmt(s.start)} – {fmt(s.end)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className={styles.help} style={{ marginTop: 8 }}>
                  About {total} working days from {phases.length ? fmt(phases[0].start) : fmt(start)} to {phases.length ? fmt(phases[phases.length - 1].end) : fmt(start)}, phases one after another. Change a duration and the dates move. &#9670; marks a milestone. Indicative, confirmed on the call.
                </p>
              </div>
            </Card>

            <div id="phases" style={{ display: "grid", gap: 8 }}>
              {phaseList.map((ph, pi) => {
                const sp = span(ph);
                const mine = live.filter((t) => t.phase === ph);
                const you = mine.filter((t) => t.owner === "client").length;
                const shown = mine.filter((t) => !onlyMine || t.owner === "client");
                const nt = newTask[ph] ?? { name: "", days: 1, owner: "client" as TaskOwner };
                return (
                  <details key={ph} className={styles.phase} open={open[ph] ?? pi === 0} onToggle={(e) => setOpen((o) => ({ ...o, [ph]: (e.target as HTMLDetailsElement).open }))}>
                    <summary>
                      <div className={styles.pt}>
                        <b>{pi + 1}. {PHASE_LABEL[ph]}</b>
                        <span>{mine.length} tasks · {sp?.days ?? 0} working days · {you} for you, {mine.length - you} for BPMSquare</span>
                      </div>
                      <span className={styles.help}>{sp ? `${fmt(sp.start)} → ${fmt(sp.end)}` : ""}</span>
                      <label className={cx(styles.ok, okOf(ph) && styles.on)} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={okOf(ph)} disabled={!canEdit} onChange={(e) => setOks((o) => ({ ...o, [ph]: e.target.checked }))} /> Looks right
                      </label>
                    </summary>
                    <div className={styles.tasks}>
                      {shown.map((t) => (
                        <div key={t.key}>
                          <div className={styles.task}>
                            <div className={styles.taskName}>{t.milestone && <span className={styles.ms}>&#9670;</span>}<span title={t.name}>{t.name}</span></div>
                            {canEdit ? (
                              <Select aria-label={`Owner of ${t.name}`} value={t.owner} onChange={(e) => {
                                const v = e.target.value as TaskOwner;
                                if (added.some((a) => a.key === t.key)) setAdded((l) => l.map((a) => (a.key === t.key ? { ...a, owner: v } : a)));
                                else setOwners((o) => ({ ...o, [t.id]: v }));
                              }} style={{ height: 28, fontSize: 12 }}>
                                <option value="client">{OWNER_LABEL.client}</option>
                                <option value="bpmsquare">{OWNER_LABEL.bpmsquare}</option>
                              </Select>
                            ) : <span className={cx(styles.pill, t.owner === "client" ? styles.you : styles.us)}>{OWNER_LABEL[t.owner]}</span>}
                            <Input type="number" min={1} max={60} value={t.duration_days} disabled={!canEdit} aria-label={`Working days for ${t.name}`} onChange={(e) => {
                              const n = Math.min(60, Math.max(1, Math.round(Number(e.target.value) || 1)));
                              if (added.some((a) => a.key === t.key)) setAdded((l) => l.map((a) => (a.key === t.key ? { ...a, duration_days: n } : a)));
                              else setDur((d) => ({ ...d, [t.id]: n }));
                            }} />
                            <span className={styles.dnum}>{t.duration_days} d</span>
                          </div>
                          {canEdit && t.client_added && (
                            <Button size="sm" variant="quiet" onClick={() => {
                              if (added.some((a) => a.key === t.key)) setAdded((l) => l.filter((a) => a.key !== t.key));
                              else setRemoved((r) => [...r, t.id]);
                            }}>Remove this task</Button>
                          )}
                          {!added.some((a) => a.key === t.key) && (
                            <details style={{ marginTop: 2 }}>
                              <summary className={styles.help} style={{ cursor: "pointer" }}>{commentValue(ph, t.id) ? "Your comment" : "Comment"}</summary>
                              <div className={styles.cmt}>
                                <Textarea aria-label={`Comment on ${t.name}`} rows={2} value={commentValue(ph, t.id)} disabled={!canEdit} maxLength={2000}
                                  onChange={(e) => setCmts((c) => ({ ...c, [cKey(ph, t.id)]: e.target.value }))} />
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                      {canEdit && (
                        <div className={styles.addTask}>
                          <Input aria-label="New task" placeholder="Add a task" value={nt.name} maxLength={120} onChange={(e) => setNewTask((m) => ({ ...m, [ph]: { ...nt, name: e.target.value } }))} />
                          <Select aria-label="Owner" value={nt.owner} onChange={(e) => setNewTask((m) => ({ ...m, [ph]: { ...nt, owner: e.target.value as TaskOwner } }))}>
                            <option value="client">{OWNER_LABEL.client}</option>
                            <option value="bpmsquare">{OWNER_LABEL.bpmsquare}</option>
                          </Select>
                          <Input type="number" min={1} max={60} aria-label="Working days" value={nt.days} onChange={(e) => setNewTask((m) => ({ ...m, [ph]: { ...nt, days: Math.min(60, Math.max(1, Math.round(Number(e.target.value) || 1))) } }))} />
                          <Button size="sm" onClick={() => {
                            if (!nt.name.trim()) return;
                            setAdded((l) => [...l, { key: `new-${l.length}-${Date.now()}`, phase: ph, name: nt.name.trim(), owner: nt.owner, duration_days: nt.days }]);
                            setNewTask((m) => ({ ...m, [ph]: { name: "", days: 1, owner: "client" } }));
                          }}>Add</Button>
                        </div>
                      )}
                      <div className={styles.cmt}>
                        <Textarea aria-label={`Comment on ${PHASE_LABEL[ph]}`} placeholder="A comment on this phase (optional)" rows={2} value={commentValue(ph, null)} disabled={!canEdit} maxLength={2000}
                          onChange={(e) => setCmts((c) => ({ ...c, [cKey(ph, null)]: e.target.value }))} />
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
