"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFeel } from "@/components/FeelProvider";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import SettingsList from "@/components/settings/SettingsList";
import { ROUTES } from "@/lib/constants";
import { formatMoney, moneyLabel } from "@/lib/currency";
import { useCurrency } from "@/lib/tenant-context";
import type { PricingCategory, PricingItem } from "@/lib/types";
import {
  blankPrice, CATEGORY_LABEL, draftOfItem, filterItems, PRICE_FILTERS, PRICING_CATEGORIES, planPriceSave, priceProblem, type PriceDraft, type PriceFilter,
} from "./pricingLogic";
import { PRICING_TIPS } from "./tips";
import s from "./pricing.module.css";

/**
 * Settings > Pricing. Small Scale Pricing is one table (a row per rate, the category a chip filter) instead of a card
 * per category; Dynamic Pricing is a single link row when that module is on. The panel saves on its own: a rate is a
 * record with its own routes.
 */
export default function PricingClient({ initialItems, rateCard, engine }: { initialItems: PricingItem[]; rateCard: boolean; engine: boolean }) {
  const router = useRouter();
  const cur = useCurrency();
  const { confirm } = useFeel();
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<PriceFilter>("all");
  const [draft, setDraft] = useState<PriceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const rows = filterItems(items, filter);

  async function save() {
    if (!draft) return;
    const problem = priceProblem(draft);
    if (problem) { setError(problem); return; }
    setSaving(true); setError("");
    const plan = planPriceSave(draft);
    const res = await fetch(plan.url, { method: plan.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.body) }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) { setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not save") : "Network error"); return; }
    const saved = (await res.json()) as PricingItem;
    setItems((p) => (p.some((i) => i.id === saved.id) ? p.map((i) => (i.id === saved.id ? saved : i)) : [...p, saved]));
    setDraft(null);
    // Quotes read the rate card on the server.
    router.refresh();
  }

  async function remove() {
    const item = items.find((i) => i.id === draft?.id);
    if (!item) return;
    if (!(await confirm({ title: `Delete "${item.description}"?`, body: "Quotes already priced with it keep the figures they were given.", tone: "danger" }))) return;
    const res = await fetch(`/api/settings/pricing/${item.id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !(res.ok || res.status === 204)) { setError("Could not delete"); return; }
    setItems((p) => p.filter((i) => i.id !== item.id));
    setDraft(null);
    router.refresh();
  }

  return (
    <div className={s.shell}>
      {engine && (
        <div className={s.engine}>
          <span className={s.engineName}>Dynamic Pricing<InfoTip label="Dynamic Pricing">{PRICING_TIPS.engine}</InfoTip></span>
          <Button href={ROUTES.pricingSetup}>Open Pricing setup</Button>
        </div>
      )}
      {rateCard && (
        <>
          <div className={s.bar}>
            <span className={s.barLabel}><span className="bpm-t-label">Small Scale Pricing</span></span>
            <Button variant="primary" onClick={() => { setDraft(blankPrice(filter)); setError(""); }}>+ New rate</Button>
          </div>
          <div className={s.chips} role="group" aria-label="Category">
            {PRICE_FILTERS.map((f) => (
              <button key={f.id} type="button" className={s.chip} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          <SettingsList
            label="Small Scale Pricing"
            headers={["Category", "Unit", moneyLabel("Rate", cur)]}
            rows={rows.map((i) => ({
              key: i.id,
              title: i.description,
              cells: [CATEGORY_LABEL[i.category], i.unit, formatMoney(i.rate, cur, {})],
            }))}
            onOpen={(id) => { const i = items.find((x) => x.id === id); if (i) { setDraft(draftOfItem(i)); setError(""); } }}
            empty="No rates yet. Use + New rate."
          />
        </>
      )}

      {draft && (
        <SidePanel
          title={draft.id === null ? "New rate" : draft.description || "Rate"}
          onClose={() => setDraft(null)}
          footer={
            <>
              {draft.id !== null && <Button variant="danger" onClick={() => { void remove(); }}>Delete</Button>}
              <Button variant="primary" loading={saving} onClick={() => { void save(); }}>Save</Button>
            </>
          }
        >
          <Field label="Description"><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Rewinding, LT motor up to 50 HP" autoFocus /></Field>
          <Field label="Category">
            <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as PricingCategory })}>
              {PRICING_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </Select>
          </Field>
          <Field label="Unit"><Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="per job" /></Field>
          <Field label={moneyLabel("Rate", cur)}><Input type="number" min="0" inputMode="decimal" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} placeholder="0" /></Field>
          <details className={s.more}>
            <summary>More</summary>
            <div className={s.moreBody}>
              <Field label="Notes"><Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
            </div>
          </details>
          {error && <div role="alert" className={s.err}>{error}</div>}
        </SidePanel>
      )}
    </div>
  );
}
