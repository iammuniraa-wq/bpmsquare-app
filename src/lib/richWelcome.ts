import type { TenantFeatures } from "@/lib/constants";
import type { AnalyticsData } from "@/lib/data/labels";

// The Rich dashboard's first screen for a workspace with no data yet (docs/design/rich-ui.md, "Get started"). A new client has nothing to count, so
// instead of zeros and "all caught up" the top of the page offers a short, module-aware list of first steps that tick themselves.

export type WelcomeStep = { key: string; title: string; sub: string; href: string; cta: string; done: boolean };
export type WelcomeModel = { fresh: boolean; steps: WelcomeStep[]; doneCount: number };

export type WelcomeInput = {
  features: Partial<TenantFeatures>;
  analytics: AnalyticsData;
  hasLogo: boolean;
  /** Members of the workspace, the person included. null when it could not be counted: the step is then shown as not done. */
  teamCount: number | null;
};

/** True when there is nothing to show yet: not one account, quote, case, lead, product, invoice, tender or person on the workforce. */
export function isFreshWorkspace(a: AnalyticsData): boolean {
  const t = a.totals;
  const records = t.accounts + t.contacts + t.customerAssets + t.openCases + t.workOrders + t.activeContracts + t.leads + t.technicians + t.products
    + t.openDeals + t.openRfqs + t.draftEstimates + t.quotedEstimates + t.abmTargets + t.draftOrders + t.openOrders;
  const quotes = a.quotesByStatus.reduce((s, q) => s + q.count, 0);
  const tender = a.tender && !a.tender.pending ? a.tender.kpis.openCount + a.tender.kpis.won12 + a.tender.kpis.lost12 : 0;
  return records + quotes + a.invoiceTotals.invoiced + tender + (a.wfmWorkforceComposition?.totalActive ?? 0) === 0;
}

/** The first records a client of this kind creates, in the order they usually start (at most two are offered). */
function firstRecordSteps(f: Partial<TenantFeatures>): WelcomeStep[] {
  const all: Array<[boolean, WelcomeStep]> = [
    [f.gcc_tender === true, { key: "tender", title: "Add your first tender", sub: "Track a bid from invitation to award.", href: "/pipeline/new/tender", cta: "Add tender", done: false }],
    [f.accounts === true, { key: "account", title: "Add your first account", sub: "A customer, supplier or partner.", href: "/accounts/new", cta: "Add account", done: false }],
    [f.quotations === true, { key: "quote", title: "Create a quotation", sub: "Price an offer and send it.", href: "/quotations/new", cta: "New quotation", done: false }],
    [f.cases === true, { key: "case", title: "Log a service case", sub: "A repair or support request.", href: "/cases/new", cta: "New case", done: false }],
    [f.wfm === true, { key: "workforce", title: "Set up sites and shifts", sub: "Where your people work, and when.", href: "/settings/workforce", cta: "Open setup", done: false }],
    [f.products === true, { key: "product", title: "Add your products", sub: "What you sell, with prices.", href: "/products/new", cta: "Add product", done: false }],
  ];
  return all.filter(([on]) => on).slice(0, 2).map(([, s]) => s);
}

export function buildWelcome(input: WelcomeInput): WelcomeModel {
  const fresh = isFreshWorkspace(input.analytics);
  const steps: WelcomeStep[] = [
    { key: "profile", title: "Add your company details", sub: "Name and logo on every document.", href: "/settings/company", cta: "Open profile", done: input.hasLogo },
    { key: "data", title: "Bring in your data", sub: "Upload a spreadsheet of what you already have.", href: "/data-workbench", cta: "Import data", done: !fresh },
    { key: "team", title: "Invite your team", sub: "Choose who sees what.", href: "/settings/people", cta: "Invite people", done: (input.teamCount ?? 0) > 1 },
    ...firstRecordSteps(input.features).map((s) => ({ ...s, done: !fresh })),
  ];
  return { fresh, steps, doneCount: steps.filter((s) => s.done).length };
}
