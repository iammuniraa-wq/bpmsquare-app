"use client";

// TEMPORARY visual-check route (deleted before commit). /login/zz-preview?theme=classic|nextgen|purple&look=bold|control
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import DashboardLayout from "@/components/DashboardLayout";
import { TenantProvider } from "@/lib/tenant-context";
import { FULL } from "@/components/tenderDesk/testFixtures";
import type { AnalyticsData } from "@/lib/data/labels";
import type { Tenant } from "@/lib/tenant";
import type { TenderDeskStyle } from "@/lib/tenderDesk/types";

const analytics = {
  totals: { accounts: 4, contacts: 0, customerAssets: 0, openCases: 0, workOrders: 0, activeContracts: 0, leads: 0, technicians: 0, products: 0, openDeals: 0, openDealValue: 0, weightedDealValue: 0, openRfqs: 0, rfqsToAward: 0, draftEstimates: 0, quotedEstimates: 0, abmTargets: 0, abmEngaged: 0, draftOrders: 0, openOrders: 0, openOrderValue: 0 },
  quoteOutcomeCounts: { open: 3, won: 4, lost: 2, dropped: 0 }, quoteOutcomeTotals: { open: 1, won: 1, lost: 1, dropped: 0 }, wfmCorrectionsByStatus: [], wfmRecheckByStatus: [], wfmLeaveRequestsByStatus: [], wfmWorkforceComposition: { totalActive: 0, supervisors: 0, fullTime: 0, contractors: 0 }, casesByStatus: [{ status: "intake", label: "Intake", count: 3 }, { status: "closed", label: "Closed", count: 5 }], quoteTrend: [], topAccountsByRevenue: [{ accountId: "a", name: "National Water Company", value: 5_000_000 }, { accountId: "b", name: "Coastal Developments", value: 3_000_000 }],
  invoiceTotals: { invoiced: 4_000_000, paid: 2_500_000, outstanding: 1_500_000 }, tender: FULL,
} as unknown as AnalyticsData;

function Preview() {
  const q = useSearchParams();
  const theme = q.get("theme") ?? "classic";
  const look = (q.get("look") ?? "bold") as TenderDeskStyle;
  const flag = q.get("flag") !== "off";
  const ui = theme === "purple" ? "spectacular_purple" : theme === "nextgen" ? "nextgen" : theme === "modern" ? "modern" : "classic";
  const tenant = {
    id: "t1", slug: "kamco", name: "KAMCO", logo_url: null, accent_color: "#378add", status: "active", plan: "enterprise",
    features: { gcc_tender: flag, pipeline: true, quotations: true, cases: true, accounts: true, work_orders: true, spectacular_theme: theme === "purple", invoices: true },
    company_info: {}, config: { appearance: { ui_theme: ui } }, custom_domain: null, api_key: null, is_demo: true,
  } as unknown as Tenant;
  return (
    <TenantProvider tenant={tenant} userRole="admin">
      <Shell>
        <DashboardLayout
          kpis={{ openCases: 8, inRepair: 2, awaitingApproval: 3, activeContracts: 1, openQuoteValue: 12_000_000, activeWorkOrders: 4 }}
          attention={[]} readyCases={[]} workOrderRows={[]} recentActivity={[]} overdueInvoices={[]}
          analytics={analytics} features={tenant.features} dashLayout={[]} isAdmin hasPersonalOverride={false} userName="Abdul"
          tenderLook={flag ? look : null}
        />
      </Shell>
    </TenantProvider>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Preview /></Suspense>;
}
