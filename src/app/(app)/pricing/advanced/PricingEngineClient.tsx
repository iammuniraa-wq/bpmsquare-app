"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { COMPONENT_ENUMS, COST_INPUT_KINDS, enumLabel } from "@/lib/pricing/enums";

// PricingEngine cockpit (admin-only; the routes enforce it server-side).
// Versions are the spine: everything except Dimensions and Cost Inputs is
// edited inside a DRAFT version; publishing runs the server-side validation
// report. The Test & Trace tab prices a sample document against ANY version
// (including drafts) and renders the waterfall trace -- the "why is my
// price X" view.

type VersionRow = { version: number; status: string; dsl_version: number; notes: string | null; created_at: string; published_at: string | null };
type Snapshot = {
  version: Record<string, unknown> | null;
  components: Record<string, unknown>[];
  procedures: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  cost_models: Record<string, unknown>[];
  dimensions: Record<string, unknown>[];
  cost_inputs: Record<string, unknown>[];
};
type TraceStep = {
  step: number; component?: string; subtotal?: string; status: string; reason?: string;
  rule_id?: string; matched_on?: Record<string, unknown>; specificity?: number;
  inputs?: { path: string; rate: number; qty: number }[]; basis?: number; result?: number;
  statistical?: boolean; manual?: boolean;
};
type PriceOut = {
  result: { pricing_date: string; currency: string | null; totals: { net: number; subtotals: Record<string, number> }; lines: { line_no: number; net: number; subtotals: Record<string, number>; components: Record<string, number>; trace: TraceStep[] }[] };
  config_version: number; procedure: string; calc_ms: number;
};

const TABS = ["Versions", "Dimensions", "Components", "Procedures", "Rules", "Cost Models", "Test & Trace"] as const;
type Tab = (typeof TABS)[number];

const btn: React.CSSProperties = { padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: "pointer", color: c.muted };
const primaryBtn: React.CSSProperties = { ...btn, background: "var(--accent, #378add)", color: "#fff", borderColor: "transparent" };
const input: React.CSSProperties = { padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 12.5, color: c.ink, outline: "none", background: "var(--panel)" };
const mono: React.CSSProperties = { fontFamily: "monospace", fontSize: 11.5 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "6px 8px", borderBottom: `1px solid ${c.line}` };
const td: React.CSSProperties = { fontSize: 12, color: c.ink, padding: "6px 8px", borderBottom: `1px solid ${c.line}`, verticalAlign: "top" };

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    PUBLISHED: { bg: "var(--tealbg)", fg: "var(--tealink)" },
    DRAFT: { bg: "var(--bluebg)", fg: "var(--blueink)" },
    SUPERSEDED: { bg: c.panel2, fg: c.hint },
    APPLIED: { bg: "var(--tealbg)", fg: "var(--tealink)" },
    EXCLUDED: { bg: "var(--amberbg)", fg: "var(--amberink)" },
    SKIPPED: { bg: c.panel2, fg: c.hint },
    SUBTOTAL: { bg: "var(--bluebg)", fg: "var(--blueink)" },
  };
  const s = map[status] ?? { bg: c.panel2, fg: c.muted };
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>{status}</span>;
}

function parseJsonOr<T>(text: string, fallback: T): T | null {
  if (!text.trim()) return fallback;
  try { return JSON.parse(text) as T; } catch { return null; }
}

export default function PricingEngineClient() {
  const searchParams = useSearchParams();
  const area = searchParams.get("area") || "default";
  const [tab, setTab] = useState<Tab>("Versions");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedRow = useMemo(() => versions.find((v) => v.version === selected) ?? null, [versions, selected]);
  const isDraft = selectedRow?.status === "DRAFT";

  const loadVersions = useCallback(async () => {
    const res = await fetch(`/api/settings/pricing-engine/versions?area=${encodeURIComponent(area)}`);
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "Failed to load versions"); return; }
    const list: VersionRow[] = json.versions ?? [];
    setVersions(list);
    setSelected(list.find((v) => v.status === "DRAFT")?.version ?? list[0]?.version ?? null);
  }, [area]);

  const loadSnapshot = useCallback(async (version: number) => {
    const res = await fetch(`/api/settings/pricing-engine/versions/${version}?area=${encodeURIComponent(area)}`);
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "Failed to load config"); return; }
    setSnapshot(json);
  }, [area]);

  useEffect(() => { loadVersions(); }, [loadVersions]);
  useEffect(() => { if (selected !== null) loadSnapshot(selected); }, [selected, loadSnapshot]);

  async function mutate(entity: string, op: "upsert" | "delete", data: Record<string, unknown>, versioned = true) {
    setError(null); setNotice(null); setBusy(true);
    try {
      const res = await fetch("/api/settings/pricing-engine/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, op, data, area, ...(versioned ? { version: selected } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Save failed"); return false; }
      if (selected !== null) await loadSnapshot(selected);
      return true;
    } finally { setBusy(false); }
  }

  async function createDraft(cloneFrom?: number) {
    setBusy(true); setError(null); setReport(null);
    try {
      const res = await fetch("/api/settings/pricing-engine/versions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, ...(cloneFrom !== undefined ? { clone_from: cloneFrom } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create draft"); return; }
      await loadVersions();
      setSelected(json.version.version);
      setNotice(`Draft v${json.version.version} created${cloneFrom !== undefined ? ` (cloned from v${cloneFrom})` : ""}.`);
    } finally { setBusy(false); }
  }

  async function publish(version: number) {
    setBusy(true); setError(null); setReport(null); setNotice(null);
    try {
      const res = await fetch(`/api/settings/pricing-engine/versions/${version}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", area }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Publish failed");
        if (Array.isArray(json.report)) setReport(json.report);
        return;
      }
      setNotice(`v${version} is now PUBLISHED.`);
      await loadVersions();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Version bar */}
      <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>Config version</span>
        <select value={selected ?? ""} onChange={(e) => setSelected(Number(e.target.value))} style={{ ...input, minWidth: 140 }}>
          {versions.map((v) => <option key={v.version} value={v.version}>v{v.version} — {v.status}</option>)}
        </select>
        {selectedRow && <StatusChip status={selectedRow.status} />}
        <span style={{ flex: 1 }} />
        <button style={btn} disabled={busy} onClick={() => createDraft()}>+ New empty draft</button>
        {selected !== null && <button style={btn} disabled={busy} onClick={() => createDraft(selected)}>Clone v{selected} → draft</button>}
        {isDraft && <button style={primaryBtn} disabled={busy} onClick={() => publish(selected!)}>{busy ? "…" : `Publish v${selected}`}</button>}
      </div>

      {error && <div style={{ fontSize: 12, color: "var(--err-ink)", marginBottom: 8 }}>{error}</div>}
      {notice && <div style={{ fontSize: 12, color: "var(--tealink)", marginBottom: 8 }}>{notice}</div>}
      {report && (
        <div style={{ ...cardStyle, borderColor: "var(--amberline)", marginBottom: 12, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--amberink)", marginBottom: 6 }}>Pre-publish validation report — fix these first</div>
          {report.map((r, i) => <div key={i} style={{ fontSize: 12, color: c.ink, padding: "2px 0" }}>• {r}</div>)}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn, background: tab === t ? "var(--bluebg)" : "var(--panel)", color: tab === t ? "var(--blueink)" : c.muted, fontWeight: tab === t ? 600 : 500 }}>
            {t}
          </button>
        ))}
      </div>

      {!isDraft && tab !== "Versions" && tab !== "Test & Trace" && (
        <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 10 }}>
          Viewing {selectedRow ? `v${selected} (${selectedRow.status})` : "—"} read-only. Only a DRAFT is editable — clone this version to change it.
        </div>
      )}

      {tab === "Versions" && <VersionsTab versions={versions} />}
      {tab === "Dimensions" && snapshot && <DimensionsTab snapshot={snapshot} editable mutate={mutate} />}
      {tab === "Components" && snapshot && <ComponentsTab snapshot={snapshot} editable={isDraft} mutate={mutate} />}
      {tab === "Procedures" && snapshot && <ProceduresTab snapshot={snapshot} editable={isDraft} mutate={mutate} />}
      {tab === "Rules" && snapshot && <RulesTab snapshot={snapshot} editable={isDraft} mutate={mutate} />}
      {tab === "Cost Models" && snapshot && <CostModelsTab snapshot={snapshot} editable={isDraft} mutate={mutate} />}
      {tab === "Test & Trace" && <TestTab versions={versions} defaultVersion={selected} area={area} />}
    </div>
  );
}

type MutateFn = (entity: string, op: "upsert" | "delete", data: Record<string, unknown>, versioned?: boolean) => Promise<boolean>;

function VersionsTab({ versions }: { versions: VersionRow[] }) {
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={th}>Version</th><th style={th}>Status</th><th style={th}>DSL</th><th style={th}>Created</th><th style={th}>Published</th><th style={th}>Notes</th></tr></thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version}>
              <td style={td}>v{v.version}</td>
              <td style={td}><StatusChip status={v.status} /></td>
              <td style={td}>{v.dsl_version}</td>
              <td style={td}>{new Date(v.created_at).toLocaleString()}</td>
              <td style={td}>{v.published_at ? new Date(v.published_at).toLocaleString() : "—"}</td>
              <td style={td}>{v.notes ?? "—"}</td>
            </tr>
          ))}
          {versions.length === 0 && <tr><td style={td} colSpan={6}>No versions yet — create a draft to begin.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function DimensionsTab({ snapshot, editable, mutate }: { snapshot: Snapshot; editable: boolean; mutate: MutateFn }) {
  const [attribute, setAttribute] = useState(""); const [weight, setWeight] = useState("10"); const [label, setLabel] = useState("");
  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 10 }}>
        The matching vocabulary: attributes rules may match on, each with a specificity weight (higher = more specific wins). Version-independent. Convention: <code style={mono}>document_type</code> routes per-module rules (quote, standard_quote, service_order, work_order, wfm_ot…).
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
        <thead><tr><th style={th}>Attribute</th><th style={th}>Weight</th><th style={th}>Label</th><th style={th}></th></tr></thead>
        <tbody>
          {snapshot.dimensions.map((d) => (
            <tr key={String(d.attribute)}>
              <td style={{ ...td, ...mono }}>{String(d.attribute)}</td>
              <td style={td}>{String(d.weight)}</td>
              <td style={td}>{(d.label as string) ?? "—"}</td>
              <td style={td}>{editable && <button style={btn} onClick={() => mutate("dimension", "delete", { attribute: d.attribute }, false)}>Delete</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={{ ...input, ...mono, width: 220 }} placeholder="customer.tier" value={attribute} onChange={(e) => setAttribute(e.target.value)} />
          <input style={{ ...input, width: 80 }} placeholder="weight" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <input style={{ ...input, width: 180 }} placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button style={primaryBtn} onClick={async () => {
            if (await mutate("dimension", "upsert", { attribute: attribute.trim(), weight: Number(weight), label: label || null }, false)) {
              setAttribute(""); setLabel("");
            }
          }}>Add / update</button>
        </div>
      )}
    </div>
  );
}

const fieldLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 3 };

function EnumSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, minWidth: 160 }}>
      {options.map((o) => <option key={o} value={o}>{enumLabel(o)}</option>)}
    </select>
  );
}

const BLANK_COMPONENT = {
  code: "", name: "", class: "PRICE", calc_type: "FIXED_AMOUNT", calc_basis: "NET_SO_FAR",
  sign: "BOTH", manual_override: "FORBIDDEN", resolution_strategy: "MOST_SPECIFIC", is_statistical: false,
};

function ComponentsTab({ snapshot, editable, mutate }: { snapshot: Snapshot; editable: boolean; mutate: MutateFn }) {
  const [form, setForm] = useState(BLANK_COMPONENT);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const set = <K extends keyof typeof BLANK_COMPONENT>(key: K, value: (typeof BLANK_COMPONENT)[K]) => setForm((f) => ({ ...f, [key]: value }));

  function startEdit(comp: Record<string, unknown>) {
    setEditingCode(String(comp.code));
    setForm({
      code: String(comp.code), name: (comp.name as string) ?? "",
      class: (comp.class as string) ?? "PRICE", calc_type: (comp.calc_type as string) ?? "FIXED_AMOUNT",
      calc_basis: (comp.calc_basis as string) ?? "NET_SO_FAR", sign: (comp.sign as string) ?? "BOTH",
      manual_override: (comp.manual_override as string) ?? "FORBIDDEN",
      resolution_strategy: (comp.resolution_strategy as string) ?? "MOST_SPECIFIC",
      is_statistical: Boolean(comp.is_statistical),
    });
  }

  async function save() {
    if (!form.code.trim()) return;
    if (await mutate("component", "upsert", form)) { setForm(BLANK_COMPONENT); setEditingCode(null); }
  }

  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 10 }}>
        A component is one line of the price waterfall — the list price, a discount, freight, tax. <b>Class</b> is what it is; <b>calc type</b> is how it's computed; <b>basis</b> is what it's computed against.
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
        <thead><tr><th style={th}>Code</th><th style={th}>Class</th><th style={th}>Calc</th><th style={th}>Basis</th><th style={th}>Sign</th><th style={th}>Stat</th><th style={th}>Override</th><th style={th}></th></tr></thead>
        <tbody>
          {snapshot.components.map((comp) => (
            <tr key={String(comp.code)}>
              <td style={{ ...td, ...mono }}>{String(comp.code)}</td>
              <td style={td}>{enumLabel(String(comp.class))}</td>
              <td style={td}>{enumLabel(String(comp.calc_type))}</td>
              <td style={td}>{enumLabel(String(comp.calc_basis))}</td>
              <td style={td}>{enumLabel(String(comp.sign))}</td>
              <td style={td}>{comp.is_statistical ? "✓" : ""}</td>
              <td style={td}>{enumLabel(String(comp.manual_override))}</td>
              <td style={td}>
                {editable && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={btn} onClick={() => startEdit(comp)}>Edit</button>
                    <button style={btn} onClick={() => mutate("component", "delete", { code: comp.code })}>Delete</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {snapshot.components.length === 0 && <tr><td style={td} colSpan={8}>No components in this version.</td></tr>}
        </tbody>
      </table>
      {editable && (
        <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.ink, marginBottom: 8 }}>
            {editingCode ? `Editing ${editingCode}` : "Add a component"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={fieldLabel}>Code</label>
              <input style={{ ...input, ...mono, width: "100%", boxSizing: "border-box" }} placeholder="CUST_DISC" value={form.code}
                disabled={editingCode !== null} onChange={(e) => set("code", e.target.value.toUpperCase())} />
            </div>
            <div>
              <label style={fieldLabel}>Name</label>
              <input style={{ ...input, width: "100%", boxSizing: "border-box" }} placeholder="Customer discount" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div>
              <label style={fieldLabel}>Class</label>
              <EnumSelect value={form.class} onChange={(v) => set("class", v)} options={COMPONENT_ENUMS.class} />
            </div>
            <div>
              <label style={fieldLabel}>Calc type</label>
              <EnumSelect value={form.calc_type} onChange={(v) => set("calc_type", v)} options={COMPONENT_ENUMS.calc_type} />
            </div>
            <div>
              <label style={fieldLabel}>Calc basis</label>
              <EnumSelect value={form.calc_basis} onChange={(v) => set("calc_basis", v)} options={COMPONENT_ENUMS.calc_basis} />
            </div>
            <div>
              <label style={fieldLabel}>Sign</label>
              <EnumSelect value={form.sign} onChange={(v) => set("sign", v)} options={COMPONENT_ENUMS.sign} />
            </div>
            <div>
              <label style={fieldLabel}>Manual override</label>
              <EnumSelect value={form.manual_override} onChange={(v) => set("manual_override", v)} options={COMPONENT_ENUMS.manual_override} />
            </div>
            <div>
              <label style={fieldLabel}>Resolution strategy</label>
              <EnumSelect value={form.resolution_strategy} onChange={(v) => set("resolution_strategy", v)} options={COMPONENT_ENUMS.resolution_strategy} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
              <label style={{ fontSize: 12, color: c.muted, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={form.is_statistical} onChange={(e) => set("is_statistical", e.target.checked)} />
                Statistical (never added to price)
              </label>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={primaryBtn} disabled={!form.code.trim()} onClick={save}>{editingCode ? "Save changes" : "Add component"}</button>
            {editingCode && <button style={btn} onClick={() => { setForm(BLANK_COMPONENT); setEditingCode(null); }}>Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}

type StepRow = { step: number; kind: "component" | "subtotal"; ref: string; formula: string; required: boolean };
type SnapshotStep = { step: number; component?: string; subtotal?: string; requirement?: string; formula?: string };

function stepsFromRows(rows: StepRow[]) {
  return rows.map((r) => ({
    step: r.step,
    ...(r.kind === "component" ? { component: r.ref } : { subtotal: r.ref }),
    ...(r.formula.trim() ? { formula: r.formula.trim() } : {}),
    ...(r.required ? { required: true } : {}),
  }));
}

function rowsFromSteps(steps: SnapshotStep[]): StepRow[] {
  return steps.map((s) => ({
    step: s.step, kind: s.subtotal ? "subtotal" : "component", ref: s.subtotal ?? s.component ?? "",
    formula: s.formula ?? "", required: Boolean((s as { required?: boolean }).required),
  }));
}

const BLANK_PROCEDURE = { code: "", entryMode: "LIST_DOWN" };

function ProceduresTab({ snapshot, editable, mutate }: { snapshot: Snapshot; editable: boolean; mutate: MutateFn }) {
  const [form, setForm] = useState(BLANK_PROCEDURE);
  const [rows, setRows] = useState<StepRow[]>([{ step: 10, kind: "component", ref: "", formula: "", required: false }]);
  const [editingCode, setEditingCode] = useState<string | null>(null);

  function startEdit(p: Record<string, unknown>) {
    setEditingCode(String(p.code));
    setForm({ code: String(p.code), entryMode: (p.entry_mode as string) ?? "LIST_DOWN" });
    const steps = (p.steps ?? []) as SnapshotStep[];
    setRows(steps.length ? rowsFromSteps(steps) : [{ step: 10, kind: "component", ref: "", formula: "", required: false }]);
  }
  function reset() {
    setForm(BLANK_PROCEDURE); setEditingCode(null);
    setRows([{ step: 10, kind: "component", ref: "", formula: "", required: false }]);
  }

  async function save() {
    if (!form.code.trim() || rows.some((r) => !r.ref.trim())) return;
    const data = { code: form.code.trim().toUpperCase(), entry_mode: form.entryMode, steps: stepsFromRows(rows) };
    if (await mutate("procedure", "upsert", data)) reset();
  }

  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 10 }}>
        A procedure is the waterfall itself — an ordered list of steps, each either pricing one component or marking a running subtotal (referenced later by a component whose basis is &ldquo;a named subtotal&rdquo;).
      </div>
      {snapshot.procedures.map((p) => {
        const steps = (p.steps ?? []) as SnapshotStep[];
        return (
          <div key={String(p.code)} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ ...mono, fontWeight: 700, color: c.ink }}>{String(p.code)}</span>
              <span style={{ fontSize: 11, color: c.muted }}>{enumLabel(String(p.entry_mode))}</span>
              {editable && (
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  <button style={btn} onClick={() => startEdit(p)}>Edit</button>
                  <button style={btn} onClick={() => mutate("procedure", "delete", { code: p.code })}>Delete</button>
                </div>
              )}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Step</th><th style={th}>Type</th><th style={th}>Ref</th><th style={th}>Formula</th><th style={th}>Required</th></tr></thead>
              <tbody>
                {steps.map((s, i) => (
                  <tr key={i}>
                    <td style={td}>{s.step}</td>
                    <td style={td}>{s.subtotal ? "Subtotal" : "Component"}</td>
                    <td style={{ ...td, ...mono }}>{s.subtotal ?? s.component}</td>
                    <td style={{ ...td, ...mono, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.formula ?? "—"}</td>
                    <td style={td}>{(s as { required?: boolean }).required ? "✓" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {snapshot.procedures.length === 0 && <div style={{ fontSize: 12, color: c.hint, marginBottom: 10 }}>No procedures in this version.</div>}

      {editable && (
        <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.ink, marginBottom: 8 }}>
            {editingCode ? `Editing ${editingCode}` : "Add a procedure"}
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <div>
              <label style={fieldLabel}>Code</label>
              <input style={{ ...input, ...mono }} placeholder="STANDARD" value={form.code} disabled={editingCode !== null}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <label style={fieldLabel}>Entry mode</label>
              <EnumSelect value={form.entryMode} onChange={(v) => setForm((f) => ({ ...f, entryMode: v }))} options={["LIST_DOWN", "COST_UP"]} />
            </div>
          </div>

          <label style={fieldLabel}>Steps (in order)</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "6px 8px", borderRadius: 7, background: c.panel2 }}>
                <input type="number" style={{ ...input, width: 60 }} value={r.step}
                  onChange={(e) => setRows(rows.map((rr, j) => (j === i ? { ...rr, step: Number(e.target.value) } : rr)))} />
                <select style={{ ...input, width: 130 }} value={r.kind}
                  onChange={(e) => setRows(rows.map((rr, j) => (j === i ? { ...rr, kind: e.target.value as "component" | "subtotal", ref: "" } : rr)))}>
                  <option value="component">Component</option>
                  <option value="subtotal">Subtotal marker</option>
                </select>
                {r.kind === "component" ? (
                  <select style={{ ...input, minWidth: 160 }} value={r.ref} onChange={(e) => setRows(rows.map((rr, j) => (j === i ? { ...rr, ref: e.target.value } : rr)))}>
                    <option value="">Choose a component…</option>
                    {snapshot.components.map((cmp) => <option key={String(cmp.code)} value={String(cmp.code)}>{String(cmp.code)}</option>)}
                  </select>
                ) : (
                  <input style={{ ...input, ...mono, width: 140 }} placeholder="NET_1" value={r.ref}
                    onChange={(e) => setRows(rows.map((rr, j) => (j === i ? { ...rr, ref: e.target.value.toUpperCase() } : rr)))} />
                )}
                <input style={{ ...input, ...mono, width: 180 }} placeholder="formula (optional)" value={r.formula}
                  onChange={(e) => setRows(rows.map((rr, j) => (j === i ? { ...rr, formula: e.target.value } : rr)))} />
                <label style={{ fontSize: 11.5, color: c.muted, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={r.required} onChange={(e) => setRows(rows.map((rr, j) => (j === i ? { ...rr, required: e.target.checked } : rr)))} />
                  Required
                </label>
                {rows.length > 1 && <button style={btn} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button style={{ ...btn, alignSelf: "flex-start" }}
              onClick={() => setRows([...rows, { step: (rows[rows.length - 1]?.step ?? 0) + 10, kind: "component", ref: "", formula: "", required: false }])}>
              + Add step
            </button>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button style={primaryBtn} disabled={!form.code.trim() || rows.some((r) => !r.ref.trim())} onClick={save}>
              {editingCode ? "Save changes" : "Add procedure"}
            </button>
            {editingCode && <button style={btn} onClick={reset}>Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}

type MatchRow = { attribute: string; value: string };
type ValueMode = "flat" | "tiers" | "formula";
type ScaleEntry = { from: number; value: number };

function describeMatch(match: Record<string, unknown>): string {
  const entries = Object.entries(match);
  if (entries.length === 0) return "Everyone (catch-all)";
  return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}

function describeValue(r: Record<string, unknown>): string {
  if (r.formula) return `Formula: ${r.formula}`;
  if (r.scale && typeof r.scale === "object") {
    const entries = (r.scale as { entries?: unknown[] }).entries;
    return `${Array.isArray(entries) ? entries.length : 0} volume band(s)`;
  }
  return r.value === null || r.value === undefined ? "—" : String(r.value);
}

const BLANK_RULE = { componentCode: "", matches: [] as MatchRow[], mode: "flat" as ValueMode, value: "0", formula: "", validFrom: "", validTo: "" };

function RulesTab({ snapshot, editable, mutate }: { snapshot: Snapshot; editable: boolean; mutate: MutateFn }) {
  const [form, setForm] = useState(BLANK_RULE);
  const [tiers, setTiers] = useState<ScaleEntry[]>([{ from: 0, value: 0 }]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dimensionAttrs = useMemo(() => snapshot.dimensions.map((d) => String(d.attribute)), [snapshot.dimensions]);
  const set = <K extends keyof typeof BLANK_RULE>(key: K, value: (typeof BLANK_RULE)[K]) => setForm((f) => ({ ...f, [key]: value }));

  function startEdit(r: Record<string, unknown>) {
    setEditingId(String(r.id));
    const match = (r.match_attributes ?? {}) as Record<string, unknown>;
    const scale = r.scale as { entries?: ScaleEntry[] } | null;
    setForm({
      componentCode: String(r.component_code),
      matches: Object.entries(match).map(([attribute, value]) => ({ attribute, value: String(value) })),
      mode: r.formula ? "formula" : scale ? "tiers" : "flat",
      value: r.value === null || r.value === undefined ? "0" : String(r.value),
      formula: (r.formula as string) ?? "",
      validFrom: (r.valid_from as string) ?? "", validTo: (r.valid_to as string) ?? "",
    });
    setTiers(scale?.entries?.length ? scale.entries : [{ from: 0, value: 0 }]);
  }

  function reset() { setForm(BLANK_RULE); setTiers([{ from: 0, value: 0 }]); setEditingId(null); }

  async function save() {
    if (!form.componentCode.trim()) return;
    const match_attributes: Record<string, string> = {};
    for (const m of form.matches) if (m.attribute) match_attributes[m.attribute] = m.value;
    const data: Record<string, unknown> = {
      id: editingId ?? undefined,
      component_code: form.componentCode.trim().toUpperCase(),
      match_attributes,
      value: form.mode === "flat" ? Number(form.value) || 0 : null,
      scale: form.mode === "tiers" ? { entries: tiers } : null,
      formula: form.mode === "formula" ? form.formula.trim() : null,
      valid_from: form.validFrom || null, valid_to: form.validTo || null,
    };
    if (await mutate("rule", "upsert", data)) reset();
  }

  const usedAttrs = new Set(form.matches.map((m) => m.attribute));

  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 10 }}>
        A rule sets one component&rsquo;s value for a specific case — add match conditions for a segment, region or deal size; leave it with no conditions for &ldquo;everyone else&rdquo;. The most specific match wins.
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
        <thead><tr><th style={th}>Component</th><th style={th}>Match</th><th style={th}>Value</th><th style={th}>Valid</th><th style={th}></th></tr></thead>
        <tbody>
          {snapshot.rules.map((r) => (
            <tr key={String(r.id)}>
              <td style={{ ...td, ...mono }}>{String(r.component_code)}</td>
              <td style={td}>{describeMatch((r.match_attributes ?? {}) as Record<string, unknown>)}</td>
              <td style={td}>{describeValue(r)}</td>
              <td style={td}>{(r.valid_from as string) ?? "…"} → {(r.valid_to as string) ?? "…"}</td>
              <td style={td}>
                {editable && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={btn} onClick={() => startEdit(r)}>Edit</button>
                    <button style={btn} onClick={() => mutate("rule", "delete", { id: r.id })}>Delete</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {snapshot.rules.length === 0 && <tr><td style={td} colSpan={5}>No rules in this version.</td></tr>}
        </tbody>
      </table>
      {editable && (
        <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.ink, marginBottom: 8 }}>
            {editingId ? "Editing rule" : "Add a rule"}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
            <div>
              <label style={fieldLabel}>Component</label>
              <select style={{ ...input, minWidth: 180 }} value={form.componentCode} onChange={(e) => set("componentCode", e.target.value)}>
                <option value="">Choose…</option>
                {snapshot.components.map((cmp) => <option key={String(cmp.code)} value={String(cmp.code)}>{String(cmp.code)} — {String(cmp.name)}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={fieldLabel}>Match conditions</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {form.matches.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select style={{ ...input, minWidth: 160 }} value={m.attribute}
                    onChange={(e) => set("matches", form.matches.map((mm, j) => (j === i ? { ...mm, attribute: e.target.value } : mm)))}>
                    <option value="">Choose an attribute…</option>
                    {dimensionAttrs.filter((a) => a === m.attribute || !usedAttrs.has(a)).map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <input style={{ ...input, width: 140 }} placeholder="value" value={m.value}
                    onChange={(e) => set("matches", form.matches.map((mm, j) => (j === i ? { ...mm, value: e.target.value } : mm)))} />
                  <button style={btn} onClick={() => set("matches", form.matches.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              {dimensionAttrs.length === 0 && form.matches.length === 0 && (
                <div style={{ fontSize: 11.5, color: c.hint }}>No dimensions registered yet — add one on the Dimensions tab to match on it, or leave this rule with no conditions (catch-all).</div>
              )}
              {dimensionAttrs.length > form.matches.length && (
                <button style={{ ...btn, alignSelf: "flex-start" }} onClick={() => set("matches", [...form.matches, { attribute: "", value: "" }])}>+ Add condition</button>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={fieldLabel}>Value</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {(["flat", "tiers", "formula"] as ValueMode[]).map((m) => (
                <button key={m} onClick={() => set("mode", m)} style={{
                  ...btn, background: form.mode === m ? "var(--bluebg)" : "var(--panel)", color: form.mode === m ? "var(--blueink)" : c.muted,
                  fontWeight: form.mode === m ? 700 : 500,
                }}>
                  {m === "flat" ? "Flat number" : m === "tiers" ? "Volume tiers" : "Formula"}
                </button>
              ))}
            </div>
            {form.mode === "flat" && (
              <input type="number" style={{ ...input, width: 140 }} value={form.value} onChange={(e) => set("value", e.target.value)} />
            )}
            {form.mode === "tiers" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {tiers.map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: c.muted }}>From</span>
                    <input type="number" style={{ ...input, width: 90 }} value={t.from} onChange={(e) => setTiers(tiers.map((tt, j) => (j === i ? { ...tt, from: Number(e.target.value) } : tt)))} />
                    <span style={{ fontSize: 11.5, color: c.muted }}>→</span>
                    <input type="number" style={{ ...input, width: 90 }} value={t.value} onChange={(e) => setTiers(tiers.map((tt, j) => (j === i ? { ...tt, value: Number(e.target.value) } : tt)))} />
                    {tiers.length > 1 && <button style={btn} onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>×</button>}
                  </div>
                ))}
                <button style={{ ...btn, alignSelf: "flex-start" }} onClick={() => setTiers([...tiers, { from: 0, value: 0 }])}>+ Add band</button>
              </div>
            )}
            {form.mode === "formula" && (
              <input style={{ ...input, ...mono, width: "100%", boxSizing: "border-box" }} placeholder="e.g. cost_ref('COPPER_WORKS') * 1.15"
                value={form.formula} onChange={(e) => set("formula", e.target.value)} />
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={fieldLabel}>Valid from</label>
              <input type="date" style={input} value={form.validFrom} onChange={(e) => set("validFrom", e.target.value)} />
            </div>
            <div>
              <label style={fieldLabel}>Valid to</label>
              <input type="date" style={input} value={form.validTo} onChange={(e) => set("validTo", e.target.value)} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button style={primaryBtn} disabled={!form.componentCode.trim()} onClick={save}>{editingId ? "Save changes" : "Add rule"}</button>
            {editingId && <button style={btn} onClick={reset}>Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}

const BLANK_COST_INPUT = { modelCode: "", path: "", kind: "MATERIAL", value: "", uom: "", currency: "", validFrom: "", validTo: "" };

function CostModelsTab({ snapshot, editable, mutate }: { snapshot: Snapshot; editable: boolean; mutate: MutateFn }) {
  const [modelCode, setModelCode] = useState("");
  const [inputForm, setInputForm] = useState(BLANK_COST_INPUT);
  const [editingInputId, setEditingInputId] = useState<string | null>(null);
  const setIn = <K extends keyof typeof BLANK_COST_INPUT>(key: K, value: (typeof BLANK_COST_INPUT)[K]) => setInputForm((f) => ({ ...f, [key]: value }));

  function startEditInput(i: Record<string, unknown>) {
    setEditingInputId(String(i.id));
    setInputForm({
      modelCode: String(i.cost_model_code), path: String(i.path), kind: String(i.kind),
      value: String(i.value), uom: (i.uom as string) ?? "", currency: (i.currency as string) ?? "",
      validFrom: (i.valid_from as string) ?? "", validTo: (i.valid_to as string) ?? "",
    });
  }
  function resetInput() { setInputForm(BLANK_COST_INPUT); setEditingInputId(null); }

  async function saveInput() {
    if (!inputForm.modelCode.trim() || !inputForm.path.trim()) return;
    const data = {
      id: editingInputId ?? undefined,
      cost_model_code: inputForm.modelCode.trim().toUpperCase(), path: inputForm.path.trim(), kind: inputForm.kind,
      value: Number(inputForm.value) || 0, uom: inputForm.uom || null, currency: inputForm.currency || null,
      valid_from: inputForm.validFrom || null, valid_to: inputForm.validTo || null,
    };
    if (await mutate("cost_input", "upsert", data, false)) resetInput();
  }

  const inputsByModel = useMemo(() => {
    const map = new Map<string, Record<string, unknown>[]>();
    for (const i of snapshot.cost_inputs) {
      const key = String(i.cost_model_code);
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return map;
  }, [snapshot.cost_inputs]);

  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 10 }}>
        Cost inputs are effective-dated and version-independent — update a copper rate weekly without touching pricing config. The trace records exactly which rate (and validity) each price used.
      </div>
      {snapshot.cost_models.map((m) => (
        <div key={String(m.code)} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ ...mono, fontWeight: 700, color: c.ink }}>{String(m.code)}</span>
            <span style={{ fontSize: 11, color: c.muted }}>{String(m.name)}</span>
            {editable && <button style={btn} onClick={() => mutate("cost_model", "delete", { code: m.code })}>Delete model</button>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Path</th><th style={th}>Kind</th><th style={th}>Value</th><th style={th}>UOM</th><th style={th}>Valid</th><th style={th}></th></tr></thead>
            <tbody>
              {(inputsByModel.get(String(m.code)) ?? []).map((i) => (
                <tr key={String(i.id)}>
                  <td style={{ ...td, ...mono }}>{String(i.path)}</td>
                  <td style={td}>{String(i.kind)}</td>
                  <td style={td}>{String(i.value)}</td>
                  <td style={td}>{(i.uom as string) ?? "—"}</td>
                  <td style={td}>{(i.valid_from as string) ?? "…"} → {(i.valid_to as string) ?? "…"}</td>
                  <td style={td}>
                    {editable && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button style={btn} onClick={() => startEditInput(i)}>Edit</button>
                        <button style={btn} onClick={() => mutate("cost_input", "delete", { id: i.id }, false)}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {editable && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input style={{ ...input, ...mono, width: 200 }} placeholder="MODEL_CODE" value={modelCode} onChange={(e) => setModelCode(e.target.value)} />
            <button style={btn} onClick={() => mutate("cost_model", "upsert", { code: modelCode })}>Add cost model</button>
          </div>

          <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: c.ink, marginBottom: 8 }}>
              {editingInputId ? "Editing cost input" : "Add a cost input"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={fieldLabel}>Cost model</label>
                <select style={{ ...input, width: "100%", boxSizing: "border-box" }} value={inputForm.modelCode} onChange={(e) => setIn("modelCode", e.target.value)}>
                  <option value="">Choose…</option>
                  {snapshot.cost_models.map((m) => <option key={String(m.code)} value={String(m.code)}>{String(m.code)}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Path</label>
                <input style={{ ...input, ...mono, width: "100%", boxSizing: "border-box" }} placeholder="material.copper_per_kg" value={inputForm.path} onChange={(e) => setIn("path", e.target.value)} />
              </div>
              <div>
                <label style={fieldLabel}>Kind</label>
                <EnumSelect value={inputForm.kind} onChange={(v) => setIn("kind", v)} options={COST_INPUT_KINDS} />
              </div>
              <div>
                <label style={fieldLabel}>Value</label>
                <input type="number" style={{ ...input, width: "100%", boxSizing: "border-box" }} value={inputForm.value} onChange={(e) => setIn("value", e.target.value)} />
              </div>
              <div>
                <label style={fieldLabel}>UOM</label>
                <input style={{ ...input, width: "100%", boxSizing: "border-box" }} placeholder="kg" value={inputForm.uom} onChange={(e) => setIn("uom", e.target.value)} />
              </div>
              <div>
                <label style={fieldLabel}>Currency</label>
                <input style={{ ...input, width: "100%", boxSizing: "border-box" }} placeholder="INR" value={inputForm.currency} onChange={(e) => setIn("currency", e.target.value)} />
              </div>
              <div>
                <label style={fieldLabel}>Valid from</label>
                <input type="date" style={{ ...input, width: "100%", boxSizing: "border-box" }} value={inputForm.validFrom} onChange={(e) => setIn("validFrom", e.target.value)} />
              </div>
              <div>
                <label style={fieldLabel}>Valid to</label>
                <input type="date" style={{ ...input, width: "100%", boxSizing: "border-box" }} value={inputForm.validTo} onChange={(e) => setIn("validTo", e.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={primaryBtn} disabled={!inputForm.modelCode.trim() || !inputForm.path.trim()} onClick={saveInput}>
                {editingInputId ? "Save changes" : "Add cost input"}
              </button>
              {editingInputId && <button style={btn} onClick={resetInput}>Cancel</button>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const SAMPLE_DOC = `{
  "attributes": { "document_type": "quote", "region": "DACH", "customer": { "tier": "A" } },
  "lines": [
    { "line_no": 10, "quantity": 10 }
  ]
}`;

function TestTab({ versions, defaultVersion, area }: { versions: VersionRow[]; defaultVersion: number | null; area: string }) {
  const [doc, setDoc] = useState(SAMPLE_DOC);
  const [version, setVersion] = useState<string>(defaultVersion !== null ? String(defaultVersion) : "");
  const [procedure, setProcedure] = useState("");
  const [date, setDate] = useState("");
  const [out, setOut] = useState<PriceOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setError(null); setOut(null);
    const parsed = parseJsonOr<Record<string, unknown> | null>(doc, null);
    if (!parsed) { setError("Document is not valid JSON."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/pricing-engine/test-price", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: parsed,
          options: {
            pricing_area: area,
            ...(version ? { config_version: Number(version) } : {}),
            ...(procedure ? { procedure } : {}),
            ...(date ? { pricing_date: date } : {}),
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Pricing failed"); return; }
      setOut(json as PriceOut);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ ...cardStyle, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: c.muted, marginBottom: 4 }}>Sample document (JSON)</div>
        <textarea value={doc} onChange={(e) => setDoc(e.target.value)} rows={10}
          style={{ ...input, ...mono, width: "100%", resize: "vertical", boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={version} onChange={(e) => setVersion(e.target.value)} style={input}>
            <option value="">Published version</option>
            {versions.map((v) => <option key={v.version} value={v.version}>v{v.version} ({v.status})</option>)}
          </select>
          <input style={{ ...input, width: 160 }} placeholder="Procedure (optional)" value={procedure} onChange={(e) => setProcedure(e.target.value)} />
          <input type="date" style={input} value={date} onChange={(e) => setDate(e.target.value)} />
          <button style={primaryBtn} disabled={busy} onClick={run}>{busy ? "Pricing…" : "Price it"}</button>
        </div>
        {error && <div style={{ fontSize: 12, color: "var(--err-ink)", marginTop: 8 }}>{error}</div>}
      </div>

      {out && (
        <div style={{ ...cardStyle, padding: 14 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10, fontSize: 12.5, color: c.ink }}>
            <span><b>Net:</b> {out.result.totals.net.toLocaleString()}</span>
            {Object.entries(out.result.totals.subtotals).map(([k, v]) => (
              <span key={k}><b>{k}:</b> {v.toLocaleString()}</span>
            ))}
            <span style={{ color: c.hint }}>v{out.config_version} · {out.procedure} · {out.calc_ms} ms · {out.result.pricing_date}</span>
          </div>
          {out.result.lines.map((line) => (
            <div key={line.line_no} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.ink, marginBottom: 4 }}>Line {line.line_no} — net {line.net.toLocaleString()}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Step</th><th style={th}>Component</th><th style={th}>Status</th><th style={th}>Detail</th><th style={{ ...th, textAlign: "right" }}>Amount</th></tr></thead>
                <tbody>
                  {line.trace.map((t, i) => (
                    <tr key={i} style={t.status === "SUBTOTAL" ? { background: c.panel2 } : undefined}>
                      <td style={td}>{t.step}</td>
                      <td style={{ ...td, ...mono }}>{t.component ?? t.subtotal}</td>
                      <td style={td}><StatusChip status={t.status} />{t.manual ? " ✎" : ""}{t.statistical ? " (stat)" : ""}</td>
                      <td style={{ ...td, fontSize: 11.5, color: c.muted }}>
                        {t.reason && <div>{t.reason}</div>}
                        {t.rule_id && <div>rule <span style={mono}>{t.rule_id.slice(0, 8)}</span>{t.specificity !== undefined ? ` · specificity ${t.specificity}` : ""}{t.matched_on && Object.keys(t.matched_on).length > 0 ? ` · ${JSON.stringify(t.matched_on)}` : ""}</div>}
                        {t.inputs?.map((inp, j) => <div key={j} style={mono}>{inp.path}: {inp.rate} × {inp.qty}</div>)}
                        {t.basis !== undefined && <div>basis {t.basis.toLocaleString()}</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: (t.result ?? 0) < 0 ? "var(--err-ink)" : c.ink }}>
                        {t.result !== undefined ? t.result.toLocaleString() : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
