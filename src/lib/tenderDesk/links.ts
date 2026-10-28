// Where each part of the dashboard's tender blocks goes when it is clicked. One place, so the blocks, the Tenders tab's filters
// (src/lib/tender/filters.ts) and the tests agree. Pure and client-safe.

import { ROUTES } from "@/lib/constants";
import type { TenderDeskBuyout } from "./types";

/** The Tenders tab of the Pipeline. */
export const TENDERS_TAB = `${ROUTES.pipeline}?tab=tenders`;

export const tenderLinks = {
  /** All tenders. */
  tab: TENDERS_TAB,
  /** Open tenders in one stage. */
  stage: (stage: string): string => `${TENDERS_TAB}&stage=${encodeURIComponent(stage)}`,
  /** Open tenders whose bid ends today or within `days` days. */
  closing: (days = 14): string => `${TENDERS_TAB}&closing=${days}`,
  /** Open tenders of one client (issuer account). */
  client: (accountId: string): string => `${TENDERS_TAB}&client=${encodeURIComponent(accountId)}`,
  /** Tenders decided won or lost, in one month ("2026-10") when given. */
  outcome: (outcome: "won" | "lost", month?: string): string => `${TENDERS_TAB}&outcome=${outcome}${month ? `&month=${encodeURIComponent(month)}` : ""}`,
  /** The Buy-out tab of the contract project the desk drew, else the contract projects list. */
  buyout: (buyout: TenderDeskBuyout | null | undefined): string => (buyout ? `${buyout.href}${buyout.href.includes("?") ? "&" : "?"}tab=buyout` : ROUTES.contractProjects),
};
