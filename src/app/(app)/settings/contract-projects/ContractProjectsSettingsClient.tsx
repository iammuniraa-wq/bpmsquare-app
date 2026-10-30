"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import type { MasterKind, MasterRow } from "@/lib/contractProjects/types";
import type { PaymentTermTemplate } from "@/lib/constants";
import PaymentTermsSection from "./PaymentTermsSection";

type KindRow = { kind: MasterKind; label: string; total: number; active: number; files: number; defaults: number; manual: number };
type ImportResult = { added: number; updated: number; refused: number; problems: { row: number; message: string }[]; warnings: { row: number; message: string }[]; preview: boolean; error?: string };

/**
 * Settings > Contract projects: the one place for the lists a budget line points at (a single table, a row per list), the payment-term
 * templates (a single table, a row per template) and the margin floor. The lists start as defaults; a file import replaces or extends
 * them, matched on list + code, and the ERP will refresh them later.
 */
export default function ContractProjectsSettingsClient() {
  const [kinds, setKinds] = useState<KindRow[] | null>(null);
  const [floor, setFloor] = useState<string>("");
  const [templates, setTemplates] = useState<PaymentTermTemplate[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<KindRow | null>(null);
  const { dirty, markSaved } = useSettingsDirty(floor);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([fetch("/api/contract-projects/masters?summary=1"), fetch("/api/settings/contract-projects")]);
    const mj = await m.json().catch(() => ({}));
    const sj = await s.json().catch(() => ({}));
    if (!m.ok) { setMsg({ ok: false, text: mj.error ?? "Couldn't load the lists." }); return; }
    setKinds(mj.kinds as KindRow[]);
    if (s.ok) {
      const f = sj.margin_floor_pct === null || sj.margin_floor_pct === undefined ? "" : String(sj.margin_floor_pct);
      setFloor(f); markSaved(f);
      setTemplates((sj.payment_term_templates ?? []) as PaymentTermTemplate[]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveFloor() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/settings/contract-projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ margin_floor_pct: floor.trim() === "" ? null : Number(floor) }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't save." }); return; }
    markSaved(floor); setMsg({ ok: true, text: "Saved." });
  }

  /** Saves the whole list of templates; the server answers with the ids it gave the new ones. */
  async function saveTemplates(next: PaymentTermTemplate[]): Promise<string | null> {
    const res = await fetch("/api/settings/contract-projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_term_templates: next }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return j.error ?? "Couldn't save the template.";
    setTemplates((j.payment_term_templates ?? next) as PaymentTermTemplate[]);
    return null;
  }

  if (!kinds) return <div style={{ ...cardStyle, color: c.hint }}>{msg?.text ?? "Loading…"}</div>;

  return (
    <div data-guide="cp.settings" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 }}>
      <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: c.ink, fontSize: 14, padding: "14px 16px" }}>
          Lists <InfoTip label="Lists">{PROJECT_TIPS.masters}</InfoTip>
          <InfoTip label="Starter lists">{PROJECT_TIPS.mastersDefaults}</InfoTip>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse" }}>
            <tbody>
              {kinds.map((k) => (
                <tr key={k.kind} data-guide={`cp.settings.row.${k.kind}`} style={{ borderTop: `1px solid ${c.line}` }}>
                  <td style={{ padding: "10px 16px", fontSize: 13.5, color: c.ink, fontWeight: 600 }}>{k.label}</td>
                  <td style={{ padding: "10px 8px", fontSize: 13, color: c.muted }}>{k.active} active{k.total !== k.active ? ` of ${k.total}` : ""}</td>
                  <td style={{ padding: "10px 8px", fontSize: 12.5, color: c.hint }}>{k.total === 0 ? "Empty" : k.defaults === k.total ? "Starter list" : k.files > 0 ? "From file" : "Entered by hand"}</td>
                  <td style={{ padding: "6px 16px", textAlign: "right" }}><Button size="sm" variant="secondary" data-guide="cp.settings.open" style={{ minHeight: 44 }} onClick={() => setPanel(k)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <PaymentTermsSection templates={templates} onSave={saveTemplates} />

      <section style={{ ...cardStyle }}>
        <label data-guide="cp.settings.margin_floor" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: c.ink, flexWrap: "wrap" }}>
          <span>Margin floor</span>
          <InfoTip label="Margin floor">{PROJECT_TIPS.marginFloor}</InfoTip>
          <input type="number" min={0} max={95} step={0.5} inputMode="decimal" value={floor} placeholder="Not set" aria-label="Margin floor in percent"
            onChange={(e) => setFloor(e.target.value)} className="bpm-input" style={{ width: 96, marginLeft: "auto", minHeight: 44 }} />
          <span style={{ color: c.hint }}>%</span>
        </label>
      </section>

      <SettingsSave dirty={dirty} saving={busy} saved={!!msg?.ok} error={msg && !msg.ok ? msg.text : ""} onSave={saveFloor} />
      {panel && <KindPanel kind={panel} onClose={() => { setPanel(null); void load(); }} />}
    </div>
  );
}

function KindPanel({ kind, onClose }: { kind: KindRow; onClose: () => void }) {
  const [rows, setRows] = useState<MasterRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [working, setWorking] = useState(false);
  const [add, setAdd] = useState({ code: "", name: "", parent_code: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/contract-projects/masters?kind=${kind.kind}&all=1&page=${page}&page_size=50&q=${encodeURIComponent(q)}`);
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setRows(j.rows as MasterRow[]); setTotal(j.total as number); } else setError(j.error ?? "Couldn't load the list");
  }, [kind.kind, page, q]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 200); return () => clearTimeout(t); }, [load]);

  async function upload(file: File) {
    setWorking(true); setError(""); setResult(null);
    const fd = new FormData();
    fd.set("kind", kind.kind); fd.set("file", file);
    const res = await fetch("/api/contract-projects/masters/import", { method: "POST", body: fd });
    const j = (await res.json().catch(() => ({}))) as ImportResult;
    setWorking(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok && !j.problems) { setError(j.error ?? "Couldn't import the file"); return; }
    setResult(j);
    if (res.ok) void load();
  }
  async function addOne() {
    setError("");
    const res = await fetch("/api/contract-projects/masters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: kind.kind, code: add.code, name: add.name, parent_code: add.parent_code || null }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Couldn't add it"); return; }
    setAdd({ code: "", name: "", parent_code: "" });
    void load();
  }
  async function toggle(r: MasterRow) {
    const res = await fetch(`/api/contract-projects/masters/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !r.active }) });
    if (res.ok) setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, active: !r.active } : x)));
  }

  return (
    <SidePanel title={kind.label} subtitle={`${total} entries`} onClose={onClose}>
      <div data-guide="cp.settings.panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.txt" hidden aria-label="Choose a file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <Button variant="primary" loading={working} data-guide="cp.settings.import" style={{ minHeight: 44 }} onClick={() => fileRef.current?.click()}>Import a file</Button>
          <InfoTip label="Import a file">{PROJECT_TIPS.mastersFile}</InfoTip>
        </div>
        {result && (
          <div role="status" data-guide="cp.settings.import_result" style={{ fontSize: 13, color: c.ink }}>
            {result.added} added, {result.updated} updated{result.refused > 0 ? `, ${result.refused} refused` : ""}.
            {[...result.problems, ...result.warnings].slice(0, 8).map((n, i) => <div key={i} style={{ fontSize: 12, color: c.hint }}>Row {n.row}: {n.message}</div>)}
            {result.warnings.length > 0 && <InfoTip label="Parents">{PROJECT_TIPS.mastersParents}</InfoTip>}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, alignItems: "end" }}>
          <Field label="Code"><Input value={add.code} maxLength={40} onChange={(e) => setAdd({ ...add, code: e.target.value })} /></Field>
          <Field label="Name"><Input value={add.name} maxLength={200} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
          <Field label="Parent"><Input value={add.parent_code} maxLength={40} onChange={(e) => setAdd({ ...add, parent_code: e.target.value })} /></Field>
          <Button variant="secondary" disabled={!add.code.trim() || !add.name.trim()} data-guide="cp.settings.add" style={{ minHeight: 44 }} onClick={addOne}>Add</Button>
        </div>
        <Input value={q} placeholder="Search code or name" aria-label="Search" onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, borderTop: `1px solid ${c.line}`, minHeight: 44, opacity: r.active ? 1 : 0.55 }}>
              <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, color: c.muted, minWidth: 64 }}>{r.code}</span>
              <span style={{ flex: 1, fontSize: 13, color: c.ink }}>{r.name}{r.parent_code ? <span style={{ color: c.hint }}> · under {r.parent_code}</span> : null}</span>
              <Button size="sm" variant="quiet" style={{ minHeight: 44 }} onClick={() => { void toggle(r); }}>{r.active ? "Switch off" : "Switch on"}</Button>
            </li>
          ))}
          {rows.length === 0 && <li style={{ fontSize: 13, color: c.hint, padding: "10px 0" }}>Nothing here yet. Import a file or add an entry.</li>}
        </ul>
        {total > 50 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button size="sm" variant="secondary" disabled={page <= 1} style={{ minHeight: 44 }} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span style={{ fontSize: 12.5, color: c.hint }}>Page {page} of {Math.ceil(total / 50)}</span>
            <Button size="sm" variant="secondary" disabled={page >= Math.ceil(total / 50)} style={{ minHeight: 44 }} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
