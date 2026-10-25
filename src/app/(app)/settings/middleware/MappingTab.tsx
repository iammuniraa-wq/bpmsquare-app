"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import InfoTip from "@/components/ui/InfoTip";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useFeel } from "@/components/FeelProvider";
import s from "./middleware.module.css";
import { callWebhooksFor, listWebhooks } from "../webhooks/api";
import { orgKindsFor } from "@/lib/middleware/erpOrgPure";
import { useMw } from "./context";
import { hasOutbound } from "./connectors";
import { documentChoices, inboundChoices, isWebhookConnection } from "./mappingLogic";
import MappingFields from "./MappingFields";
import MappingValueLists from "./MappingValueLists";
import { MIDDLEWARE_TIPS } from "./tips";
import { Segmented } from "./ui";

const VIEWS = ["fields", "values"] as const;

export default function MappingTab() {
  const mw = useMw();
  const { confirm } = useFeel();
  const params = useSearchParams();
  // A connector that only reads (SAP S/4HANA) maps what comes in: no quote and no webhook targets.
  const outbound = hasOutbound(mw.connector.id);
  // SAP maps only what comes in, but it has one list of its own: the sales area of a coverage or an order type (SO4). That is the whole of its Value mapping.
  const hasValues = outbound || orgKindsFor(mw.connector.id).length > 0;
  const [view, setView] = useUrlTab(VIEWS, "view");
  const [key, setKey] = useState<string>(() => {
    const c = params.get("connection");
    return c && isWebhookConnection(c) && outbound ? c : outbound ? "quote" : "customers";
  });
  const [dirty, setDirty] = useState(false);
  const [webhooks, setWebhooks] = useState<{ id: string; name: string }[]>([]);

  // A Call webhook for Standard Quotes is a target of its own; a workspace without webhooks simply has none.
  useEffect(() => {
    if (!outbound) return;
    let live = true;
    listWebhooks()
      .then((l) => { if (live) setWebhooks(callWebhooksFor(l.webhooks, "standard_quotes").map((w) => ({ id: w.id, name: w.name }))); })
      .catch(() => { if (live) setWebhooks([]); });
    return () => { live = false; };
  }, [outbound]);

  const quote = mw.documents.data?.documents.find((d) => d.key === "quote");
  const choices = useMemo(
    () => (outbound ? documentChoices(mw.connector.shortName, quote?.target.label ?? null, mw.connector.id, webhooks) : inboundChoices(mw.connector.shortName, mw.connector.id)),
    [outbound, mw.connector.shortName, mw.connector.id, quote?.target.label, webhooks],
  );
  const choice = choices.find((c) => c.key === key) ?? choices[0];

  const discard = async () => !dirty || (await confirm({ title: "Discard your changes?", body: "The fields you changed in this mapping have not been saved.", confirmLabel: "Discard", tone: "danger" }));
  const pick = async (next: string) => {
    if (next === key || !(await discard())) return;
    setDirty(false); setKey(next);
  };
  const switchView = async (next: (typeof VIEWS)[number]) => {
    if (next === view || !(await discard())) return;
    setDirty(false); setView(next);
  };

  return (
    <>
      <div className={s.rowBetween}>
        <span className="bpm-label-row">
          <h2 className="bpm-t-section">Mapping</h2>
          <InfoTip label="Mapping">{MIDDLEWARE_TIPS.mapping}</InfoTip>
        </span>
        <span className={`${s.row} bpm-tap`}>
          <select className="bpm-input" style={{ width: "auto", maxWidth: "100%" }} aria-label="Mapping for" value={choice.key} onChange={(e) => void pick(e.target.value)}>
            {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {hasValues && (
            <Segmented
              label="Mapping view" value={view as (typeof VIEWS)[number]} onChange={(v) => void switchView(v)}
              options={[{ id: "fields", label: "Fields" }, { id: "values", label: "Value mapping" }]}
            />
          )}
        </span>
      </div>
      {view === "values" && hasValues
        ? <MappingValueLists connection={choice.connection} system={choice.connection.startsWith("webhook:") ? choice.label : mw.connector.shortName} />
        : <MappingFields key={choice.key} choice={choice} onDirty={setDirty} />}
    </>
  );
}
