"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import SettingsList, { ListBar } from "@/components/settings/SettingsList";
import { Notice } from "../middleware/ui";
import { call, messageOf } from "./api";
import {
  blankLeave, CATEGORY_LABEL, leaveDraftFrom, leaveInUse, leavePayload, leaveProblem, leaveUsage, type LeaveCategory, type LeaveDraft, type LeaveType,
} from "./logic";
import { More, SwitchRow } from "./parts";
import { WORKFORCE_TIPS as T } from "./tips";
import s from "./workforce.module.css";

/** What people can request time off as: one row per type, the name opens the panel. Carry-forward is the one rule above it. */
export default function LeaveTab({ carryForward, onCarryForward }: { carryForward: boolean; onCarryForward: (v: boolean) => void }) {
  const { confirm } = useFeel();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onChanged = useCallback(async () => {
    try { setTypes(await call<LeaveType[]>("/api/wfm/leave-types")); setLoadError(null); } catch (e) { setLoadError(messageOf(e)); }
  }, []);
  useEffect(() => { void onChanged(); }, [onChanged]);
  const [openId, setOpenId] = useState<string | "new" | null>(null);
  const open = openId && openId !== "new" ? types.find((x) => x.id === openId) ?? null : null;

  return (
    <div className={s.shell}>
      <div className={s.bar}>
        <div className={s.barStart}>
          <SwitchRow label="Unused leave carries forward" info={T.carryForward} checked={carryForward} onChange={onCarryForward} />
        </div>
        <Button variant="primary" onClick={() => setOpenId("new")}>+ New leave type</Button>
      </div>
      {loadError && <Notice tone="err">{loadError}</Notice>}
      <SettingsList
        label="Leave types"
        headers={["Category", "Quota", "In use"]}
        rows={types.map((x) => ({
          key: x.id,
          title: x.name,
          dim: !x.active,
          cells: [CATEGORY_LABEL[x.category] ?? x.category, `${x.annual_quota} a ${x.quota_period === "month" ? "month" : "year"}`, leaveUsage(x)],
        }))}
        onOpen={setOpenId}
        empty="No leave types yet. Until one exists, nobody can request leave."
      />
      {(openId === "new" || open) && (
        <LeavePanel
          key={openId}
          type={open}
          onClose={() => setOpenId(null)}
          onSaved={async () => { setOpenId(null); await onChanged(); }}
          onDelete={async (x) => {
            const ok = await confirm({ title: `Delete "${x.name}"?`, body: "It has no leave records or requests, so nothing else refers to it. This cannot be undone.", tone: "danger" });
            if (!ok) return null;
            try { await call(`/api/wfm/leave-types/${x.id}`, "DELETE"); } catch (e) { return messageOf(e); }
            setOpenId(null);
            await onChanged();
            return null;
          }}
        />
      )}
    </div>
  );
}

function LeavePanel({ type, onClose, onSaved, onDelete }: {
  type: LeaveType | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDelete: (t: LeaveType) => Promise<string | null>;
}) {
  const [d, setD] = useState<LeaveDraft>(() => (type ? leaveDraftFrom(type) : blankLeave()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<LeaveDraft>) => setD((x) => ({ ...x, ...p }));

  async function save() {
    const problem = leaveProblem(d);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    try {
      await (type ? call(`/api/wfm/leave-types/${type.id}`, "PATCH", leavePayload(d, false)) : call("/api/wfm/leave-types", "POST", leavePayload(d, true)));
      await onSaved();
    } catch (e) {
      setError(messageOf(e)); setSaving(false);
    }
  }

  // A type with history can be switched off but never deleted, so Delete only appears while nothing refers to it.
  const canDelete = type !== null && leaveInUse(type) === 0;

  return (
    <SidePanel
      title={type ? type.name : "New leave type"}
      onClose={onClose}
      footer={
        <>
          {type && canDelete && <Button variant="danger" className={s.pushStart} disabled={saving} onClick={async () => { const m = await onDelete(type); if (m) setError(m); }}>Delete</Button>}
          {error && <span role="alert" className={`${s.issue} ${s.footIssue}`}>{error}</span>}
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <div className={s.stack}>
        <Field label="Name"><Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Paid leave" autoFocus /></Field>
        <Field label="Category">
          <Select value={d.category} onChange={(e) => set({ category: e.target.value as LeaveCategory })}>
            {(Object.keys(CATEGORY_LABEL) as LeaveCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
          </Select>
        </Field>
        <div className={s.fields}>
          <Field label="Days" info={T.leaveQuota}><Input type="number" min={0} step="0.5" value={d.quota} onChange={(e) => set({ quota: e.target.value })} /></Field>
          <Field label="Per">
            <Select value={d.per} onChange={(e) => set({ per: e.target.value as "year" | "month" })}>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </Select>
          </Field>
        </div>
        {type && <SwitchRow label="Active" checked={d.active} onChange={(active) => set({ active })} />}
        <More>
          <div className={s.stack}>
            {d.per === "year" && (
              <Field label="Most days in a month" info={T.leaveMax}><Input type="number" min={0.5} max={31} step="0.5" placeholder="No cap" value={d.maxMonth} onChange={(e) => set({ maxMonth: e.target.value })} /></Field>
            )}
            <Field label="Paid days a month" info={T.leavePaid}><Input type="number" min={0} max={31} step="0.5" placeholder="All" value={d.paidDays} onChange={(e) => set({ paidDays: e.target.value })} /></Field>
          </div>
        </More>
      </div>
    </SidePanel>
  );
}
