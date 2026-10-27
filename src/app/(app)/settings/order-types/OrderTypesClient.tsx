"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import ErpOrgChips from "@/components/settings/ErpOrgChips";
import SettingsList, { ListBar } from "@/components/settings/SettingsList";
import { Toggle } from "@/components/settings/generalShared";
import { useFeel } from "@/components/FeelProvider";
import type { CompanyInfo } from "@/lib/tenant";
import type { CurrencyCode } from "@/lib/currency";
import { createOrderType, deleteOrderType, listOrderTypes, patchOrderType, type OrderTypeRow } from "@/lib/salesOrders/client";
import SalesOrderPrintDocument from "@/components/salesOrders/SalesOrderPrintDocument";
import { sampleOrder } from "@/components/salesOrders/previewSample";
import { ORDER_TIPS } from "@/components/salesOrders/tips";
import s from "@/components/salesOrders/salesOrders.module.css";
import {
  BLOCK_LABELS, blankDraft, CONTENT_BLOCKS, CONTENT_HELP, draftFromType, draftProblem, isRequiredBlock, moveBlock, normalizePrefix, RULE_FIELDS,
  ruleSummary, setBlockText, SOURCE_CHOICES, sortedTypes, toBody, toggleBlock, type TypeDraft,
} from "./typesLogic";

const ACCENT = "var(--modern-accent, var(--tenant-accent, var(--accent)))";

type Sel = { id: string | null } | null;

function Preview({ draft, currency, companyInfo, logoUrl, onClose }: { draft: TypeDraft; currency: CurrencyCode; companyInfo: CompanyInfo; logoUrl: string | null; onClose: () => void }) {
  const { order, lines } = sampleOrder(draft.prefix, currency);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={s.preview} role="dialog" aria-modal="true" aria-label="Preview with sample data">
      <div className={s.previewBar}>
        <span className="bpm-t-section">Preview with sample data</span>
        <Button variant="secondary" onClick={onClose} autoFocus>Close</Button>
      </div>
      <div className={s.previewBody}>
        <div className={s.previewPaper}>
          <SalesOrderPrintDocument
            order={order} lines={lines} account={{ name: "Sample Customer LLC", address: "Dubai, UAE" }} contact={{ name: "Priya Sharma" }}
            companyInfo={companyInfo} logoUrl={logoUrl} currency={currency}
            template={{ blocks: draft.blocks, accent_color: draft.accent_color, logo_position: draft.logo_position }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Settings > Order types (rule 6c, pattern 4): one table, a row opens a side panel (a bottom sheet on a phone). The
 * panel asks for four things up front (name, prefix, pricing mode, default); selection rules and the PDF design sit
 * behind "More", the design using the same block mechanism as Standard Quote templates.
 */
export default function OrderTypesClient({ currency, companyInfo, logoUrl }: { currency: CurrencyCode; companyInfo: CompanyInfo; logoUrl: string | null }) {
  const { confirm, toast } = useFeel();
  const [types, setTypes] = useState<OrderTypeRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [draft, setDraft] = useState<TypeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [openText, setOpenText] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listOrderTypes();
    if (res.ok) { setTypes(res.data.types); setNeedsUpdate(res.data.needsDatabaseUpdate); setFailed(null); } else { setTypes([]); setNeedsUpdate(res.needsDatabaseUpdate === true); setFailed(res.error); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = types ? sortedTypes(types) : [];
  const current = sel?.id ? types?.find((t) => t.id === sel.id) ?? null : null;
  const set = (p: Partial<TypeDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  function openNew() {
    setSel({ id: null }); setDraft(blankDraft((types ?? []).some((t) => t.is_default))); setError(""); setOpenText(null);
  }
  function openRow(id: string) {
    const t = types?.find((x) => x.id === id);
    if (!t) return;
    setSel({ id }); setDraft(draftFromType(t)); setError(""); setOpenText(null);
  }
  const close = () => { setSel(null); setDraft(null); setPreview(false); };

  async function save() {
    if (!draft) return;
    const problem = draftProblem(draft);
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    const res = sel?.id ? await patchOrderType(sel.id, toBody(draft)) : await createOrderType(toBody(draft));
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast({ text: sel?.id ? "Order type saved" : "Order type added", tone: "success" });
    close();
    await load();
  }

  async function remove() {
    if (!current) return;
    const used = current.order_count > 0;
    if (!(await confirm({ title: `${used ? "Switch off" : "Remove"} "${current.name}"?`, body: used ? "It has orders, so it is switched off: new orders cannot use it, existing ones keep it." : "Nothing uses it yet, so it is removed.", tone: "danger" }))) return;
    setBusy(true);
    const res = await deleteOrderType(current.id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast({ text: res.data.deactivated ? "Switched off: it has orders" : "Order type removed", tone: "success" });
    close();
    await load();
  }

  async function reactivate() {
    if (!current) return;
    setBusy(true);
    const res = await patchOrderType(current.id, { active: true });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    close();
    await load();
  }

  if (types === null) return <div role="status" aria-busy="true" className={s.shell}><EmptyState title="Loading order types…" /></div>;

  return (
    <div className={s.shell}>
      <ListBar>
        <span className="bpm-t-label" style={{ marginInlineEnd: "auto" }}>Order types</span>
        <Button variant="primary" onClick={openNew} disabled={failed !== null || needsUpdate} data-guide="order_types.new">+ New order type</Button>
      </ListBar>

      {needsUpdate ? (
        <EmptyState title="Sales orders need a database update" text="An admin has to apply the Sales Orders update first. Nothing is lost." action={<Button variant="primary" onClick={() => void load()}>Check again</Button>} />
      ) : failed !== null ? (
        <EmptyState title="Order types are not available right now" text="The service did not answer. Try again in a moment." action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />
      ) : (
        <SettingsList
          label="Order types"
          headers={["Prefix", "Pricing", "Chosen when", "Orders"]}
          rows={rows.map((t) => ({
            key: t.id,
            label: t.name,
            dim: !t.active,
            title: <>{t.name}{t.is_default && <span className={s.pill}>Default</span>}{!t.active && <span className={`${s.pill} ${s.pillDim}`}>Off</span>}<span style={{ marginInlineStart: 8 }}><ErpOrgChips type="order_type" id={t.id} /></span></>,
            cells: [t.prefix, t.pricing_mode === "external" ? "External" : "Internal", ruleSummary(t.rules), t.order_count],
          }))}
          onOpen={openRow}
          empty="No order types yet. Add one to start taking sales orders."
        />
      )}

      {draft && sel && (
        <SidePanel
          title={sel.id ? draft.name || "Order type" : "New order type"}
          subtitle={sel.id ? undefined : "Orders of this type share a prefix, pricing and a PDF design."}
          onClose={close}
          footer={
            <>
              {current && !current.is_default && current.active && <Button variant="danger" disabled={busy} onClick={() => void remove()} data-guide="order_types.remove">{current.order_count > 0 ? "Switch off" : "Remove"}</Button>}
              {current && !current.active && <Button disabled={busy} onClick={() => void reactivate()} data-guide="order_types.reactivate">Switch on</Button>}
              <Button disabled={busy} onClick={close}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => void save()} data-guide="order_types.save">{sel.id ? "Save" : "Add order type"}</Button>
            </>
          }
        >
          <Field label="Name" required htmlFor="ot-name">
            <Input id="ot-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Standard order" autoFocus data-guide="order_types.name" />
          </Field>
          <Field label="Prefix" info={ORDER_TIPS.prefix} htmlFor="ot-prefix">
            <Input id="ot-prefix" value={draft.prefix} onChange={(e) => set({ prefix: normalizePrefix(e.target.value) })} style={{ maxWidth: 160, textTransform: "uppercase" }} data-guide="order_types.prefix" />
          </Field>
          <Field label="Pricing" info={ORDER_TIPS.pricingMode} htmlFor="ot-pricing">
            <Select id="ot-pricing" value={draft.pricing_mode} onChange={(e) => set({ pricing_mode: e.target.value === "external" ? "external" : "internal" })} data-guide="order_types.pricing">
              <option value="internal">Internal: price list and pricing engine</option>
              <option value="external">External: supplied by the ERP</option>
            </Select>
          </Field>
          <div className={s.switchRow}>
            <span className="bpm-label-row"><span className="bpm-t-label">Default type</span><InfoTip label="Default type">{ORDER_TIPS.isDefault}</InfoTip></span>
            {current?.is_default ? <span className={s.pill} style={{ marginInlineStart: 0 }}>Yes</span> : <span data-guide="order_types.default"><Toggle on={draft.is_default} onChange={(v) => set({ is_default: v })} accent={ACCENT} label="Default type" /></span>}
          </div>

          <details className={s.more}>
            <summary>Selection rules</summary>
            <div style={{ paddingTop: 8 }}>
              <div className="bpm-label-row" style={{ marginBottom: 8 }}><span className="bpm-t-label">Choose this type when</span><InfoTip label="Selection rules">{ORDER_TIPS.rules}</InfoTip></div>
              {draft.rules.map((r, i) => (
                <div key={i} className={s.ruleRow}>
                  <Select data-guide="order_types.rule_field" aria-label={`Rule ${i + 1} field`} value={r.field} onChange={(e) => set({ rules: draft.rules.map((x, j) => (j === i ? { field: e.target.value, equals: "" } : x)) })}>
                    {RULE_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </Select>
                  {r.field === "source_type" ? (
                    <Select data-guide="order_types.rule_value" aria-label={`Rule ${i + 1} value`} value={r.equals} onChange={(e) => set({ rules: draft.rules.map((x, j) => (j === i ? { ...x, equals: e.target.value } : x)) })}>
                      <option value="">Choose…</option>
                      {SOURCE_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </Select>
                  ) : (
                    <Input data-guide="order_types.rule_value" aria-label={`Rule ${i + 1} value`} value={r.equals} placeholder="equals…" onChange={(e) => set({ rules: draft.rules.map((x, j) => (j === i ? { ...x, equals: e.target.value } : x)) })} />
                  )}
                  <Button variant="quiet" size="sm" iconOnly aria-label={`Remove rule ${i + 1}`} onClick={() => set({ rules: draft.rules.filter((_, j) => j !== i) })}>×</Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => set({ rules: [...draft.rules, { field: "customer_group", equals: "" }] })} data-guide="order_types.add_rule">+ Add rule</Button>
            </div>
          </details>

          <details className={s.more}>
            <summary>PDF design</summary>
            <div style={{ paddingTop: 8, display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="bpm-label-row"><span className="bpm-t-label">Blocks</span><InfoTip label="PDF design">{ORDER_TIPS.design}</InfoTip></div>
              <div>
                {draft.blocks.map((b, i) => {
                  const required = isRequiredBlock(b.type);
                  const hasText = CONTENT_BLOCKS.has(b.type);
                  return (
                    <div key={b.id}>
                      <div className={s.blockRow}>
                        <span className={s.blockName}>{BLOCK_LABELS[b.type]}</span>
                        {required ? (
                          <span className="bpm-t-help">always shown</span>
                        ) : (
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, cursor: "pointer", fontSize: 12.5 }}>
                            <input data-guide="order_types.block_shown" type="checkbox" checked={b.visible} onChange={() => set({ blocks: toggleBlock(draft.blocks, i) })} /> Shown
                          </label>
                        )}
                        {hasText && <Button variant="quiet" size="sm" aria-expanded={openText === b.id} onClick={() => setOpenText(openText === b.id ? null : b.id)}>{openText === b.id ? "Close" : "Text"}</Button>}
                        <Button variant="quiet" size="sm" iconOnly aria-label={`Move ${BLOCK_LABELS[b.type]} up`} disabled={i === 0} onClick={() => set({ blocks: moveBlock(draft.blocks, i, -1) })}>↑</Button>
                        <Button variant="quiet" size="sm" iconOnly aria-label={`Move ${BLOCK_LABELS[b.type]} down`} disabled={i === draft.blocks.length - 1} onClick={() => set({ blocks: moveBlock(draft.blocks, i, 1) })}>↓</Button>
                      </div>
                      {hasText && openText === b.id && (
                        <Textarea data-guide="order_types.block_text" aria-label={`${BLOCK_LABELS[b.type]} text`} value={b.content ?? ""} placeholder={CONTENT_HELP[b.type]} onChange={(e) => set({ blocks: setBlockText(draft.blocks, i, e.target.value) })} style={{ minHeight: 70, marginBottom: 8 }} />
                      )}
                    </div>
                  );
                })}
              </div>
              <Field label="Accent colour" htmlFor="ot-accent">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="color" aria-label="Pick the accent colour" value={draft.accent_color} onChange={(e) => set({ accent_color: e.target.value })} style={{ width: 44, height: 44, border: "1px solid var(--line)", borderRadius: 8, background: "none", cursor: "pointer", padding: 2 }} />
                  <Input id="ot-accent" data-guide="order_types.accent" value={draft.accent_color} onChange={(e) => set({ accent_color: e.target.value })} style={{ maxWidth: 140, fontFamily: "monospace" }} />
                </div>
              </Field>
              <Field label="Logo position" htmlFor="ot-logo">
                <Select id="ot-logo" data-guide="order_types.logo" value={draft.logo_position} onChange={(e) => set({ logo_position: e.target.value as TypeDraft["logo_position"] })}>
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </Select>
              </Field>
              <div><Button variant="secondary" onClick={() => setPreview(true)} data-guide="order_types.preview">Preview with sample data</Button></div>
            </div>
          </details>

          {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
        </SidePanel>
      )}

      {preview && draft && <Preview draft={draft} currency={currency} companyInfo={companyInfo} logoUrl={logoUrl} onClose={() => setPreview(false)} />}
    </div>
  );
}
