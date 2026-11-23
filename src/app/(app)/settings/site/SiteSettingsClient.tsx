"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import InfoTip from "@/components/ui/InfoTip";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import { SITE_TIPS } from "@/lib/site/tips";

type Member = { user_id: string; name: string | null; email: string | null; is_admin: boolean };
type Cat = { id: string; name: string; resource_code: string | null; cost_code: string | null; erp_category: string | null; limit_amount: number | null; active: boolean; sort_order: number };
type Cfg = { pm_limit: string; monthly_cap: string; notify_receipts: string[] };

const inputStyle: React.CSSProperties = { width: "100%" };

/** Settings > Site entry. Limits and the people told about a problem save together; a category saves on its own row. */
export default function SiteSettingsClient() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [modules, setModules] = useState({ expenses: false, receipts: false });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const { dirty, markSaved } = useSettingsDirty(cfg);

  async function load() {
    const j = await fetch("/api/settings/site").then((r) => r.json()).catch(() => ({ error: "Couldn't load the settings." }));
    if (j.error) { setMsg({ ok: false, text: j.error }); return; }
    const next: Cfg = { pm_limit: j.pm_limit === null ? "" : String(j.pm_limit), monthly_cap: j.monthly_cap === null ? "" : String(j.monthly_cap), notify_receipts: j.notify_receipts as string[] };
    setCfg(next); markSaved(next); setMembers(j.members as Member[]); setCats(j.categories as Cat[]); setModules(j.modules);
    if (j.categories_pending) setMsg({ ok: false, text: "Categories need a database update (migration 0258)." });
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg) return <div style={{ ...cardStyle, color: c.hint }}>{msg?.text ?? "Loading…"}</div>;

  const toggle = (id: string) => setCfg({ ...cfg, notify_receipts: cfg.notify_receipts.includes(id) ? cfg.notify_receipts.filter((x) => x !== id) : [...cfg.notify_receipts, id] });

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/settings/site", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pm_limit: cfg.pm_limit === "" ? null : Number(cfg.pm_limit), monthly_cap: cfg.monthly_cap === "" ? null : Number(cfg.monthly_cap), notify_receipts: cfg.notify_receipts }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't save." }); return; }
    markSaved(cfg); setMsg({ ok: true, text: "Saved." });
  };

  async function saveCat(cat: Cat) {
    setMsg(null);
    const res = await fetch(`/api/settings/site/categories/${cat.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cat.name, resource_code: cat.resource_code, cost_code: cat.cost_code, erp_category: cat.erp_category, limit_amount: cat.limit_amount, active: cat.active }),
    });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: `${cat.name} saved.` } : { ok: false, text: j.error ?? "Couldn't save the category." });
  }
  async function addCat() {
    if (!newName.trim()) return;
    const res = await fetch("/api/settings/site/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName, sort_order: cats.length }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't add it." }); return; }
    setNewName(""); await load();
  }
  const edit = (id: string, p: Partial<Cat>) => setCats((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <div data-guide="site.settings" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }} className="bpm-tap">
      {modules.expenses && (
        <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 700, color: c.ink, fontSize: 14 }}>Limits</div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: c.ink, flexWrap: "wrap" }}>
            <span>Manager approves alone up to</span><InfoTip label="Manager limit">{SITE_TIPS.limit}</InfoTip>
            <input type="number" min={0} step="0.01" inputMode="decimal" className="bpm-input" aria-label="Manager approves alone up to" value={cfg.pm_limit} onChange={(e) => setCfg({ ...cfg, pm_limit: e.target.value })} style={{ width: 140, marginLeft: "auto" }} placeholder="No limit" />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: c.ink, flexWrap: "wrap" }}>
            <span>Monthly cap per person</span><InfoTip label="Monthly cap">{SITE_TIPS.monthlyCap}</InfoTip>
            <input type="number" min={0} step="0.01" inputMode="decimal" className="bpm-input" aria-label="Monthly cap per person" value={cfg.monthly_cap} onChange={(e) => setCfg({ ...cfg, monthly_cap: e.target.value })} style={{ width: 140, marginLeft: "auto" }} placeholder="No cap" />
          </label>
        </section>
      )}

      {modules.receipts && (
        <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: c.ink, fontSize: 14, marginBottom: 6 }}>
            Also tell about a delivery problem <InfoTip label="Also tell">{SITE_TIPS.notifyReceipts}</InfoTip>
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 500, color: c.hint }}>{cfg.notify_receipts.length === 0 ? "Project manager only" : `${cfg.notify_receipts.length} chosen`}</span>
          </div>
          {members.map((m) => (
            <label key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: c.ink, cursor: "pointer" }}>
              <input type="checkbox" checked={cfg.notify_receipts.includes(m.user_id)} onChange={() => toggle(m.user_id)} style={{ width: 18, height: 18 }} />
              <span>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</span>
              {m.is_admin && <span style={{ fontSize: 11, color: c.hint }}>admin</span>}
            </label>
          ))}
        </section>
      )}

      {modules.expenses && (
        <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: c.ink, fontSize: 14 }}>Expense categories <InfoTip label="Expense categories">{SITE_TIPS.categories}</InfoTip></div>
          {cats.map((cat) => (
            <div key={cat.id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, alignItems: "end", borderTop: `1px solid ${c.line}`, paddingTop: 10, opacity: cat.active ? 1 : 0.6 }}>
              <label style={{ fontSize: 11.5, color: c.hint }}>Name<input className="bpm-input" style={inputStyle} value={cat.name} onChange={(e) => edit(cat.id, { name: e.target.value })} /></label>
              <label style={{ fontSize: 11.5, color: c.hint }}>Resource type<input className="bpm-input" style={inputStyle} value={cat.resource_code ?? ""} onChange={(e) => edit(cat.id, { resource_code: e.target.value || null })} /></label>
              <label style={{ fontSize: 11.5, color: c.hint }}>Cost code<input className="bpm-input" style={inputStyle} value={cat.cost_code ?? ""} onChange={(e) => edit(cat.id, { cost_code: e.target.value || null })} /></label>
              <label style={{ fontSize: 11.5, color: c.hint }}><span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>ERP category <InfoTip label="ERP category">{SITE_TIPS.erpCategory}</InfoTip></span><input className="bpm-input" style={inputStyle} value={cat.erp_category ?? ""} onChange={(e) => edit(cat.id, { erp_category: e.target.value || null })} /></label>
              <label style={{ fontSize: 11.5, color: c.hint }}>Limit<input type="number" min={0} step="0.01" className="bpm-input" style={inputStyle} value={cat.limit_amount ?? ""} onChange={(e) => edit(cat.id, { limit_amount: e.target.value === "" ? null : Number(e.target.value) })} placeholder="None" /></label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, fontSize: 13 }}><input type="checkbox" checked={cat.active} onChange={(e) => edit(cat.id, { active: e.target.checked })} style={{ width: 18, height: 18 }} />On</label>
                <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" onClick={() => void saveCat(cat)}>Save</button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, borderTop: `1px solid ${c.line}`, paddingTop: 10 }}>
            <input className="bpm-input" aria-label="New category" placeholder="New category" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }} />
            <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" disabled={!newName.trim()} onClick={() => void addCat()}>Add</button>
          </div>
        </section>
      )}

      <SettingsSave dirty={dirty} saving={busy} saved={!!msg?.ok} error={msg && !msg.ok ? msg.text : ""} onSave={save} />
    </div>
  );
}
