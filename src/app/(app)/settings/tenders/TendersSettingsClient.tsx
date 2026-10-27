"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import InfoTip from "@/components/ui/InfoTip";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import { TENDER_TIPS } from "@/lib/tender/tips";
import { COSTING_TIPS } from "@/lib/tender/costing/tips";

type Member = { user_id: string; name: string | null; email: string | null; is_admin: boolean };
type Cfg = { approvers: string[]; allow_self_approval: boolean; price_validity_days: number; default_markup_pct: number };

/**
 * Settings > Tenders: the one place that says who approves a bid / no-bid proposal. An empty list means every workspace
 * admin (admins are marked). The proposer approves their own proposal only when the second switch is on.
 */
export default function TendersSettingsClient() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { dirty, markSaved } = useSettingsDirty(cfg);

  useEffect(() => {
    fetch("/api/settings/tender").then((r) => r.json()).then((j) => {
      if (j.error) { setMsg({ ok: false, text: j.error }); return; }
      const next = { approvers: j.approvers as string[], allow_self_approval: !!j.allow_self_approval, price_validity_days: Number(j.price_validity_days) || 180, default_markup_pct: Number.isFinite(Number(j.default_markup_pct)) ? Number(j.default_markup_pct) : 15 };
      setCfg(next); markSaved(next); setMembers(j.members as Member[]);
    }).catch(() => setMsg({ ok: false, text: "Couldn't load the settings." }));
  }, []);

  if (!cfg) return <div style={{ ...cardStyle, color: c.hint }}>{msg?.text ?? "Loading…"}</div>;

  const toggle = (id: string) => setCfg({ ...cfg, approvers: cfg.approvers.includes(id) ? cfg.approvers.filter((x) => x !== id) : [...cfg.approvers, id] });

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/settings/tender", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't save." }); return; }
    markSaved(cfg);
    setMsg({ ok: true, text: "Saved." });
  };

  return (
    <div data-guide="tender.settings" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: c.ink, fontSize: 14, marginBottom: 6 }}>
          Approvers <InfoTip label="Approvers">{TENDER_TIPS.approvers}</InfoTip>
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 500, color: c.hint }}>{cfg.approvers.length === 0 ? "Workspace admins" : `${cfg.approvers.length} chosen`}</span>
        </div>
        {members.map((m) => (
          <label key={m.user_id} data-guide="tender.settings.approver" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: c.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={cfg.approvers.includes(m.user_id)} onChange={() => toggle(m.user_id)} style={{ width: 18, height: 18 }} />
            <span>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</span>
            {m.is_admin && <span style={{ fontSize: 11, color: c.hint }}>admin</span>}
          </label>
        ))}
      </section>

      <section style={{ ...cardStyle }}>
        <label data-guide="tender.settings.self" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: c.ink, cursor: "pointer" }}>
          <input type="checkbox" checked={cfg.allow_self_approval} onChange={(e) => setCfg({ ...cfg, allow_self_approval: e.target.checked })} style={{ width: 18, height: 18 }} />
          <span>Allow self-approval</span>
          <InfoTip label="Allow self-approval">{TENDER_TIPS.selfApproval}</InfoTip>
        </label>
      </section>

      <section style={{ ...cardStyle }}>
        <label data-guide="tender.settings.price_validity" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: c.ink, flexWrap: "wrap" }}>
          <span>Price validity</span>
          <InfoTip label="Price validity">{TENDER_TIPS.priceValidity}</InfoTip>
          <input
            type="number" min={1} max={3650} step={1} inputMode="numeric" value={cfg.price_validity_days} aria-label="Price validity in days"
            onChange={(e) => setCfg({ ...cfg, price_validity_days: Math.trunc(Number(e.target.value)) || 0 })}
            className="bpm-input" style={{ width: 96, marginLeft: "auto" }}
          />
          <span style={{ color: c.hint }}>days</span>
        </label>
      </section>

      <section style={{ ...cardStyle }}>
        <label data-guide="tender.settings.default_markup" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: c.ink, flexWrap: "wrap" }}>
          <span>Default markup</span>
          <InfoTip label="Default markup">{COSTING_TIPS.defaultMarkup}</InfoTip>
          <input
            type="number" min={0} max={1000} step="0.01" inputMode="decimal" value={cfg.default_markup_pct} aria-label="Default markup in percent"
            onChange={(e) => setCfg({ ...cfg, default_markup_pct: e.target.value === "" ? 0 : Number(e.target.value) })}
            className="bpm-input" style={{ width: 96, marginLeft: "auto" }}
          />
          <span style={{ color: c.hint }}>%</span>
        </label>
      </section>

      <SettingsSave dirty={dirty} saving={busy} saved={!!msg?.ok} error={msg && !msg.ok ? msg.text : ""} onSave={save} />
    </div>
  );
}
