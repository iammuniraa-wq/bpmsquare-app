"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import Link from "next/link";

const KINDS = [
  { value: "motor",       label: "Motor" },
  { value: "transformer", label: "Transformer" },
  { value: "pump",        label: "Pump" },
  { value: "generator",   label: "Generator" },
  { value: "panel",       label: "Panel / Switchgear" },
];

const label: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const input: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fieldWrap: React.CSSProperties = { marginBottom: 14 };

type AccountOption = { id: string; name: string };

export default function NewAssetPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillAccountId = searchParams.get("account_id") ?? "";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  const [form, setForm] = useState({
    name: "", kind: "motor", make: "", model: "",
    rating: "", serial: "", notes: "",
    account_id: prefillAccountId, is_loaner: false,
  });

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data: AccountOption[]) => setAccounts(data ?? []))
      .catch(() => {});
  }, []);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(ROUTES.assets);
      } else {
        setError(json.error ?? "Failed to create asset");
      }
    });
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.assets} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All assets
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Asset</h1>
        <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Register a customer asset or loaner unit</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>

          {/* Left — asset details */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            <div style={cardStyle}>
              <p style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 14px" }}>Equipment</p>

              <div style={fieldWrap}>
                <label style={label}>Asset name *</label>
                <input style={input} value={form.name} onChange={set("name")} required placeholder="e.g. Ring-frame drive motor" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={label}>Kind *</label>
                  <select style={input} value={form.kind} onChange={set("kind")} required>
                    {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={label}>Make / brand</label>
                  <input style={input} value={form.make} onChange={set("make")} placeholder="e.g. Crompton Greaves" />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={fieldWrap}>
                  <label style={label}>Model</label>
                  <input style={input} value={form.model} onChange={set("model")} placeholder="e.g. ND315S-2" />
                </div>
                <div style={fieldWrap}>
                  <label style={label}>Serial number</label>
                  <input style={input} value={form.serial} onChange={set("serial")} placeholder="e.g. CG-75-2291" />
                </div>
              </div>

              <div style={fieldWrap}>
                <label style={label}>Rating / specs</label>
                <input style={input} value={form.rating} onChange={set("rating")} placeholder="e.g. 75 kW · 415V · 1480 rpm" />
              </div>

              <div style={{ ...fieldWrap, marginBottom: 0 }}>
                <label style={label}>Notes / history</label>
                <textarea
                  style={{ ...input, resize: "vertical", minHeight: 72 }}
                  value={form.notes}
                  onChange={set("notes")}
                  placeholder="e.g. Rewound once — June 2024. Bearings last replaced Jan 2025."
                />
              </div>
            </div>
          </div>

          {/* Right — ownership + actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            <div style={cardStyle}>
              <p style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 14px" }}>Ownership</p>

              <div style={fieldWrap}>
                <label style={label}>Customer account</label>
                <select style={input} value={form.account_id} onChange={set("account_id")}>
                  <option value="">— None (loaner / workshop stock) —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${c.line}` }}>
                <input
                  type="checkbox"
                  id="is_loaner"
                  checked={form.is_loaner}
                  onChange={(e) => setForm((f) => ({ ...f, is_loaner: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                <label htmlFor="is_loaner" style={{ fontSize: 13, color: c.ink, cursor: "pointer" }}>
                  This is a loaner unit
                </label>
              </div>
            </div>

            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#dc2626" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                disabled={pending}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
                  background: c.accent, color: "#fff", fontWeight: 700, fontSize: 13,
                  cursor: pending ? "wait" : "pointer",
                }}
              >
                {pending ? "Saving…" : "Create Asset"}
              </button>
              <Link
                href={ROUTES.assets}
                style={{
                  padding: "10px 18px", borderRadius: 8, border: `1px solid ${c.line}`,
                  color: c.muted, fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center",
                }}
              >
                Cancel
              </Link>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
