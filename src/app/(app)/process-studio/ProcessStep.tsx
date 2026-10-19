"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { lanesOf } from "@/lib/studio/summary";
import { AREA_IDS, AREA_META, type AreaId, type StepRow } from "@/lib/studio/types";
import { studioApi, STUDIO_BASE, type StepProps } from "./studioClient";
import { Head, OptionGroup, Opt, Switch, Tuck, cx } from "./ui";
import styles from "./studio.module.css";

export default function ProcessStep({ bundle, canEdit, toast, refresh }: StepProps) {
  const { study, steps } = bundle;
  const [showAssumed, setShowAssumed] = useState(true);
  const [showHand, setShowHand] = useState(true);
  const [newRole, setNewRole] = useState("");
  const [draft, setDraft] = useState<{ area: AreaId; lane: string; name: string; how: string }>({ area: "sales", lane: "", name: "", how: "" });
  const [adding, setAdding] = useState(false);

  const lanes = lanesOf(steps, study.lanes);
  const areasInUse = AREA_IDS.filter((a) => steps.some((s) => s.area === a));
  const visible = steps.filter((s) => showAssumed || !s.assumed);

  async function savePatch(id: string, patch: Record<string, unknown>) {
    const res = await studioApi("PATCH", `${STUDIO_BASE}/${study.id}/steps/${id}`, patch);
    if (!res.ok) toast(res.error);
    refresh();
  }

  async function removeStep(id: string) {
    const res = await studioApi("DELETE", `${STUDIO_BASE}/${study.id}/steps/${id}`);
    if (!res.ok) toast(res.error); else toast("Step removed.");
    refresh();
  }

  async function addRole() {
    const name = newRole.trim();
    if (!name) return;
    const res = await studioApi("PATCH", `${STUDIO_BASE}/${study.id}`, { lanes: [...study.lanes, name] });
    if (!res.ok) toast(res.error); else setNewRole("");
    refresh();
  }

  async function addStep() {
    if (!draft.name.trim()) { toast("Name the step first."); return; }
    setAdding(true);
    const res = await studioApi("POST", `${STUDIO_BASE}/${study.id}/steps`, {
      area: draft.area, lane: draft.lane || lanes[0] || "Team", name: draft.name, how_today: draft.how,
    });
    setAdding(false);
    if (!res.ok) { toast(res.error); return; }
    setDraft((d) => ({ ...d, name: "", how: "" }));
    refresh();
  }

  function startAdd(lane: string, area: AreaId) {
    setDraft((d) => ({ ...d, lane, area }));
    const group = document.getElementById("p2add");
    if (group instanceof HTMLDetailsElement) group.open = true;
    group?.scrollIntoView({ block: "nearest" });
  }

  const card = (s: StepRow, showLane: boolean) => (
    <div key={s.id} className={cx(styles.pstep, s.assumed && styles.assumed)}>
      <input
        key={`${s.id}:${s.name}`} className={styles.stepName} defaultValue={s.name} aria-label="Step name" readOnly={!canEdit} maxLength={120}
        onBlur={(e) => { const v = e.target.value.trim(); if (canEdit && v && v !== s.name) void savePatch(s.id, { name: v }); else e.target.value = s.name; }}
      />
      <span className={styles.stepMeta}>
        {s.how_today || "How it is done today: not said"}{showLane ? ` · ${s.lane}` : ""}
        {s.assumed && <> · <em className={styles.assumedTag}>assumed</em></>}
      </span>
      {showHand && s.hands_over && <span className={styles.hand} title="Hands over to another role">&rarr;</span>}
      {canEdit && (
        <div className={styles.stepTools}>
          <Select aria-label="Role" value={s.lane} onChange={(e) => void savePatch(s.id, { lane: e.target.value })} style={{ fontSize: 12, padding: "2px 6px", height: 28 }}>
            {lanes.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
          <Button size="sm" variant="quiet" onClick={() => void removeStep(s.id)} aria-label={`Remove step ${s.name}`}>Remove</Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <aside className={styles.panel} aria-label="Options">
        <OptionGroup id="p2roles" title="Roles" hint="The people who do the work, one row each. Each role is a lane on the map." defaultOpen>
          <div className={styles.roles}>
            {lanes.map((l) => (
              <div key={l} className={styles.role}><span>{l}</span><span className={styles.help}>{steps.filter((s) => s.lane === l).length} steps</span></div>
            ))}
          </div>
          {canEdit && (
            <Opt label="Add a role" htmlFor="psd-role" hint="Name it the way you call the job, for example Yard supervisor.">
              <div style={{ display: "flex", gap: 6 }}>
                <Input id="psd-role" value={newRole} maxLength={60} onChange={(e) => setNewRole(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addRole(); } }} />
                <Button size="sm" onClick={() => void addRole()}>Add</Button>
              </div>
            </Opt>
          )}
        </OptionGroup>

        <OptionGroup title="Map options" hint="What the map shows.">
          <Switch label="Show assumed steps" checked={showAssumed} onChange={setShowAssumed} hint="Steps we added because the order needed them. Dashed border; remove any that are wrong." />
          <Switch label="Show hand-overs" checked={showHand} onChange={setShowHand} hint="An arrow where a step passes work to another role." />
        </OptionGroup>

        {canEdit && (
          <OptionGroup id="p2add" title="Add a step" hint="Something we missed. You name it and say how it is done today.">
            <Opt label="Area" htmlFor="psd-area" hint="Which part of the business it belongs to.">
              <Select id="psd-area" value={draft.area} onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value as AreaId }))}>
                {AREA_IDS.map((a) => <option key={a} value={a}>{AREA_META[a].label}</option>)}
              </Select>
            </Opt>
            <Opt label="Role" htmlFor="psd-lane" hint="Who does it.">
              <Select id="psd-lane" value={draft.lane || lanes[0] || ""} onChange={(e) => setDraft((d) => ({ ...d, lane: e.target.value }))}>
                {(lanes.length ? lanes : ["Team"]).map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </Opt>
            <Opt label="Step" htmlFor="psd-name" hint="A short verb phrase, for example Send the quote.">
              <Input id="psd-name" value={draft.name} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </Opt>
            <Opt label="How it is done today" htmlFor="psd-how" hint="Email, Excel, WhatsApp, an ERP, paper.">
              <Input id="psd-how" value={draft.how} maxLength={200} onChange={(e) => setDraft((d) => ({ ...d, how: e.target.value }))} />
            </Opt>
            <Button variant="primary" size="sm" loading={adding} onClick={() => void addStep()}>Add step</Button>
          </OptionGroup>
        )}
      </aside>

      <div className={styles.work}>
        <Card padding={12}>
          <div id="w2map">
            <Head title="Your process" sub="Drafted from what you told us. Change any step name or role; it is your map." />
            {steps.length === 0 ? (
              <p className={styles.empty}>No steps yet. Go back to Tell us and press Build my process map.</p>
            ) : (
              <>
                <div className={styles.lanes} style={{ marginTop: 10 }}>
                  <div className={styles.lane} style={{ ["--cols" as string]: areasInUse.length }}>
                    <div />
                    {areasInUse.map((a) => <div key={a} className={styles.colh}>{AREA_META[a].label}</div>)}
                  </div>
                  {lanes.map((l) => (
                    <div key={l} className={styles.lane} style={{ ["--cols" as string]: areasInUse.length }}>
                      <div className={styles.laneWho}>{l}</div>
                      {areasInUse.map((a) => {
                        const cards = visible.filter((s) => s.lane === l && s.area === a);
                        return (
                          <div key={a} className={styles.cell}>
                            {cards.map((s) => card(s, false))}
                            {canEdit && cards.length === 0 && <button type="button" className={styles.addStep} onClick={() => startAdd(l, a)}>+ Add step</button>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className={styles.plist}>
                  {areasInUse.map((a) => {
                    const cards = visible.filter((s) => s.area === a);
                    return cards.length ? (
                      <div key={a}><h3>{AREA_META[a].label}</h3><div style={{ display: "grid", gap: 6 }}>{cards.map((s) => card(s, true))}</div></div>
                    ) : null;
                  })}
                </div>
              </>
            )}
          </div>
        </Card>
        <Tuck title="How we drafted this" note="for the curious">
          <p style={{ margin: 0 }}>
            Every step comes from a sentence in your answers; a step we added because the order needed it is marked assumed. Roles are the lanes you named. Nothing here judges BPMSquare yet. That is the next step.
          </p>
        </Tuck>
      </div>
    </>
  );
}
