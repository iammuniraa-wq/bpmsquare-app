"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import {
  PRICING_METHODS, describeCondition, sampleDocumentLine, templateMutations, matchMethodTemplate,
  type MethodTemplate, type PricingMethodKey,
} from "@/lib/pricing/wizard";
import type { AttrValue } from "@/lib/pricing-core";

type VersionRow = { version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED" };
type SnapshotComponent = { code: string; name: string; calc_type: string };
type SnapshotProcedure = { code: string; entry_mode: string };
type SnapshotRule = { id: string; component_code: string; match_attributes: Record<string, AttrValue>; value: number | null };
type Snapshot = { components: SnapshotComponent[]; procedures: SnapshotProcedure[]; rules: SnapshotRule[] };

type RuleRow = { id?: string; component_code: string; match_attributes: Record<string, AttrValue>; value: number; unit: "currency" | "percent" };

type Phase = "loading" | "strategy" | "resume" | "numbers" | "sample" | "unsupported";

function rulesFromSnapshot(template: MethodTemplate, snapshot: Snapshot): RuleRow[] {
  const byComponent = new Map<string, SnapshotRule>();
  for (const r of snapshot.rules) if (!byComponent.has(r.component_code)) byComponent.set(r.component_code, r);
  return template.starterRules.map((starter) => {
    const existing = byComponent.get(starter.component_code);
    return existing
      ? { id: existing.id, component_code: starter.component_code, match_attributes: existing.match_attributes, value: Math.abs(existing.value ?? 0), unit: starter.unit }
      : { component_code: starter.component_code, match_attributes: starter.match_attributes, value: starter.value ?? 0, unit: starter.unit };
  });
}

async function postJson(url: string, body: unknown, method = "POST") {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (method !== "GET") init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export default function PricingSetupClient({ canEdit }: { canEdit: boolean }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [template, setTemplate] = useState<MethodTemplate | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [rules, setRules] = useState<RuleRow[]>([]);
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
        setTemplate(t);
        setVersion(draft.version);
        setRules(rulesFromSnapshot(t, snap));
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
      for (const mutation of templateMutations(t, v, "default")) {
        await postJson("/api/settings/pricing-engine/config", mutation);
      }
      setTemplate(t);
      setVersion(v);
      setRules(t.starterRules.map((r) => ({ component_code: r.component_code, match_attributes: r.match_attributes, value: r.value ?? 0, unit: r.unit })));
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
      setTemplate(t);
      setVersion(v);
      setRules(rulesFromSnapshot(t, snap));
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
      for (const rule of rules) {
        const componentSign = template.components.find((cmp) => cmp.code === rule.component_code)?.sign;
        const signedValue = componentSign === "NEGATIVE" ? -Math.abs(rule.value) : rule.value;
        await postJson("/api/settings/pricing-engine/config", {
          entity: "rule", op: "upsert", version, area: "default",
          data: { id: rule.id, component_code: rule.component_code, match_attributes: rule.match_attributes, value: signedValue },
        });
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
        <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 16 }}>Set your numbers — you can change these any time before going live.</div>
        {error && <ErrorBox message={error} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map((rule, i) => {
            const componentName = template.components.find((cmp) => cmp.code === rule.component_code)?.name ?? rule.component_code;
            return (
              <div
                key={`${rule.component_code}-${i}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                  padding: "10px 14px", borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{componentName}</div>
                  <div style={{ fontSize: 11.5, color: c.muted }}>{describeCondition(template, rule.match_attributes)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    disabled={!canEdit}
                    value={rule.value}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setRules((prev) => prev.map((r, idx) => (idx === i ? { ...r, value } : r)));
                    }}
                    style={{ width: 90, padding: "6px 8px", fontSize: 13, borderRadius: 6, border: `1px solid ${c.line}`, background: c.bg2, color: c.ink }}
                  />
                  <span style={{ fontSize: 12.5, color: c.muted, minWidth: 16 }}>{rule.unit === "percent" ? "%" : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
        {canEdit && (
          <button onClick={saveNumbers} disabled={busy} style={{ ...primaryBtn(busy), marginTop: 16 }}>
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

function SampleBill({ template, version, canEdit, onBack }: { template: MethodTemplate; version: number; canEdit: boolean; onBack: () => void }) {
  const [qty, setQty] = useState(1);
  const [line, setLine] = useState<{ components: Record<string, number>; subtotals: Record<string, number>; net: number; trace: { component?: string; status: string }[] } | null>(null);
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
          if (!step.component) return null;
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
