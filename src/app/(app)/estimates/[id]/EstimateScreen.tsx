"use client";

import { useEffect, useMemo, useState } from "react";
import RecordActivity from "@/components/page/RecordActivity";
import ObjectSections from "@/components/fields/ObjectSections";
import EstimateWorkspace from "@/components/estimator/workspace/EstimateWorkspace";
import Collapsible from "@/components/estimator/workspace/Collapsible";
import { PriceBuiltFold, ScheduleRiskFold } from "@/components/estimator/workspace/InternalFolds";
import { hasBuildSchedule } from "@/components/estimator/workspace/layoutKind";
import { buildSavedEstimate, toWorkspaceTemplate } from "@/components/estimator/workspace/savedEstimate";
import { SECTION_IDS, scrollTargetFor, tabTarget } from "@/components/estimator/workspace/tabTargets";
import type { SectionId } from "@/components/estimator/workspace/tabTargets";
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
  /** The old `?tab=` and `?line=` of a bookmarked link. */
  tab?: string;
  line?: string;
};

/**
 * /estimates/[id]: the working page for a saved estimate, then the internal
 * sections, closed until opened (how the price is built, build schedule and
 * risk, bill of materials, ERP files, details), then the activity. An old
 * `?tab=` link opens the section its tab became.
 */
export default function EstimateScreen(p: EstimateScreenProps) {
  const { estimate: e, template } = p;
  const target = useMemo(() => tabTarget(p.tab), [p.tab]);
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => Object.fromEntries(SECTION_IDS.map((id) => [id, target?.open === id])) as Record<SectionId, boolean>);
  const fold = (id: SectionId) => ({ open: open[id], onToggle: (v: boolean) => setOpen((o) => ({ ...o, [id]: v })) });

  useEffect(() => {
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
      renderInternal={(shown) => (
        <>
          <PriceBuiltFold shown={shown} fold={fold("price")} estimateId={e.id} canReview={p.canEdit} />
          {hasBuildSchedule(template?.geometry) && <ScheduleRiskFold shown={shown} rules={template?.rules ?? []} rates={template?.rates ?? []} fold={fold("schedule")} />}
          <Collapsible id="bom" title="Bill of materials" hint="for your team and the factory" {...fold("bom")}>
            {shown.live && <div className="est-warn">You have unsaved changes. Save them to bring the bill of materials up to date.</div>}
            <BomTab
              estimateId={e.id} groups={toBomGroups(p.lines, template?.rules ?? [], p.lineProducts)} locked={locked} canEdit={p.canEdit}
              hasSchedule={p.lines.some((l) => l.source === "schedule")} hasTemplate={!!template}
            />
          </Collapsible>
          <Collapsible id="erp" title="Send to your ERP" hint="item list and work breakdown" {...fold("erp")}>
            <ExportBar estimateId={e.id} />
            <p className="bpm-t-help" style={{ margin: 0 }}>Sending a won estimate straight into your ERP comes later, after a test on a live system.</p>
          </Collapsible>
          <Collapsible id="details" title="Details" hint="status, notes, custom fields" {...fold("details")}>
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
          </Collapsible>
          <div id="activity" style={{ scrollMarginTop: 80 }}>
            <RecordActivity objectType="estimates" objectId={e.id} isAdmin={p.isAdmin} />
          </div>
        </>
      )}
    />
  );
}
