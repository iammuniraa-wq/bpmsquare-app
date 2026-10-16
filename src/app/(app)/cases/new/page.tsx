"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

const CASE_TYPES = [
  { value: "adhoc",  label: "Adhoc" },
  { value: "direct", label: "Direct" },
  { value: "amc",    label: "AMC (contract)" },
];

type Opt = { id: string; name: string };
type AssetOpt = { id: string; name: string; make: string | null; model: string | null; rating: string | null; serial: string | null };

function assetLabel(a: AssetOpt): string {
  return [
    [a.make, a.model ?? a.name].filter(Boolean).join(" "),
    a.rating,
    a.serial,
  ].filter(Boolean).join(" · ").trim();
}

export default function NewCasePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillAccountId = searchParams.get("account_id") ?? "";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [accounts, setAccounts] = useState<Opt[]>([]);
  const [assets, setAssets]     = useState<AssetOpt[]>([]);
  const [technicians, setTechs] = useState<Opt[]>([]);

  const [form, setForm] = useState({
    account_id: prefillAccountId, type: "adhoc", equipment_label: "",
    complaint: "", symptom: "", asset_ids: [] as string[], assigned_to: "",
  });
  // Tracks whether equipment_label was last set by auto-fill (vs. typed by hand),
  // so toggling assets doesn't clobber a manual edit.
  const labelAutoFilled = useRef(true);

  const set = (k: "account_id" | "type" | "complaint" | "symptom" | "assigned_to") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts).catch(() => {});
    fetch("/api/technicians").then((r) => r.json()).then(setTechs).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.account_id) { setAssets([]); return; }
    fetch(`/api/assets?account_id=${form.account_id}`)
      .then((r) => r.json())
      .then((rows: AssetOpt[]) => setAssets(rows))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.account_id]);

  function toggleAsset(assetId: string) {
    setForm((f) => {
      const selected = f.asset_ids.includes(assetId)
        ? f.asset_ids.filter((id) => id !== assetId)
        : [...f.asset_ids, assetId];

      let equipment_label = f.equipment_label;
      if (labelAutoFilled.current || !f.equipment_label) {
        const first = assets.find((a) => a.id === selected[0]);
        equipment_label = first ? assetLabel(first) : "";
        labelAutoFilled.current = true;
      }
      return { ...f, asset_ids: selected, equipment_label };
    });
  }

  function handleEquipmentLabelChange(e: React.ChangeEvent<HTMLInputElement>) {
    labelAutoFilled.current = false;
    setForm((f) => ({ ...f, equipment_label: e.target.value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(ROUTES.case(json.id));
      } else {
        setError(json.error ?? "Failed to create case");
      }
    });
  }

  const cancelHref = prefillAccountId ? ROUTES.account(prefillAccountId) : ROUTES.cases;

  return (
    <ObjectFormPage
      backHref={ROUTES.cases}
      backLabel="All cases"
      cancelHref={cancelHref}
      title="New Case"
      subtitle="Log a new repair intake"
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
    >
      <Card title="Case details" padding={18}>
        <Field label="Account" required>
          <Select value={form.account_id} onChange={set("account_id")} required>
            <option value="">— select account —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Case type" required>
          <Select value={form.type} onChange={set("type")}>
            {CASE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field
          label="Equipment label"
          required
          hint={form.asset_ids.length > 0 ? "Auto-filled from selected asset — edit if needed" : "Brand, kW, type · serial number"}
        >
          <Input
            value={form.equipment_label} onChange={handleEquipmentLabelChange} required
            placeholder="e.g. Crompton 75 kW 3-Ph IM · CG-75-2291"
          />
        </Field>
        <Field label="Complaint" required>
          <Textarea
            value={form.complaint} onChange={set("complaint")} required
            placeholder="What the customer reported…"
          />
        </Field>
        <Field label="Symptom" style={{ marginBottom: 0 }}>
          <Textarea
            value={form.symptom} onChange={set("symptom")}
            placeholder="Observed symptom, e.g. bearing noise, tripping on load…"
          />
        </Field>
      </Card>

      <Card title="Optional" padding={18}>
        <Field label="Assets (customer equipment)" htmlFor="case-assets">
          {!form.account_id ? (
            <span style={{ fontSize: 12, color: c.hint }}>Select account first</span>
          ) : assets.length === 0 ? (
            <span style={{ fontSize: 12, color: c.hint }}>No assets on file for this account</span>
          ) : (
            <div id="case-assets" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {assets.map((a) => (
                <label key={a.id} style={{
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  padding: "7px 10px", borderRadius: 7, fontSize: 12.5, color: c.ink,
                  background: form.asset_ids.includes(a.id) ? c.accentbg : c.panel,
                  border: `1px solid ${form.asset_ids.includes(a.id) ? c.accent + "60" : c.line}`,
                }}>
                  <input
                    type="checkbox"
                    checked={form.asset_ids.includes(a.id)}
                    onChange={() => toggleAsset(a.id)}
                    style={{ width: 14, height: 14, accentColor: c.accent, flexShrink: 0 }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {assetLabel(a) || a.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </Field>
        <Field label="Assign technician" style={{ marginBottom: 0 }}>
          <Select value={form.assigned_to} onChange={set("assigned_to")}>
            <option value="">— unassigned —</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      </Card>
    </ObjectFormPage>
  );
}
