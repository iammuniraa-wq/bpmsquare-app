"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
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

export default function NewCasePage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [accounts, setAccounts] = useState<Opt[]>([]);
  const [assets, setAssets]     = useState<Opt[]>([]);
  const [technicians, setTechs] = useState<Opt[]>([]);

  const [form, setForm] = useState({
    account_id: "", type: "adhoc", equipment_label: "",
    complaint: "", asset_id: "", assigned_to: "",
  });

  const set = (k: keyof typeof form) =>
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
      .then((rows: { id: string; name: string }[]) => setAssets(rows))
      .catch(() => {});
  }, [form.account_id]);

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
          style={inp} value={form.equipment_label} onChange={set("equipment_label")} required
          placeholder="e.g. Crompton 75 kW 3-Ph IM · CG-75-2291"
        />
        <span style={{ fontSize: 11, color: c.hint }}>Brand, kW, type · serial number</span>
      </div>
      <div style={{ ...fw, marginBottom: 0 }}>
        <label style={lbl}>Complaint / symptom *</label>
        <textarea
          style={{ ...inp, minHeight: 90, resize: "vertical" }}
          value={form.complaint} onChange={set("complaint")} required
          placeholder="Describe what the customer reported…"
        />
      </div>
    </>
  );

  const optionalFields = (
    <>
      <div style={fw}>
        <label style={lbl}>Asset (customer equipment)</label>
        <select style={inp} value={form.asset_id} onChange={set("asset_id")} disabled={!form.account_id}>
          <option value="">— none / unknown —</option>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {!form.account_id && (
          <span style={{ fontSize: 11, color: c.hint }}>Select account first</span>
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
