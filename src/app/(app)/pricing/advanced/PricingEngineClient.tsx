"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

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

function ComponentsTab({ snapshot, editable, mutate }: { snapshot: Snapshot; editable: boolean; mutate: MutateFn }) {
  const [json, setJson] = useState('{\n  "code": "CUST_DISC",\n  "name": "Customer discount",\n  "class": "DISCOUNT",\n  "calc_type": "PERCENT",\n  "sign": "NEGATIVE"\n}');
  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
        <thead><tr><th style={th}>Code</th><th style={th}>Class</th><th style={th}>Calc</th><th style={th}>Basis</th><th style={th}>Sign</th><th style={th}>Stat</th><th style={th}>Override</th><th style={th}></th></tr></thead>
        <tbody>
          {snapshot.components.map((comp) => (
            <tr key={String(comp.code)}>
              <td style={{ ...td, ...mono }}>{String(comp.code)}</td>
              <td style={td}>{String(comp.class)}</td>
              <td style={td}>{String(comp.calc_type)}</td>
              <td style={td}>{String(comp.calc_basis)}</td>
              <td style={td}>{String(comp.sign)}</td>
              <td style={td}>{comp.is_statistical ? "✓" : ""}</td>
              <td style={td}>{String(comp.manual_override)}</td>
              <td style={td}>{editable && <button style={btn} onClick={() => mutate("component", "delete", { code: comp.code })}>Delete</button>}</td>
            </tr>
          ))}
          {snapshot.components.length === 0 && <tr><td style={td} colSpan={8}>No components in this version.</td></tr>}
        </tbody>
      </table>
      {editable && <JsonEditor label="Add / update component (JSON)" json={json} setJson={setJson}
        onSave={(data) => mutate("component", "upsert", data)} />}
    </div>
  );
}

function ProceduresTab({ snapshot, editable, mutate }: { snapshot: Snapshot; editable: boolean; mutate: MutateFn }) {
  const [json, setJson] = useState('{\n  "code": "STANDARD",\n  "entry_mode": "LIST_DOWN",\n  "steps": [\n    {"step": 10, "component": "LIST_PRICE", "required": true},\n    {"step": 50, "subtotal": "NET_1"}\n  ]\n}');
  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      {snapshot.procedures.map((p) => (
        <div key={String(p.code)} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ ...mono, fontWeight: 700, color: c.ink }}>{String(p.code)}</span>
            <span style={{ fontSize: 11, color: c.muted }}>{String(p.entry_mode)}</span>
            {editable && <button style={btn} onClick={() => mutate("procedure", "delete", { code: p.code })}>Delete</button>}
          </div>
          <pre style={{ ...mono, background: c.panel2, borderRadius: 7, padding: 10, overflow: "auto", maxHeight: 220, margin: 0, color: c.ink }}>
            {JSON.stringify(p.steps, null, 2)}
          </pre>
        </div>
      ))}
      {snapshot.procedures.length === 0 && <div style={{ fontSize: 12, color: c.hint, marginBottom: 10 }}>No procedures in this version.</div>}
      {editable && <JsonEditor label="Add / update procedure (JSON)" json={json} setJson={setJson}
        onSave={(data) => mutate("procedure", "upsert", data)} />}
    </div>
  );
}

function RulesTab({ snapshot, editable, mutate }: { snapshot: Snapshot; editable: boolean; mutate: MutateFn }) {
  const [json, setJson] = useState('{\n  "component_code": "CUST_DISC",\n  "match_attributes": {"customer.tier": "A"},\n  "value": -3\n}');
  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
        <thead><tr><th style={th}>Component</th><th style={th}>Match</th><th style={th}>Value</th><th style={th}>Scale/Formula</th><th style={th}>Valid</th><th style={th}></th></tr></thead>
        <tbody>
          {snapshot.rules.map((r) => (
            <tr key={String(r.id)}>
              <td style={{ ...td, ...mono }}>{String(r.component_code)}</td>
              <td style={{ ...td, ...mono }}>{JSON.stringify(r.match_attributes)}</td>
              <td style={td}>{r.value === null ? "—" : String(r.value)}</td>
              <td style={{ ...td, ...mono, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.formula ? String(r.formula) : r.scale ? "scale" : "—"}
              </td>
              <td style={td}>{(r.valid_from as string) ?? "…"} → {(r.valid_to as string) ?? "…"}</td>
              <td style={td}>{editable && <button style={btn} onClick={() => mutate("rule", "delete", { id: r.id })}>Delete</button>}</td>
            </tr>
          ))}
          {snapshot.rules.length === 0 && <tr><td style={td} colSpan={6}>No rules in this version.</td></tr>}
        </tbody>
      </table>
      {editable && <JsonEditor label="Add rule (JSON — include an id to update an existing rule)" json={json} setJson={setJson}
        onSave={(data) => mutate("rule", "upsert", data)} />}
    </div>
  );
}

function CostModelsTab({ snapshot, editable, mutate }: { snapshot: Snapshot; editable: boolean; mutate: MutateFn }) {
  const [modelCode, setModelCode] = useState("");
  const [json, setJson] = useState('{\n  "cost_model_code": "COPPER_WORKS",\n  "path": "material.copper_per_kg",\n  "kind": "MATERIAL",\n  "value": 850,\n  "uom": "kg",\n  "valid_from": "2026-08-01"\n}');
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
                  <td style={td}><button style={btn} onClick={() => mutate("cost_input", "delete", { id: i.id }, false)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {editable && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input style={{ ...input, ...mono, width: 200 }} placeholder="MODEL_CODE" value={modelCode} onChange={(e) => setModelCode(e.target.value)} />
          <button style={btn} onClick={() => mutate("cost_model", "upsert", { code: modelCode })}>Add cost model</button>
        </div>
      )}
      <JsonEditor label="Add / update cost input (JSON — include an id to update)" json={json} setJson={setJson}
        onSave={(data) => mutate("cost_input", "upsert", data, false)} />
    </div>
  );
}

function JsonEditor({ label, json, setJson, onSave }: { label: string; json: string; setJson: (s: string) => void; onSave: (data: Record<string, unknown>) => Promise<boolean> }) {
  const [parseError, setParseError] = useState<string | null>(null);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: c.muted, marginBottom: 4 }}>{label}</div>
      <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={8}
        style={{ ...input, ...mono, width: "100%", resize: "vertical", boxSizing: "border-box" }} />
      {parseError && <div style={{ fontSize: 11.5, color: "var(--err-ink)", marginTop: 4 }}>{parseError}</div>}
      <button style={{ ...primaryBtn, marginTop: 6 }} onClick={async () => {
        const data = parseJsonOr<Record<string, unknown> | null>(json, null);
        if (!data) { setParseError("Not valid JSON."); return; }
        setParseError(null);
        await onSave(data);
      }}>Save</button>
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
