"use client";

import { useEffect, useMemo, useState } from "react";
import RecordActivity from "@/components/page/RecordActivity";
import ObjectSections from "@/components/fields/ObjectSections";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import EstimateWorkspace from "@/components/estimator/workspace/EstimateWorkspace";
import Collapsible from "@/components/estimator/workspace/Collapsible";
import { PriceBuiltFold, ScheduleRiskPanel } from "@/components/estimator/workspace/InternalFolds";
import { hasBuildSchedule } from "@/components/estimator/workspace/layoutKind";
import { buildSavedEstimate, toWorkspaceTemplate } from "@/components/estimator/workspace/savedEstimate";
import { ESTIMATE_TAB_IDS, estimateTabs, landingTab, scrollTargetFor, tabTarget } from "@/components/estimator/workspace/tabTargets";
import type { AccountOption, ContactOption } from "@/components/estimator/AccountPicker";
import type { Estimate, EstimateLine, EstimateTemplate } from "@/lib/types";
import type { LineProductView } from "@/lib/estimator/productItems";
import { toBomGroups } from "./bomView";
import BomTab from "./BomTab";
import DetailsCard from "./DetailsCard";
import ExportBar from "./ExportBar";

export type EstimateScreenProps = {
  estimate: Estimate;
  lines: EstimateLine[];
  template: EstimateTemplate | null;
  templateOutdated: boolean;
  account: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  quote: { id: string; ref: string; status: string } | null;
  vatPct: number;
  createdLabel: string;
  canEdit: boolean;
  canQuote: boolean;
  quoteUnavailable: string | null;
  /** The estimate belongs to a tender deal (no Create quote; the email source starts closed). */
  fromTender?: boolean;
  isAdmin: boolean;
  accounts: AccountOption[];
  contacts: ContactOption[];
  /** The catalogue products behind the lines, by product id. */
  lineProducts: Record<string, LineProductView>;
  /** The `?tab=` (today's, or an old bookmarked one) and the old `?line=`. */
  tab?: string;
  line?: string;
};

/**
 * /estimates/[id]: a saved estimate as three or four tabs (`?tab=`, so a reload or a shared link lands on the same one).
 *
 *   Estimate            the working page: inputs, the model, the price with the one breakdown; "How the price is built" closed under it
 *   Materials           the bill of materials, and the files for the ERP (closed until opened)
 *   Schedule & risk     only for a template with a build schedule
 *   Details & activity  status, notes, custom fields, the timeline and the change history
 *
 * The working page stays mounted behind the other tabs, so unsaved edits survive a look at the materials. An old `?tab=` link lands on
 * the tab its content moved to.
 */
export default function EstimateScreen(p: EstimateScreenProps) {
  const { estimate: e, template } = p;
  const schedule = hasBuildSchedule(template?.geometry);
  const tabs = useMemo(() => estimateTabs({ schedule, saved: true }), [schedule]);
  const [tab, setTab] = useUrlTab(ESTIMATE_TAB_IDS);
  const active = tabs.some((t) => t.id === tab) ? tab : "estimate";
  const target = useMemo(() => tabTarget(p.tab), [p.tab]);
  const [priceOpen, setPriceOpen] = useState(!!target?.openPrice);
  const [erpOpen, setErpOpen] = useState(false);

  useEffect(() => {
    const land = landingTab(target, !!p.line);
    if (land) setTab(land);
    const id = scrollTargetFor(target, !!p.line);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saved = useMemo(
    () => buildSavedEstimate({ estimate: e, lines: p.lines, template, templateOutdated: p.templateOutdated, quote: p.quote, vatPct: p.vatPct }),
    [e, p.lines, template, p.templateOutdated, p.quote, p.vatPct],
  );
  const templates = useMemo(() => (template ? [toWorkspaceTemplate(template)] : []), [template]);
  const locked = saved.locked;

  return (
    <EstimateWorkspace
      templates={templates}
      init={{ templateId: template?.id ?? "", params: e.params ?? {}, margin: e.margin_pct, customer: e.name, accountId: e.account_id ?? "", contactId: e.contact_id ?? "" }}
      vatPct={p.vatPct}
      accounts={p.accounts}
      contacts={p.contacts}
      canEdit={p.canEdit}
      canQuote={p.canQuote}
      quoteUnavailable={p.quoteUnavailable}
      fromTender={p.fromTender}
      saved={saved}
      initialHighlight={p.line ?? null}
      tabs={() => ({ strip: <Tabs tabs={tabs} value={active} onChange={setTab} label="Estimate sections" />, main: active === "estimate" })}
      onShowMain={() => setTab("estimate")}
      renderInternal={(shown) => (
        <>
          {active === "estimate" && (
            <PriceBuiltFold shown={shown} fold={{ open: priceOpen, onToggle: setPriceOpen }} estimateId={e.id} canReview={p.canEdit} />
          )}
          {active === "materials" && (
            <>
              {shown.live && <div className="est-warn">You have unsaved changes. Save them on the Estimate tab to bring the bill of materials up to date.</div>}
              <BomTab
                estimateId={e.id} groups={toBomGroups(p.lines, template?.rules ?? [], p.lineProducts)} locked={locked} canEdit={p.canEdit}
                hasSchedule={p.lines.some((l) => l.source === "schedule")} hasTemplate={!!template}
              />
              <Collapsible id="erp" title="Send to your ERP" hint="item list and work breakdown" open={erpOpen} onToggle={setErpOpen}>
                <ExportBar estimateId={e.id} />
              </Collapsible>
            </>
          )}
          {active === "schedule" && <ScheduleRiskPanel shown={shown} rules={template?.rules ?? []} rates={template?.rates ?? []} geometry={template?.geometry}
              record={{ id: e.id, canEdit: p.canEdit, locked, hasQuote: !!p.quote || !!e.standard_quote_id }} />}
          {active === "activity" && (
            <>
              <DetailsCard
                id={e.id} name={e.name} notes={e.notes} status={e.status}
                accountId={p.account?.id ?? null} accountName={p.account?.name ?? null}
                contactId={p.contact?.id ?? null} contactName={p.contact?.name ?? null}
                templateName={template?.name ?? null} templateVersion={e.template_version}
                templateOutdated={p.templateOutdated} currency={e.currency} marginPct={e.margin_pct}
                createdLabel={p.createdLabel} canEdit={p.canEdit} locked={locked} accounts={p.accounts} contacts={p.contacts}
              />
              <ObjectSections objectType="estimate" record={e as unknown as Record<string, unknown>} patchUrl={`/api/estimates/${e.id}`}
                exclude={["ref", "name", "status", "currency", "margin_pct", "notes"]} />
              <RecordActivity objectType="estimates" objectId={e.id} isAdmin={p.isAdmin} />
            </>
          )}
        </>
      )}
    />
  );
}
