"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { toBody, toDraft, type TemplateDraft } from "@/components/estimator/templateDraft";
import { useTemplateCheck } from "@/components/estimator/useTemplateCheck";
import type { TemplateIssue } from "@/lib/estimator/template";
import type { EstimateTemplate } from "@/lib/types";
import DetailsSection from "./DetailsSection";
import InputsEditor from "./InputsEditor";
import RatesEditor from "./RatesEditor";
import RulesEditor from "./RulesEditor";
import DrawingEditor from "./DrawingEditor";
import CheckPanel from "./CheckPanel";

const TAB_IDS = ["details", "inputs", "rates", "rules", "check"] as const;

const countUnder = (issues: TemplateIssue[], root: string) => issues.filter((i) => i.path === root || i.path.startsWith(`${root}[`) || i.path.startsWith(`${root}.`)).length;

export default function TemplateEditor({ template, estimateCount }: { template: EstimateTemplate; estimateCount: number }) {
  const router = useRouter();
  const [tab, setTab] = useUrlTab(TAB_IDS);
  const initial = useMemo(() => toDraft(template), [template]);
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [version, setVersion] = useState(template.version);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [saveIssues, setSaveIssues] = useState<TemplateIssue[]>([]);
  const [activeRule, setActiveRule] = useState<number | null>(null);

  // The layer map needs migration 0215; while the column is missing the section says so and the map is never sent.
  const drawingAvailable = "drawing_map" in template;
  // The picture settings need migration 0235 the same way; without the column the picture is inferred from the inputs.
  const visualAvailable = "visual" in template;
  const dirty = JSON.stringify(draft) !== savedJson;
  const body = useMemo(() => toBody(draft), [draft]);
  const formula = activeRule !== null ? (draft.rules[activeRule]?.qty ?? null) : null;
  const check = useTemplateCheck(body, formula);
  const issues = check.result ? [...check.result.issues, ...check.result.example_issues] : saveIssues;
  const patch = (p: Partial<TemplateDraft>) => { setDraft((d) => ({ ...d, ...p })); setSaved(false); };

  async function save() {
    setSaving(true); setError(""); setSaveIssues([]);
    try {
      const res = await fetch(`/api/estimate-templates/${template.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name, description: draft.description, trade: draft.trade, quote_granularity: draft.quote_granularity,
          geometry: draft.geometry, inputs: body.inputs, rates: body.rates, rules: body.rules, expected_version: version,
          ...(drawingAvailable ? { drawing_map: body.drawing_map ?? [] } : {}),
          ...(visualAvailable ? { visual: body.visual ?? null } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not save the template.");
        if (Array.isArray(json.issues)) { setSaveIssues(json.issues as TemplateIssue[]); setTab("check"); }
        return;
      }
      setSavedJson(JSON.stringify(draft));
      setVersion((json.template as EstimateTemplate).version);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const problemCount = issues.length;
  return (
    <>
      <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />
      <div style={{ marginBottom: 10, fontSize: 12.5 }} className="bpm-t-help">
        <Link href={ROUTES.settingsEstimateTemplates} className="bpm-backlink">← All templates</Link>
        <span style={{ marginLeft: 10 }}>Version {version}{estimateCount > 0 ? ` · ${estimateCount} estimate${estimateCount === 1 ? "" : "s"} made from it keep their own numbers` : ""}</span>
      </div>
      <div style={{ marginBottom: 14 }}>
        <Tabs
          tabs={[
            { id: "details", label: "Details" },
            { id: "inputs", label: "Inputs", count: countUnder(issues, "inputs") + countUnder(issues, "drawing_map") },
            { id: "rates", label: "Rates", count: countUnder(issues, "rates") },
            { id: "rules", label: "Rules", count: countUnder(issues, "rules") },
            { id: "check", label: "Check", count: problemCount },
          ]}
          value={tab} onChange={(id) => setTab(id)}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
        {tab === "details" && <DetailsSection draft={draft} onChange={patch} visualAvailable={visualAvailable} />}
        {tab === "inputs" && (
          <>
            <InputsEditor inputs={draft.inputs} geometry={draft.geometry} onChange={(inputs) => patch({ inputs })} issues={issues} />
            <DrawingEditor rows={draft.drawing_map} inputs={draft.inputs} onChange={(drawing_map) => patch({ drawing_map })} issues={issues} available={drawingAvailable} />
          </>
        )}
        {tab === "rates" && <RatesEditor rates={draft.rates} onChange={(rates) => patch({ rates })} issues={issues} />}
        {tab === "rules" && (
          <RulesEditor
            rules={draft.rules} rates={draft.rates} onChange={(rules) => patch({ rules })} issues={issues}
            active={activeRule} onActive={setActiveRule} formula={check.result?.formula} formulaLoading={check.loading}
          />
        )}
        {tab === "check" && <CheckPanel draft={draft} check={check} />}
      </div>
    </>
  );
}
