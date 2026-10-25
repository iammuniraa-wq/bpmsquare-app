"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import SettingsSection from "@/components/settings/SettingsSection";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

/** The header fields a person may change after the project exists: name, contract value, planned dates and manager. Saved with PATCH /api/contract-projects/[id]. */
export default function ProjectDetailsForm({ projectId, initial, members }: {
  projectId: string;
  initial: { name: string; contract_value: number; planned_start: string | null; planned_end: string | null; manager_id: string | null };
  members: { user_id: string; name: string | null; email: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({ name: initial.name, contract_value: String(initial.contract_value), planned_start: initial.planned_start ?? "", planned_end: initial.planned_end ?? "", manager_id: initial.manager_id ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setSaved(false); setF((x) => ({ ...x, [k]: e.target.value })); };

  function save() {
    setError(""); setSaved(false);
    startTransition(async () => {
      const res = await fetch(`/api/contract-projects/${projectId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: f.name, contract_value: f.contract_value === "" ? 0 : Number(f.contract_value), planned_start: f.planned_start || null, planned_end: f.planned_end || null, manager_id: f.manager_id || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save"); return; }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <SettingsSection id="cp.details" title="Edit details" summary="Name, contract value, dates and manager">
      <div data-guide="cp.details" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="fg2">
          <Field label="Name" guide="cp.details.name"><Input value={f.name} onChange={set("name")} maxLength={200} /></Field>
          <Field label="Contract value" info={PROJECT_TIPS.contractValue} guide="cp.details.contract_value"><Input type="number" min="0" step="0.01" inputMode="decimal" value={f.contract_value} onChange={set("contract_value")} /></Field>
          <Field label="Planned start" guide="cp.details.start"><Input type="date" value={f.planned_start} onChange={set("planned_start")} /></Field>
          <Field label="Planned end" guide="cp.details.end"><Input type="date" value={f.planned_end} onChange={set("planned_end")} /></Field>
          <Field label="Manager" guide="cp.details.manager">
            <Select value={f.manager_id} onChange={set("manager_id")}>
              <option value="">— None —</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
            </Select>
          </Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button variant="primary" loading={pending} data-guide="cp.details.save" style={{ minHeight: 44 }} onClick={save}>Save</Button>
          {saved && <span role="status" style={{ fontSize: 13, color: "var(--tealink)" }}>Saved</span>}
          {error && <span role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{error}</span>}
        </div>
      </div>
    </SettingsSection>
  );
}
