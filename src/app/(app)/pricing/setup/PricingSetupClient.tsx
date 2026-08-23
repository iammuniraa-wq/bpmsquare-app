"use client";

import { useEffect, useState, useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import {
  PRICING_METHODS, sampleDocumentLine, templateMutations, matchMethodTemplate,
  type MethodTemplate, type PricingMethodKey, type EditableComponent, type RateRow, type ScaleEntry,
} from "@/lib/pricing/wizard";
import RateSnapshotView, { type SnapshotRule } from "../RateSnapshotView";

type VersionRow = { version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED" };
type SnapshotProcedure = { code: string; entry_mode: string };
type Snapshot = { procedures: SnapshotProcedure[]; rules: SnapshotRule[] };

type RowsByComponent = Record<string, RateRow[]>;
type RowsSetter = Dispatch<SetStateAction<RowsByComponent>>;

type Phase = "loading" | "strategy" | "resume" | "numbers" | "sample" | "unsupported";

function rowsFromSnapshot(template: MethodTemplate, snapshot: Snapshot): RowsByComponent {
  const byComponent = new Map<string, SnapshotRule[]>();
  for (const r of snapshot.rules) {
    const list = byComponent.get(r.component_code) ?? [];
    list.push(r);
    byComponent.set(r.component_code, list);
  }
  const result: RowsByComponent = {};
  for (const ec of template.editableComponents) {
    const existing = byComponent.get(ec.component_code);
    result[ec.component_code] = existing && existing.length > 0
      ? existing.map((r) => ({ id: r.id, match_attributes: r.match_attributes, value: r.value, tiers: r.scale?.entries }))
      : ec.defaultRows.map((r) => ({ ...r }));
  }
  return result;
}

function defaultRows(template: MethodTemplate): RowsByComponent {
  const result: RowsByComponent = {};
  for (const ec of template.editableComponents) result[ec.component_code] = ec.defaultRows.map((r) => ({ ...r }));
  return result;
}

/**
 * Re-push a template's dimensions/components/procedure/cost-model onto a
 * version that already exists (a resumed draft, or one just cloned from
 * PUBLISHED). Idempotent upsert, always safe to run. Without this, a draft
 * created under an older build of wizard.ts keeps its STALE component
 * definitions forever -- e.g. if a component's calc_type changes (as
 * LIST_PRICE/BASE_VALUE/BASE_PRICE did, PER_UNIT -> SCALE_TIERED, to add
 * volume tiering), a resumed old draft would still have the DB's PER_UNIT
 * component but the wizard would submit rules shaped for SCALE_TIERED
 * (value: null, scale: {...}) -- PER_UNIT reads `rule.value ?? 0`, so a null
 * value silently prices that component at zero. Every "numbers" entry point
 * (fresh draft, resumed draft, cloned draft) now syncs first so the DB
 * definition can never drift from what this build of the wizard assumes.
 */
async function syncTemplateDefinitions(t: MethodTemplate, version: number) {
  for (const mutation of templateMutations(t, version, "default")) {
    await postJson("/api/settings/pricing-engine/config", mutation);
  }
}

async function postJson(url: string, body: unknown, method = "POST") {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (method !== "GET") init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// ── Row mutation helpers — pure updates over the setRows state setter ──────

function addRow(setRows: RowsSetter, ec: EditableComponent) {
  const firstFactor = ec.factors[0];
  const newRow: RateRow = {
    match_attributes: firstFactor ? { [firstFactor]: "" } : {},
    value: ec.tiered ? null : 0,
    tiers: ec.tiered ? [{ from: 0, value: 0 }] : undefined,
  };
  setRows((prev) => ({ ...prev, [ec.component_code]: [...(prev[ec.component_code] ?? []), newRow] }));
}

function removeRow(setRows: RowsSetter, code: string, index: number) {
  setRows((prev) => {
    const list = prev[code] ?? [];
    if (list.length <= 1) return prev;
    return { ...prev, [code]: list.filter((_, i) => i !== index) };
  });
}

function updateValue(setRows: RowsSetter, code: string, index: number, value: number) {
  setRows((prev) => ({ ...prev, [code]: prev[code].map((r, i) => (i === index ? { ...r, value } : r)) }));
}

function setCondition(setRows: RowsSetter, code: string, index: number, factor: string, value: string) {
  setRows((prev) => ({
    ...prev,
    [code]: prev[code].map((r, i) => (i === index ? { ...r, match_attributes: { ...r.match_attributes, [factor]: value } } : r)),
  }));
}

function removeCondition(setRows: RowsSetter, code: string, index: number, factor: string) {
  setRows((prev) => ({
    ...prev,
    [code]: prev[code].map((r, i) => {
      if (i !== index) return r;
      const next = { ...r.match_attributes };
      delete next[factor];
      return { ...r, match_attributes: next };
    }),
  }));
}

function updateTier(setRows: RowsSetter, code: string, rowIndex: number, tierIndex: number, patch: Partial<ScaleEntry>) {
  setRows((prev) => ({
    ...prev,
    [code]: prev[code].map((r, i) => {
      if (i !== rowIndex) return r;
      return { ...r, tiers: (r.tiers ?? []).map((t, ti) => (ti === tierIndex ? { ...t, ...patch } : t)) };
    }),
  }));
}

function addTier(setRows: RowsSetter, code: string, rowIndex: number) {
  setRows((prev) => ({
    ...prev,
    [code]: prev[code].map((r, i) => (i === rowIndex ? { ...r, tiers: [...(r.tiers ?? []), { from: 0, value: 0 }] } : r)),
  }));
}

function removeTier(setRows: RowsSetter, code: string, rowIndex: number, tierIndex: number) {
  setRows((prev) => ({
    ...prev,
    [code]: prev[code].map((r, i) => {
      if (i !== rowIndex) return r;
      const tiers = (r.tiers ?? []).filter((_, ti) => ti !== tierIndex);
      return { ...r, tiers: tiers.length ? tiers : [{ from: 0, value: 0 }] };
    }),
  }));
}

const linkBtn: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 };
const numInput: React.CSSProperties = { width: 90, padding: "6px 8px", fontSize: 13, borderRadius: 6, border: `1px solid ${c.line}`, background: c.bg2, color: c.ink };

export default function PricingSetupClient({ canEdit }: { canEdit: boolean }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [template, setTemplate] = useState<MethodTemplate | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [rows, setRows] = useState<RowsByComponent>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const list = await postJson("/api/settings/pricing-engine/versions?area=default", null, "GET");
      const versions: VersionRow[] = list.versions ?? [];
      const draft = versions.find((v) => v.status === "DRAFT");
      const published = versions.find((v) => v.status === "PUBLISHED");
      setPublishedVersion(published?.version ?? null);

      if (draft) {
        const snap: Snapshot = await postJson(`/api/settings/pricing-engine/versions/${draft.version}?area=default`, null, "GET");
        const t = matchMethodTemplate(snap.procedures);
        if (!t) { setPhase("unsupported"); return; }
        await syncTemplateDefinitions(t, draft.version);
        setTemplate(t);
        setVersion(draft.version);
        setRows(rowsFromSnapshot(t, snap));
        setPhase("numbers");
        return;
      }

      if (published) {
        const snap: Snapshot = await postJson(`/api/settings/pricing-engine/versions/${published.version}?area=default`, null, "GET");
        const t = matchMethodTemplate(snap.procedures);
        if (!t) { setPhase("unsupported"); return; }
        setTemplate(t);
        setPhase("resume");
        return;
      }

      setPhase("strategy");
    } catch (e) {
      setError((e as Error).message);
      setPhase("strategy");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function chooseMethod(key: PricingMethodKey) {
    const t = PRICING_METHODS.find((m) => m.key === key)!;
    setBusy(true);
    setError(null);
    try {
      const created = await postJson("/api/settings/pricing-engine/versions", { area: "default" });
      const v = created.version.version as number;
      await syncTemplateDefinitions(t, v);
      setTemplate(t);
      setVersion(v);
      setRows(defaultRows(t));
      setPhase("numbers");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function makeChanges() {
    if (!publishedVersion) return;
    setBusy(true);
    setError(null);
    try {
      const created = await postJson("/api/settings/pricing-engine/versions", { area: "default", clone_from: publishedVersion });
      const v = created.version.version as number;
      const snap: Snapshot = await postJson(`/api/settings/pricing-engine/versions/${v}?area=default`, null, "GET");
      const t = matchMethodTemplate(snap.procedures) ?? template;
      if (!t) { setPhase("unsupported"); return; }
      await syncTemplateDefinitions(t, v);
      setTemplate(t);
      setVersion(v);
      setRows(rowsFromSnapshot(t, snap));
      setPhase("numbers");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveNumbers() {
    if (!template || version === null) return;
    setBusy(true);
    setError(null);
    try {
      for (const ec of template.editableComponents) {
        for (const row of rows[ec.component_code] ?? []) {
          await postJson("/api/settings/pricing-engine/config", {
            entity: "rule", op: "upsert", version, area: "default",
            data: {
              id: row.id,
              component_code: ec.component_code,
              match_attributes: row.match_attributes,
              value: ec.tiered ? null : row.value,
              scale: ec.tiered ? { entries: row.tiers ?? [] } : null,
            },
          });
        }
      }
      setPhase("sample");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (phase === "loading") {
    return <div style={{ padding: 24, color: c.muted, fontSize: 13 }}>Loading…</div>;
  }

  if (phase === "unsupported") {
    return (
      <div style={{ padding: 20, borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel, fontSize: 13, color: c.muted }}>
        This pricing configuration was customized beyond what this wizard understands. Continue in{" "}
        <Link href={ROUTES.pricingAdvanced} style={{ color: c.accent }}>Advanced</Link>, or use the &ldquo;Discard&rdquo; banner
        above to clear the current draft and start the wizard fresh.
      </div>
    );
  }

  if (phase === "resume" && template) {
    return (
      <div style={{ padding: 20, borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel }}>
        <div style={{ fontSize: 13, color: c.muted, marginBottom: 4 }}>You&rsquo;re set up on</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{template.label}</div>
        <div style={{ fontSize: 13, color: c.muted, marginBottom: 16 }}>{template.tagline}</div>
        {canEdit && (
          <button onClick={makeChanges} disabled={busy} style={primaryBtn(busy)}>
            {busy ? "Preparing…" : "Make changes"}
          </button>
        )}
        {error && <ErrorBox message={error} />}
      </div>
    );
  }

  if (phase === "strategy") {
    return (
      <div>
        {error && <ErrorBox message={error} />}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {PRICING_METHODS.map((m) => (
            <button
              key={m.key}
              disabled={busy || !canEdit}
              onClick={() => chooseMethod(m.key)}
              style={{
                textAlign: "left", padding: 16, borderRadius: 10, border: `1px solid ${c.line}`,
                background: c.panel, cursor: canEdit ? "pointer" : "default", opacity: busy ? 0.6 : 1,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 12.5, color: c.accent, fontWeight: 600, marginBottom: 8 }}>{m.tagline}</div>
              <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.5 }}>{m.description}</div>
            </button>
          ))}
        </div>
        {!canEdit && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: c.muted }}>
            You have view-only access to Pricing — ask an editor to set this up.
          </div>
        )}
      </div>
    );
  }

  if (phase === "numbers" && template) {
    return (
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{template.label}</div>
        <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 16 }}>
          Set your numbers — add a rule for any segment, region or deal size that needs a different rate. You can change these any time before going live.
        </div>
        {error && <ErrorBox message={error} />}
        {template.editableComponents.map((ec) => (
          <RateTable key={ec.component_code} template={template} ec={ec} rows={rows[ec.component_code] ?? []} canEdit={canEdit} setRows={setRows} />
        ))}
        {canEdit && (
          <button onClick={saveNumbers} disabled={busy} style={{ ...primaryBtn(busy), marginTop: 8 }}>
            {busy ? "Saving…" : "Continue to sample bill"}
          </button>
        )}
      </div>
    );
  }

  if (phase === "sample" && template && version !== null) {
    return <SampleBill template={template} version={version} canEdit={canEdit} onBack={() => setPhase("numbers")} />;
  }

  return null;
}

// ── Rate table editor ────────────────────────────────────────────────────

function RateTable({ template, ec, rows, canEdit, setRows }: {
  template: MethodTemplate; ec: EditableComponent; rows: RateRow[]; canEdit: boolean; setRows: RowsSetter;
}) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{ec.label}</div>
        {ec.factors.length > 0 && canEdit && (
          <button onClick={() => addRow(setRows, ec)} style={linkBtn}>+ Add a rule for a specific case</button>
        )}
      </div>
      {ec.help && <div style={{ fontSize: 11.5, color: c.muted, marginBottom: 8 }}>{ec.help}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: ec.help ? 0 : 6 }}>
        {rows.map((row, i) => (
          <RateRowEditor key={i} template={template} ec={ec} row={row} index={i} canEdit={canEdit} canRemoveRow={rows.length > 1} setRows={setRows} />
        ))}
      </div>
    </div>
  );
}

function RateRowEditor({ template, ec, row, index, canEdit, canRemoveRow, setRows }: {
  template: MethodTemplate; ec: EditableComponent; row: RateRow; index: number;
  canEdit: boolean; canRemoveRow: boolean; setRows: RowsSetter;
}) {
  const usedFactors = new Set(Object.keys(row.match_attributes));
  const availableFactors = ec.factors.filter((f) => !usedFactors.has(f));
  const isCatchAll = Object.keys(row.match_attributes).length === 0;
  const factorLabel = (attr: string) => template.dimensions.find((d) => d.attribute === attr)?.label ?? attr;

  return (
    <div style={{ padding: "8px 10px", borderRadius: 8, background: c.bg2, border: `1px solid ${c.line}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {isCatchAll && <span style={{ fontSize: 11.5, color: c.muted, fontStyle: "italic" }}>Everyone else</span>}
          {Object.entries(row.match_attributes).map(([factor, value]) => (
            <span key={factor} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, padding: "2px 6px", borderRadius: 5, background: pillar.blue.bg, color: pillar.blue.fg }}>
              {factorLabel(factor)}:
              <input
                disabled={!canEdit}
                value={String(value)}
                onChange={(e) => setCondition(setRows, ec.component_code, index, factor, e.target.value)}
                placeholder="value"
                style={{ width: 60, border: "none", background: "transparent", color: "inherit", fontSize: 11.5, fontWeight: 600, outline: "none" }}
              />
              {canEdit && (
                <button onClick={() => removeCondition(setRows, ec.component_code, index, factor)} style={{ ...linkBtn, color: "inherit" }}>×</button>
              )}
            </span>
          ))}
          {canEdit && availableFactors.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) setCondition(setRows, ec.component_code, index, e.target.value, ""); }}
              style={{ fontSize: 11, padding: "2px 4px", borderRadius: 5, border: `1px solid ${c.line}`, background: c.panel, color: c.muted }}
            >
              <option value="">+ condition</option>
              {availableFactors.map((f) => <option key={f} value={f}>{factorLabel(f)}</option>)}
            </select>
          )}
        </div>
        {canEdit && canRemoveRow && (
          <button onClick={() => removeRow(setRows, ec.component_code, index)} style={{ ...linkBtn, color: pillar.red.fg }}>Remove</button>
        )}
      </div>

      {ec.tiered ? (
        <TierEditor ec={ec} tiers={row.tiers ?? []} rowIndex={index} canEdit={canEdit} setRows={setRows} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number" disabled={!canEdit} value={row.value ?? 0}
            onChange={(e) => updateValue(setRows, ec.component_code, index, Number(e.target.value))}
            style={numInput}
          />
          <span style={{ fontSize: 12, color: c.muted }}>{ec.unit === "percent" ? "%" : ""}</span>
        </div>
      )}
    </div>
  );
}

function TierEditor({ ec, tiers, rowIndex, canEdit, setRows }: {
  ec: EditableComponent; tiers: ScaleEntry[]; rowIndex: number; canEdit: boolean; setRows: RowsSetter;
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: c.hint, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
        Volume bands
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {tiers.map((t, ti) => (
          <div key={ti} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11.5, color: c.muted }}>From qty</span>
            <input
              type="number" disabled={!canEdit} value={t.from}
              onChange={(e) => updateTier(setRows, ec.component_code, rowIndex, ti, { from: Number(e.target.value) })}
              style={{ ...numInput, width: 70 }}
            />
            <span style={{ fontSize: 11.5, color: c.muted }}>→</span>
            <input
              type="number" disabled={!canEdit} value={t.value}
              onChange={(e) => updateTier(setRows, ec.component_code, rowIndex, ti, { value: Number(e.target.value) })}
              style={{ ...numInput, width: 70 }}
            />
            <span style={{ fontSize: 11.5, color: c.muted }}>{ec.unit === "percent" ? "%" : "/ unit"}</span>
            {canEdit && tiers.length > 1 && (
              <button onClick={() => removeTier(setRows, ec.component_code, rowIndex, ti)} style={{ ...linkBtn, color: pillar.red.fg }}>×</button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <button onClick={() => addTier(setRows, ec.component_code, rowIndex)} style={{ ...linkBtn, marginTop: 4 }}>+ Add a volume band</button>
      )}
    </div>
  );
}

// ── Sample bill ──────────────────────────────────────────────────────────

type SampleLine = { components: Record<string, number>; subtotals: Record<string, number>; net: number; trace: { component?: string; status: string }[] };

function SampleBill({ template, version, canEdit, onBack }: { template: MethodTemplate; version: number; canEdit: boolean; onBack: () => void }) {
  const [qty, setQty] = useState(1);
  const [line, setLine] = useState<SampleLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (q: number) => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson("/api/settings/pricing-engine/test-price", {
        document: { attributes: {}, lines: [sampleDocumentLine(template, q)] },
        options: { config_version: version, pricing_area: "default", procedure: template.procedure.procedure_id },
      });
      setLine(data.result.lines[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [template, version]);

  useEffect(() => { run(qty); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusOf = (code: string) => line?.trace.find((t) => t.component === code)?.status;
  const statisticalCodes = useMemo(() => new Set(template.components.filter((cmp) => cmp.is_statistical).map((cmp) => cmp.code)), [template]);

  const margin = useMemo(() => {
    const g = template.marginGuardrail;
    if (!g || !line) return null;
    const revenue = line.subtotals[g.revenueSubtotal];
    const cost = line.subtotals[g.costSubtotal];
    const floor = line.components[g.componentCode];
    if (revenue === undefined || cost === undefined || !revenue) return null;
    const actualPct = ((revenue - cost) / revenue) * 100;
    return { actualPct, floor: floor ?? null, belowFloor: floor !== undefined && actualPct < floor };
  }, [template, line]);

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Sample bill</div>
      <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 16 }}>What a customer&rsquo;s bill looks like with the numbers you just entered.</div>
      {error && <ErrorBox message={error} />}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12.5, color: c.muted }}>Quantity</span>
        <input
          type="number" min={1} value={qty}
          onChange={(e) => { const q = Math.max(1, Number(e.target.value) || 1); setQty(q); run(q); }}
          style={{ width: 70, padding: "6px 8px", fontSize: 13, borderRadius: 6, border: `1px solid ${c.line}`, background: c.bg2, color: c.ink }}
        />
      </div>

      {margin && (
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
            padding: "8px 14px", marginBottom: 12, borderRadius: 8,
            background: margin.belowFloor ? pillar.red.bg : pillar.green.bg,
            color: margin.belowFloor ? pillar.red.fg : pillar.green.fg,
            fontSize: 12.5, fontWeight: 600,
          }}
        >
          <span>Margin on this bill: {margin.actualPct.toFixed(1)}%</span>
          {margin.floor !== null && (
            <span>{margin.belowFloor ? `Below your minimum of ${margin.floor}%` : `At or above your minimum of ${margin.floor}%`}</span>
          )}
        </div>
      )}

      <div style={{ borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel, overflow: "hidden" }}>
        {busy && !line && <div style={{ padding: 16, fontSize: 13, color: c.muted }}>Calculating…</div>}
        {line && template.procedure.steps.map((step) => {
          if (step.subtotal) {
            return (
              <div key={`s${step.step}`} style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", fontSize: 12.5, fontWeight: 600, color: c.muted, borderTop: `1px solid ${c.line}` }}>
                <span>{step.subtotal.replace(/_/g, " ")}</span>
                <span>{line.subtotals[step.subtotal]?.toFixed(2) ?? "—"}</span>
              </div>
            );
          }
          if (!step.component || statisticalCodes.has(step.component)) return null;
          const status = statusOf(step.component);
          if (status === "SKIPPED" || status === "EXCLUDED") return null;
          const name = template.components.find((cmp) => cmp.code === step.component)?.name ?? step.component;
          const amount = line.components[step.component];
          return (
            <div key={`c${step.step}`} style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", fontSize: 13, borderTop: `1px solid ${c.line}` }}>
              <span>{name}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{amount?.toFixed(2) ?? "—"}</span>
            </div>
          );
        })}
        {line && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", fontSize: 14.5, fontWeight: 700, background: pillar.blue.bg, color: pillar.blue.fg }}>
            <span>Total</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{line.net.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={onBack} style={{ padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, color: c.muted, cursor: "pointer" }}>
          ← Back to numbers
        </button>
        {canEdit && (
          <div style={{ fontSize: 12.5, color: c.muted, display: "flex", alignItems: "center" }}>
            Looks right? Use &ldquo;Go live&rdquo; above to publish these rates.
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ padding: "8px 12px", marginBottom: 12, borderRadius: 6, background: pillar.red.bg, color: pillar.red.fg, fontSize: 12.5 }}>
      {message}
    </div>
  );
}

function primaryBtn(busy: boolean): React.CSSProperties {
  return {
    padding: "8px 16px", fontSize: 13, fontWeight: 700, borderRadius: 6,
    border: "none", background: c.accent, color: "#fff",
    cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  };
}
