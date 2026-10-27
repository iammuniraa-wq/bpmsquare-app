import { ROUTES } from "@/lib/constants";
import type { LinkObjectType } from "./types";

/**
 * Where a record an email became is opened. A plain Lead has no screen of its own unless the workspace also owns lead
 * scoring (the scored-lead page); without it the Leads list is the nearest honest place.
 */
export function linkHref(type: LinkObjectType, id: string, features?: Record<string, boolean | undefined> | null): string {
  switch (type) {
    case "standard_quotes": return ROUTES.standardQuote(id);
    case "wfm_projects": return ROUTES.wfmProject(id);
    case "cases": return ROUTES.case(id);
    case "estimates": return ROUTES.estimate(id);
    case "leads": return features?.marketing_scoring ? ROUTES.marketingLead(id) : ROUTES.leads;
    case "opportunities": return ROUTES.pipelineDetail(id);
  }
}

/** The table a linked object lives in (verified, tenant-scoped, before a link is stored). */
export const LINK_TABLE: Record<LinkObjectType, string> = {
  standard_quotes: "standard_quotes", wfm_projects: "wfm_projects", cases: "service_cases", estimates: "estimates", leads: "leads", opportunities: "opportunities",
};

/** The module a linked object needs, and the workcenter whose create grant makes it. */
export const LINK_ACCESS: Record<LinkObjectType, { feature: string; also?: string; workcenter: "standard_quotes" | "wfm" | "cases" | "estimates" | "leads" | "pipeline" }> = {
  standard_quotes: { feature: "standard_quotes", workcenter: "standard_quotes" },
  wfm_projects: { feature: "wfm_projects", workcenter: "wfm" },
  cases: { feature: "cases", workcenter: "cases" },
  estimates: { feature: "estimator", workcenter: "estimates" },
  leads: { feature: "leads", workcenter: "leads" },
  // A deal made from an e-mail is a tender (GCC tender deals): offered only to a workspace with the platform-admin flag
  // `gcc_tender`, and it needs the Pipeline as well.
  opportunities: { feature: "gcc_tender", also: "pipeline", workcenter: "pipeline" },
};
