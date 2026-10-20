"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import {
  CHANGE_KINDS, CHANGE_KIND_HINT, CHANGE_KIND_LABEL, EFFORT_LABEL, type ChangeKind,
} from "@/lib/studio/types";
import { studioApi, STUDIO_BASE, useStepRunner, type StepProps } from "./studioClient";
import { Head, OptionGroup, Opt, Switch, Tuck, cx } from "./ui";
import styles from "./studio.module.css";

export default function ChangesStep({ bundle, canEdit, toast, refresh }: StepProps) {
  const { study, changes, steps } = bundle;
  const [kinds, setKinds] = useState<Record<ChangeKind, boolean>>({ setting: true, own_fields: true, extension: true, new_build: true, integration: true });
  const [showHidden, setShowHidden] = useState(true);
  const [draft, setDraft] = useState<{ kind: ChangeKind; title: string; plain: string }>({ kind: "setting", title: "", plain: "" });
  const [adding, setAdding] = useState(false);
  const { run, busy } = useStepRunner(study.id, toast);

  const stepName = new Map(steps.map((s) => [s.id, s.name]));
  const list = changes.filter((c) => kinds[c.kind] && (showHidden || c.kept));

  async function setKept(id: string, kept: boolean) {
    const res = await studioApi("PATCH", `${STUDIO_BASE}/${study.id}/changes/${id}`, { kept });
    if (!res.ok) toast(res.error);
    refresh();
  }

  async function remove(id: string) {
    const res = await studioApi("DELETE", `${STUDIO_BASE}/${study.id}/changes/${id}`);
    if (!res.ok) toast(res.error);
    refresh();
  }

  async function add() {
    if (!draft.title.trim()) { toast("Give the change a title."); return; }
    setAdding(true);
    const res = await studioApi("POST", `${STUDIO_BASE}/${study.id}/changes`, { add: true, ...draft });
    setAdding(false);
    if (!res.ok) { toast(res.error); return; }
    setDraft({ kind: "setting", title: "", plain: "" });
    refresh();
  }

  return (
    <>
      <aside className={styles.panel} aria-label="Options">
        <OptionGroup id="p4kinds" title="Kinds of change" hint="The only five kinds there are. Untick a kind to hide those cards." defaultOpen>
          <div style={{ display: "grid", gap: 8 }}>
            {CHANGE_KINDS.map((k) => (
              <label key={k} className={styles.chk}>
                <input type="checkbox" checked={kinds[k]} onChange={(e) => setKinds((cur) => ({ ...cur, [k]: e.target.checked }))} />
                <span><b style={{ fontWeight: 600 }}>{CHANGE_KIND_LABEL[k]}</b><br /><span className={styles.help}>{CHANGE_KIND_HINT[k]}</span></span>
              </label>
            ))}
          </div>
        </OptionGroup>

        <OptionGroup title="More" hint="Hidden cards, and changes you add yourself.">
          <Switch label="Show hidden changes" checked={showHidden} onChange={setShowHidden} hint="Cards you marked we can live without this stay listed, greyed out." />
          {canEdit && (
            <>
              <Opt label="Add a change" htmlFor="psd-ck" hint="Something you want that we did not list. Plain words are fine.">
                <Select id="psd-ck" value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as ChangeKind }))}>
                  {CHANGE_KINDS.map((k) => <option key={k} value={k}>{CHANGE_KIND_LABEL[k]}</option>)}
                </Select>
                <Input aria-label="Title" placeholder="Title" value={draft.title} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
                <Textarea aria-label="What you want" placeholder="What you want, in your own words" rows={2} value={draft.plain} maxLength={400} onChange={(e) => setDraft((d) => ({ ...d, plain: e.target.value }))} />
              </Opt>
              <Button size="sm" loading={adding} onClick={() => void add()}>Add this change</Button>
              <Opt label="Propose again" hint="Rework the cards we proposed from the current fit report. Changes you added stay.">
                <Button size="sm" loading={busy === "changes"} onClick={() => void run("changes")}>Propose again</Button>
              </Opt>
            </>
          )}
        </OptionGroup>

        <Tuck title="What the effort bands mean">
          <p style={{ margin: 0 }}>
            <b>Small</b>: a setting or your own fields; hours, done during setup. <b>Medium</b>: a change only for your workspace, or an existing connector; days.{" "}
            <b>Large</b>: something new in the product or a new integration; weeks, discussed on the call.
          </p>
          <p className={styles.help} style={{ margin: 0 }}>Bands follow the kind of change; they are not guessed. Indicative, never a price.</p>
        </Tuck>
      </aside>

      <div className={styles.work}>
        <Head title="What we'd change" sub="One card for every partly or not covered line. Hide any you can live without." />
        {list.length === 0 ? (
          <Card><p className={styles.empty} style={{ margin: 0 }}>
            <b>Nothing to change.</b><br />Every step is standard or needs only setup, or your filters hide the rest.
          </p></Card>
        ) : (
          <div id="changes" className={styles.changes}>
            {list.map((c) => {
              const names = c.step_ids.map((id) => stepName.get(id)).filter(Boolean).join(" · ");
              return (
                <div key={c.id} className={cx(styles.chg, !c.kept && styles.off)}>
                  <div className={styles.chgTop}>
                    <span className={cx(styles.pill, styles.grey)}>{CHANGE_KIND_LABEL[c.kind]}</span>
                    <span className={styles.band}>{EFFORT_LABEL[c.effort_band]}</span>
                  </div>
                  <b>{c.title}</b>
                  {c.plain && <p style={{ margin: 0 }}>{c.plain}</p>}
                  {c.alternative && <div className={styles.alt}>Without it: {c.alternative}</div>}
                  <div className={styles.links}>For: {names || (c.client_added ? "your own request" : "the whole process")}</div>
                  {canEdit && (
                    <div className={styles.act}>
                      {c.client_added && <Button size="sm" variant="quiet" onClick={() => void remove(c.id)}>Delete</Button>}
                      <Button size="sm" variant="quiet" onClick={() => void setKept(c.id, !c.kept)}>{c.kept ? "We can live without this" : "Put back"}</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
