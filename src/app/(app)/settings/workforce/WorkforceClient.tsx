"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import type { WfmConfig, WfmTypeRules } from "@/lib/constants";
import type { WfmShift } from "@/lib/wfm/types";
import { call, messageOf } from "./api";
import { changedConfig, TAB_LABEL, workforceTabs, type WorkforceTab } from "./logic";
import RulesTab, { type TypeFacts } from "./RulesTab";
import ShiftsTab from "./ShiftsTab";
import PlacesTab from "./PlacesTab";
import LeaveTab from "./LeaveTab";
import AlertsTab from "./AlertsTab";
import BillingTab from "./BillingTab";
import s from "./workforce.module.css";

/**
 * Settings > Workforce: six tabs (Billing only when project hours can be invoiced) over one config draft and one Save.
 * Rules, Places (the geofence rule), Leave (carry-forward), Alerts and Billing edit the draft; the three lists
 * (shifts, sites, leave types) save from their own panel. It replaces eight menu pages that wrote the same routes.
 */
export default function WorkforceClient({ initial, projectsOn }: { initial: WfmConfig; projectsOn: boolean }) {
  const tabs = useMemo(() => workforceTabs(projectsOn), [projectsOn]);
  const [tab, setTab] = useUrlTab(tabs);

  const [cfg, setCfg] = useState<WfmConfig>(initial);
  const [saved, setSaved] = useState<WfmConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const [shifts, setShifts] = useState<WfmShift[]>([]);
  const loadShifts = useCallback(async () => {
    try { setShifts(await call<WfmShift[]>("/api/wfm/shifts")); } catch { /* the Shifts tab shows an empty list; the Saturday picker simply has no choices */ }
  }, []);
  useEffect(() => { void loadShifts(); }, [loadShifts]);

  // What sits beside each employment type (people, pending requests, holidays) and the leave types its rules name.
  // Best effort: without it the list simply shows no counts.
  const [facts, setFacts] = useState<TypeFacts | undefined>(undefined);
  useEffect(() => {
    if (tab !== "rules" || facts) return;
    let live = true;
    (async () => {
      const count = (rows: { employment_type?: string | null }[]) => rows.reduce<Record<string, number>>((m, r) => { if (r.employment_type) m[r.employment_type] = (m[r.employment_type] ?? 0) + 1; return m; }, {});
      const [leaveTypes, employees, pendingReqs, holidays] = await Promise.all([
        call<TypeFacts["leaveTypes"]>("/api/wfm/leave-types").catch(() => []),
        call<{ employment_type?: string | null; status?: string }[]>("/api/wfm/employees").catch(() => []),
        call<{ employees?: { employment_type?: string | null } | null }[]>("/api/wfm/leave-requests?status=pending").catch(() => []),
        call<{ applies_to: string }[]>(`/api/wfm/holidays?year=${new Date().getFullYear()}`).catch(() => []),
      ]);
      if (!live) return;
      const holidayCounts: Record<string, number> = {};
      for (const h of holidays) if (h.applies_to !== "all") holidayCounts[h.applies_to] = (holidayCounts[h.applies_to] ?? 0) + 1;
      setFacts({
        leaveTypes,
        people: count(employees.filter((e) => e.status === "active" || e.status === undefined)),
        pending: count(pendingReqs.map((r) => ({ employment_type: r.employees?.employment_type }))),
        holidays: holidayCounts,
      });
    })();
    return () => { live = false; };
  }, [tab, facts]);
  const rulesApplied = (type_rules: Record<string, WfmTypeRules>) => {
    setCfg((c) => ({ ...c, type_rules }));
    setSaved((c) => ({ ...c, type_rules }));
  };

  const change = useMemo(() => changedConfig(saved, cfg, projectsOn), [saved, cfg, projectsOn]);
  const dirty = Object.keys(change).length > 0;
  const edit = (patch: Partial<WfmConfig>) => { setDone(false); setCfg((c) => ({ ...c, ...patch })); };

  async function save() {
    setSaving(true); setError(""); setDone(false);
    try {
      const next = await call<WfmConfig>("/api/settings/workforce", "PUT", change);
      setCfg(next); setSaved(next); setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={s.shell}>
      <SettingsSave dirty={dirty} saving={saving} saved={done} error={error} onSave={() => void save()} />
      <Tabs label="Workforce" tabs={tabs.map((id) => ({ id, label: TAB_LABEL[id] }))} value={tab} onChange={setTab} />
      <div role="tabpanel" aria-label={TAB_LABEL[tab as WorkforceTab]}>
        {tab === "rules" && <RulesTab cfg={cfg} savedCodes={saved.employment_types.map((t) => t.code)} shifts={shifts} onChange={edit} facts={facts} onRulesApplied={rulesApplied} />}
        {tab === "shifts" && <ShiftsTab shifts={shifts} onChanged={loadShifts} />}
        {tab === "places" && <PlacesTab cfg={cfg} onChange={edit} />}
        {tab === "leave" && <LeaveTab carryForward={cfg.leave_carry_forward} onCarryForward={(leave_carry_forward) => edit({ leave_carry_forward })} />}
        {tab === "alerts" && <AlertsTab cfg={cfg} onChange={edit} />}
        {tab === "billing" && projectsOn && <BillingTab cfg={cfg} onChange={(costing) => edit({ costing })} />}
      </div>
    </div>
  );
}
