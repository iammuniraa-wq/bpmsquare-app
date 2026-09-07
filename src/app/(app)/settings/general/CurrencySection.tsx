"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import { settingsInput as inp } from "@/components/settings/SettingsField";
import { CURRENCIES, formatMoney, type CurrencyCode } from "@/lib/currency";

type Loaded = { code: CurrencyCode; options: { code: CurrencyCode; name: string; symbol: string }[] };

/**
 * Workspace currency (owner decision 2026-09-07): one setting that every
 * money figure -- lists, forms, dashboards, PDFs, emails -- formats through
 * (src/lib/currency.ts). It labels figures; it never converts them.
 */
export default function CurrencySection({ accent }: { accent: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [code, setCode] = useState<CurrencyCode>("INR");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/currency")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j: Loaded | null) => { if (j) { setLoaded(j); setCode(j.code); } })
      .catch(() => {});
  }, []);

  const dirty = !!loaded && code !== loaded.code;

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    const r = await fetch("/api/settings/currency", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
    }).catch(() => null);
    setSaving(false);
    if (!r) { setError("Network error"); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Could not save"); return; }
    setLoaded((prev) => (prev ? { ...prev, code: j.code } : prev));
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    // TenantProvider reads config from the server layout; refresh so every
    // screen formats with the new currency straight away.
    router.refresh();
  }

  const def = CURRENCIES[code];
  const summary = loaded ? `${loaded.code} — ${CURRENCIES[loaded.code].name}` : "Loading…";

  return (
    <SettingsSection id="general-currency" title="Currency" summary={summary}>
      <p style={{ fontSize: 12.5, color: c.muted, margin: "0 0 12px", lineHeight: 1.5 }}>
        How every amount in this workspace is shown, printed and emailed. Changing it relabels figures; it does not convert them.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={code} onChange={(e) => setCode(e.target.value as CurrencyCode)} style={{ ...inp, width: 280 }}>
          {(loaded?.options ?? Object.values(CURRENCIES)).map((o) => (
            <option key={o.code} value={o.code}>{o.code} — {o.name}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: c.hint }}>e.g. {formatMoney(1250000, def)} · {formatMoney(41.5, def, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none", cursor: dirty ? "pointer" : "default", background: dirty ? accent : c.line, color: dirty ? "#fff" : c.hint, transition: "all 0.15s" }}
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--err-ink)", marginTop: 8 }}>{error}</div>}
    </SettingsSection>
  );
}
