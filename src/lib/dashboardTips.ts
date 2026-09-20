import type { TenantFeatures } from "@/lib/constants";
import { ROUTES } from "@/lib/constants";
import type { PillarKey } from "@/lib/theme";

/**
 * Tips shown on the dashboard (owner request 2026-09-20).
 *
 * The problem they solve: a freshly provisioned workspace has no records, so
 * every analytics widget renders a zero and the dashboard tells the client
 * nothing. Tips have content from the first login and stay useful afterwards,
 * because most of what this product can do is not discoverable from the nav
 * alone -- bulk import, quote templates, saved views, the REST API.
 *
 * Deliberately NOT a getting-started checklist. A checklist is state (what has
 * this tenant done?), which means storage, write paths and a lifecycle; these
 * are content, which means a flat array and nothing else. The owner picked
 * tips and news over a checklist for exactly that reason.
 *
 * No "use client" and no JSX here, so the server layout resolver and the
 * client dashboard can both import it -- same constraint as analyticsMeta.ts,
 * and the same crash if it were broken (a "use client" export is a client
 * reference that can be rendered but not called from server code).
 *
 * `feature` gates a tip to a module the tenant actually bought -- a WFM-only
 * workspace must never be told about quote templates. A tip with no feature is
 * universal.
 */
export type DashboardTip = {
  id: string;
  title: string;
  body: string;
  /** Where "Show me" goes. Omitted for tips with no single destination. */
  href?: string;
  cta?: string;
  tone: PillarKey;
  feature?: keyof TenantFeatures;
};

export const DASHBOARD_TIPS: DashboardTip[] = [
  {
    id: "import",
    title: "Bring your existing data in",
    body: "Data Workbench imports accounts, contacts, products and more straight from Excel — download the template, paste your rows, upload. It validates before it writes, so a bad file costs you nothing.",
    href: ROUTES.dataWorkbench,
    cta: "Open Data Workbench",
    tone: "blue",
  },
  {
    id: "adapt",
    title: "Add the fields you actually use",
    body: "Every object takes your own custom fields, and they follow through to the detail screen, the API, exports and imports — not just the form.",
    href: ROUTES.settingsCustomFields,
    cta: "Add a field",
    tone: "purple",
  },
  {
    id: "dashboard",
    title: "This dashboard is yours to rearrange",
    body: "Adapt lets you add, resize, reorder or hide any block on this page. Start from a ready-made bundle per module if you would rather not pick block by block.",
    tone: "teal",
  },
  {
    id: "quote-templates",
    title: "Stop retyping the same scope",
    body: "Save reusable text fragments and drop them into a quotation instead of pasting from the last one. Terms, exclusions, scope of work — all of it.",
    href: ROUTES.settingsTemplates,
    cta: "Set up templates",
    tone: "amber",
    feature: "quotations",
  },
  {
    id: "api",
    title: "Connect your other systems",
    body: "A scoped REST key gives ERP, a website form or a partner read or write access to exactly the objects you choose — and nothing else.",
    href: ROUTES.settingsGeneral,
    cta: "Create an API key",
    tone: "green",
  },
  {
    id: "search",
    title: "Find anything without navigating",
    body: "Global search reaches every object you have permission to see. Accounts, quotes, cases, employees — start typing and go straight there.",
    tone: "blue",
  },
  {
    id: "roles",
    title: "People see only their own work centre",
    body: "Business roles decide which modules and screens each person gets, so a technician, a supervisor and an admin can share one workspace without sharing one view.",
    href: ROUTES.settingsTeam,
    cta: "Review roles",
    tone: "purple",
  },
  {
    id: "wfm-roster",
    title: "Set the roster once, not every week",
    body: "Shifts and standing site assignments drive attendance, overtime and the monthly summary automatically — the daily sheet builds itself from them.",
    href: ROUTES.wfmRoster,
    cta: "Open roster",
    tone: "teal",
    feature: "wfm",
  },
];

/** The tips a given workspace may see, module flags applied. */
export function tipsFor(features: TenantFeatures): DashboardTip[] {
  return DASHBOARD_TIPS.filter((t) => !t.feature || features[t.feature] === true);
}
