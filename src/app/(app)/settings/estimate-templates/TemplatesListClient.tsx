"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";
import StatusPill from "@/components/ui/StatusPill";
import InfoTip from "@/components/ui/InfoTip";
import EmptyState from "@/components/ui/EmptyState";
import { useFeel } from "@/components/FeelProvider";
import { RecordList, RecordRow } from "@/components/settings/RecordRows";
import { SettingsHeaderActions } from "@/components/settings/SettingsHeaderActions";
import type { TemplateSummary } from "@/lib/estimator/server";
import { STARTER_TEMPLATES } from "@/lib/estimator/starterTemplates";
import StarterButton from "../../estimates/new/StarterButton";
import TemplatePanel from "./TemplatePanel";
import RateSheetPanel from "./RateSheetPanel";
import { RATE_SHEET_TIPS } from "@/lib/estimator/rateSheet/tips";

// The smallest template that validates: one input, one rate, one rule.
const BLANK_BODY = {
  inputs: [{ key: "quantity", label: "Quantity", type: "number", default: 1, min: 0 }],
  rates: [{ key: "unit_rate", label: "Unit rate", unit: "per unit", value: 0 }],
  rules: [{
    code: "item", group: "Items", description: "Item", uom: "nr", qty: "quantity",
    component: "materials", cost: { kind: "rate", rate: "unit_rate" },
  }],
};

export default function TemplatesListClient({ templates, illustrativeCount = 0 }: { templates: TemplateSummary[]; illustrativeCount?: number }) {
  const router = useRouter();
  const { confirm, toast } = useFeel();
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rates, setRates] = useState(false);
  const open = templates.find((t) => t.id === openId) ?? null;
  const have = new Set(templates.map((t) => t.name.toLowerCase()));
  const missingStarters = STARTER_TEMPLATES.filter((s) => !have.has(s.name.toLowerCase()));
  // The pipework, precast and civil starters price from catalogue items: one button adds the ones this workspace lacks, with their items.
  const missingPriced = missingStarters.filter((s) => (s.catalogue ?? []).length > 0);
  const missingOthers = missingStarters.filter((s) => (s.catalogue ?? []).length === 0);

  async function call(url: string, init: RequestInit, failText: string): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { toast({ text: (json.error as string) ?? failText, tone: "error" }); return null; }
      return json;
    } catch {
      toast({ text: "Network error. Try again.", tone: "error" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addPriced() {
    setBusy(true);
    try {
      for (const s of missingPriced) {
        const res = await fetch("/api/estimate-templates/from-starter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: s.name }) });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          toast({ text: json.error ?? `Could not add "${s.name}".`, tone: "error" });
          break;
        }
      }
      router.refresh();
    } catch {
      toast({ text: "Network error. Try again.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const names = new Set(templates.map((t) => t.name.toLowerCase()));
    let name = "New template";
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `New template ${n}`;
    const json = await call("/api/estimate-templates", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...BLANK_BODY }),
    }, "Could not create the template.");
    const id = (json?.template as { id?: string } | undefined)?.id;
    if (id) router.push(ROUTES.settingsEstimateTemplate(id));
  }

  async function duplicate(t: TemplateSummary) {
    const json = await call(`/api/estimate-templates/${t.id}/duplicate`, { method: "POST" }, "Could not duplicate the template.");
    const id = (json?.template as { id?: string } | undefined)?.id;
    if (id) {
      toast({ text: t.locked ? `Made your own copy of "${t.name}"` : `Duplicated "${t.name}"`, tone: "success" });
      setOpenId(null);
      router.push(ROUTES.settingsEstimateTemplate(id));
    }
  }

  async function setActive(t: TemplateSummary, active: boolean) {
    const json = await call(`/api/estimate-templates/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: active }),
    }, "Could not update the template.");
    if (json) router.refresh();
  }

  async function remove(t: TemplateSummary) {
    if (!(await confirm({ title: `Delete "${t.name}"?`, body: "This can't be undone. A template that estimates were made from can only be deactivated.", tone: "danger" }))) return;
    const json = await call(`/api/estimate-templates/${t.id}`, { method: "DELETE" }, "Could not delete the template.");
    if (json) router.refresh();
  }

  return (
    <>
      <SettingsHeaderActions>
        <Button variant="secondary" onClick={() => setRates(true)} data-guide="rate.sheet.open">Import rate sheet</Button>
        <Button variant="primary" loading={busy} onClick={create}>+ New template</Button>
      </SettingsHeaderActions>
      {illustrativeCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }} data-guide="rate.sheet.illustrative">
          <StatusPill label={`${illustrativeCount} illustrative rate${illustrativeCount === 1 ? "" : "s"}`} tone="amber" />
          <InfoTip label="Illustrative rates">{RATE_SHEET_TIPS.illustrative}</InfoTip>
        </div>
      )}
      <RecordList
        empty={
          <EmptyState
            title="No estimate templates yet"
            text="Start from the illustrative precast villa starter and reshape it, or build one from scratch with + New template."
            action={<StarterButton />}
          />
        }
      >
        {templates.map((t) => (
          <RecordRow
            key={t.id}
            title={t.name}
            subtitle={t.description ?? undefined}
            dim={!t.is_active}
            facts={[
              ...(t.locked ? [{ label: "Type", value: "Starter, read-only" }] : []),
              { label: "Inputs", value: t.input_count },
              { label: "Rules", value: t.rule_count },
              { label: "Estimates", value: t.estimate_count },
              { label: "Version", value: t.version },
            ]}
            status={<StatusPill label={t.is_active ? "Active" : "Inactive"} tone={t.is_active ? "green" : "red"} />}
            menu={[
              { label: "Details", onSelect: () => setOpenId(t.id) },
              { label: "Copy to customise", hidden: !t.locked, onSelect: () => { void duplicate(t); } },
              { label: "Edit", href: ROUTES.settingsEstimateTemplate(t.id), hidden: t.locked },
              { label: "Duplicate", hidden: t.locked, onSelect: () => { void duplicate(t); } },
              { label: t.is_active ? "Deactivate" : "Activate", onSelect: () => { void setActive(t, !t.is_active); } },
              { label: "Delete", danger: true, onSelect: () => { void remove(t); } },
            ]}
          />
        ))}
      </RecordList>
      {templates.length > 0 && missingStarters.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {missingPriced.length > 0 && (
            <Button variant="secondary" loading={busy} onClick={() => { void addPriced(); }} data-guide="rate.sheet.add_starters">
              {`Add the pipework, precast and civil starters (${missingPriced.length})`}
            </Button>
          )}
          {missingOthers.map((s) => (
            <StarterButton key={s.name} variant="secondary" starter={s.name} label={`Add the ${s.name.replace(/ \(illustrative\)$/i, "").toLowerCase()} starter`} />
          ))}
        </div>
      )}
      {rates && <RateSheetPanel onClose={() => setRates(false)} onDone={() => { setRates(false); router.refresh(); }} />}
      {open && (
        <TemplatePanel
          key={open.id}
          template={open}
          busy={busy}
          onClose={() => setOpenId(null)}
          onCopy={() => { void duplicate(open); }}
          onEdit={() => router.push(ROUTES.settingsEstimateTemplate(open.id))}
          onSaved={() => { setOpenId(null); router.refresh(); }}
        />
      )}
    </>
  );
}
