"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import SettingsList, { ListBar } from "@/components/settings/SettingsList";
import { useCurrency } from "@/lib/tenant-context";
import { moneyLabel } from "@/lib/currency";
import type { WfmShift } from "@/lib/wfm/types";
import { call, messageOf } from "./api";
import { blankShift, hhmm, shiftDraftFrom, shiftPayload, shiftProblem, type ShiftDraft } from "./logic";
import { SwitchRow } from "./parts";
import { WORKFORCE_TIPS as T } from "./tips";
import s from "./workforce.module.css";

/** Working hours people are measured against: one row per shift, the name opens the panel. */
export default function ShiftsTab({ shifts, onChanged }: { shifts: readonly WfmShift[]; onChanged: () => Promise<void> | void }) {
  const cur = useCurrency();
  const { confirm } = useFeel();
  const [openId, setOpenId] = useState<string | "new" | null>(null);
  const open = openId && openId !== "new" ? shifts.find((x) => x.id === openId) ?? null : null;

  return (
    <div className={s.shell}>
      <ListBar>
        <Button variant="primary" onClick={() => setOpenId("new")}>+ New shift</Button>
      </ListBar>
      <SettingsList
        label="Shifts"
        headers={["Hours", "Grace"]}
        rows={shifts.map((x) => ({
          key: x.id,
          title: <>{x.name}{x.is_night_shift && <span className={s.chip}>Night</span>}</>,
          label: x.name,
          dim: !x.active,
          cells: [`${hhmm(x.start_time)} to ${hhmm(x.end_time)}${x.crosses_midnight ? " (next day)" : ""}`, `${x.grace_minutes} min`],
        }))}
        onOpen={setOpenId}
        empty="No shifts yet. Without one, nobody can be marked late or absent."
      />
      {(openId === "new" || open) && (
        <ShiftPanel
          key={openId}
          shift={open}
          allowanceLabel={moneyLabel("Night allowance", cur)}
          onClose={() => setOpenId(null)}
          onSaved={async () => { setOpenId(null); await onChanged(); }}
          onDelete={async (x) => {
            const ok = await confirm({
              title: `Delete "${x.name}"?`,
              body: "This cannot be undone. If employees or roster days still use it, deletion is blocked until you move them.",
              confirmLabel: "Delete shift",
              tone: "danger",
            });
            if (!ok) return null;
            try { await call(`/api/wfm/shifts/${x.id}`, "DELETE", {}); } catch (e) { return messageOf(e); }
            setOpenId(null);
            await onChanged();
            return null;
          }}
        />
      )}
    </div>
  );
}

function ShiftPanel({ shift, allowanceLabel, onClose, onSaved, onDelete }: {
  shift: WfmShift | null;
  allowanceLabel: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDelete: (s: WfmShift) => Promise<string | null>;
}) {
  const [d, setD] = useState<ShiftDraft>(() => (shift ? shiftDraftFrom(shift) : blankShift()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<ShiftDraft>) => setD((x) => ({ ...x, ...p }));

  async function save() {
    const problem = shiftProblem(d);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    try {
      await (shift ? call(`/api/wfm/shifts/${shift.id}`, "PATCH", shiftPayload(d, false)) : call("/api/wfm/shifts", "POST", shiftPayload(d, true)));
      await onSaved();
    } catch (e) {
      setError(messageOf(e)); setSaving(false);
    }
  }

  return (
    <SidePanel
      title={shift ? shift.name : "New shift"}
      onClose={onClose}
      footer={
        <>
          {shift && <Button variant="danger" className={s.pushStart} disabled={saving} onClick={async () => { const m = await onDelete(shift); if (m) setError(m); }}>Delete</Button>}
          {error && <span role="alert" className={`${s.issue} ${s.footIssue}`}>{error}</span>}
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <div className={s.stack}>
        <Field label="Name"><Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="General shift" autoFocus /></Field>
        <div className={s.fields}>
          <Field label="Start"><Input type="time" value={d.start} onChange={(e) => set({ start: e.target.value })} /></Field>
          <Field label="End"><Input type="time" value={d.end} onChange={(e) => set({ end: e.target.value })} /></Field>
        </div>
        <Field label="Grace (minutes)" info={T.shiftGrace}><Input type="number" min={0} value={d.grace} onChange={(e) => set({ grace: e.target.value })} /></Field>
        <SwitchRow label="Night shift" info={T.shiftNight} checked={d.night} onChange={(night) => set({ night })} />
        {d.night && <Field label={allowanceLabel}><Input type="number" min={0} step="0.01" value={d.allowance} onChange={(e) => set({ allowance: e.target.value })} /></Field>}
        {shift && <SwitchRow label="Active" checked={d.active} onChange={(active) => set({ active })} />}
      </div>
    </SidePanel>
  );
}
