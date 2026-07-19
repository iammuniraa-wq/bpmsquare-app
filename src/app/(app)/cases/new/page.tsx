"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import MobileSection from "@/components/MobileSection";
import { ROUTES } from "@/lib/constants";

const CASE_TYPES = [
  { value: "adhoc",  label: "Adhoc" },
  { value: "direct", label: "Direct" },
  { value: "amc",    label: "AMC (contract)" },
];

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fw: React.CSSProperties = { marginBottom: 16 };

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

  const caseFields = (
    <>
      <div style={fw}>
        <label style={lbl}>Account *</label>
        <select style={inp} value={form.account_id} onChange={set("account_id")} required>
          <option value="">— select account —</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div style={fw}>
        <label style={lbl}>Case type *</label>
        <select style={inp} value={form.type} onChange={set("type")}>
          {CASE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div style={fw}>
        <label style={lbl}>Equipment label *</label>
        <input
          style={inp} value={form.equipment_label} onChange={handleEquipmentLabelChange} required
          placeholder="e.g. Crompton 75 kW 3-Ph IM · CG-75-2291"
        />
        <span style={{ fontSize: 11, color: c.hint }}>
          {form.asset_ids.length > 0 ? "Auto-filled from selected asset — edit if needed" : "Brand, kW, type · serial number"}
        </span>
      </div>
      <div style={fw}>
        <label style={lbl}>Complaint *</label>
        <textarea
          style={{ ...inp, minHeight: 70, resize: "vertical" }}
          value={form.complaint} onChange={set("complaint")} required
          placeholder="What the customer reported…"
        />
      </div>
      <div style={{ ...fw, marginBottom: 0 }}>
        <label style={lbl}>Symptom</label>
        <textarea
          style={{ ...inp, minHeight: 70, resize: "vertical" }}
          value={form.symptom} onChange={set("symptom")}
          placeholder="Observed symptom, e.g. bearing noise, tripping on load…"
        />
      </div>
    </>
  );

  const optionalFields = (
    <>
      <div style={fw}>
        <label style={lbl}>Assets (customer equipment)</label>
        {!form.account_id ? (
          <span style={{ fontSize: 11, color: c.hint }}>Select account first</span>
        ) : assets.length === 0 ? (
          <span style={{ fontSize: 11, color: c.hint }}>No assets on file for this account</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
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
      </div>
      <div style={{ ...fw, marginBottom: 0 }}>
        <label style={lbl}>Assign technician</label>
        <select style={inp} value={form.assigned_to} onChange={set("assigned_to")}>
          <option value="">— unassigned —</option>
          {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
    </>
  );

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.cases} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All cases
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Service Case</h1>
        <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Log a new repair intake</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ── Desktop ── */}
        <div className="mob-hide" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Case details</h3>
            {caseFields}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 14px" }}>Optional</h3>
              {optionalFields}
            </div>
            {error && <ErrorBox msg={error} />}
            <SubmitRow pending={pending} cancelHref={ROUTES.cases} />
          </div>
        </div>

        {/* ── Mobile ── */}
        <div className="mob-show" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MobileSection title="Case details" defaultOpen>
            {caseFields}
          </MobileSection>
          <MobileSection title="Optional details">
            {optionalFields}
          </MobileSection>
          {error && <ErrorBox msg={error} />}
          <SubmitRow pending={pending} cancelHref={ROUTES.cases} />
        </div>
      </form>
    </>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#dc2626" }}>
      {msg}
    </div>
  );
}

function SubmitRow({ pending, cancelHref }: { pending: boolean; cancelHref: string }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="submit" disabled={pending}
        style={{
          flex: 1, padding: "12px 0", borderRadius: 8, border: "none",
          background: c.accent, color: "#fff", fontWeight: 700, fontSize: 14,
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {pending ? "Creating…" : "Create Case"}
      </button>
      <Link
        href={cancelHref}
        style={{
          padding: "12px 18px", borderRadius: 8, border: `1px solid ${c.line}`,
          color: c.muted, fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center",
        }}
      >
        Cancel
      </Link>
    </div>
  );
}
