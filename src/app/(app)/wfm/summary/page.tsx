import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage, requireWfm, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getMonthlySummary } from "@/lib/wfm/monthlySummary";
import { createAdminSupabase } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import SummaryClient from "./SummaryClient";

export default async function WfmSummaryPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  // Server-prefetch the current month's summary so the page paints filled
  // instead of a blank table through one full Seoul round-trip on open.
  // requireWfm() is cache()-wrapped, so this re-uses the context the guard
  // above already resolved. The API route stays the refresh path (month
  // change). Null on any failure -> client falls back to its own load().
  type Initial = React.ComponentProps<typeof SummaryClient>["initial"];
  let initial: Initial = null;
  try {
    const ctx = await requireWfm();
    const config = await getWfmConfig(createAdminSupabase(), ctx.tenantId);
    const month = new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timezone, year: "numeric", month: "2-digit",
    }).format(new Date()).slice(0, 7);
    const scope = await resolveWfmScope(ctx);
    const employees = await getMonthlySummary(
      ctx.tenantId, month, scope.unrestricted ? undefined : (scope.employeeIds ?? [])
    );
    initial = { month, employees, deduct_breaks: config.deduct_breaks } as Initial;
  } catch {
    initial = null;
  }

  return (
    <>
      <TabTitle title="Time Summary" />
      <PageHeader
        title="Time Summary"
        subtitle="Per-employee attendance for the CA — days present, hours, late marks, leave, holidays and night-shift allowance."
      />
      <SummaryClient initial={initial} />
    </>
  );
}
