import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { resolveCurrency } from "@/lib/currency";
import { modulePage, pendingMessage } from "@/lib/marketing/moduleAccess";
import { ATTRIBUTION_SPEC, loadReport, parseReportParams } from "@/lib/marketing/attribution/server";
import AttributionStudio from "./AttributionStudio";

export default async function AttributionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await modulePage(ATTRIBUTION_SPEC);
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const p = parseReportParams(sp);

  const report = await loadReport(ctx, p);
  if (report.missing) {
    return (
      <>
        <PageHeader title="Revenue by campaign" />
        <Card padding={0}><EmptyState title="Revenue by campaign is waiting for a database update" text={pendingMessage(ATTRIBUTION_SPEC)} /></Card>
      </>
    );
  }
  return (
    <AttributionStudio
      by={p.by} model={p.model} mode={p.mode} rows={report.rows} computedAt={report.computedAt} dealsConsidered={report.dealsConsidered}
      currency={resolveCurrency(ctx.tenant.config)} canRefresh={ctx.role === "admin" && ctx.can.edit}
    />
  );
}
