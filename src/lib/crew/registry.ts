// AI automation: the agent registry. ONE list drives both the gallery tiles (src/app/(app)/ai-automation) and the runner's
// cron loops, so adding an agent is one entry here (plus its logo component in src/components/crew/logos.tsx and its
// definition in src/lib/crew/definitions.ts), never a new layout. Pure data, client-safe: no server imports.

import type { TenantFeatures } from "@/lib/constants";
import { ROUTES } from "@/lib/constants";
import type { AgentKey, ScheduleDef, Sensitivity } from "./types";

/** Which logo component the tile draws (src/components/crew/logos.tsx). */
export type LogoKey = "tender_watch" | "attendance" | "quote_follow_up" | "invoice_chaser" | "lead_nurture" | "contract_renewal";

export type AgentEntry = {
  key: AgentKey;
  /** Product name on the tile and page header. */
  name: string;
  /** One plain line. */
  purpose: string;
  logo: LogoKey;
  /** The platform-admin flag that makes this agent available (besides `crew`). */
  flag: keyof TenantFeatures;
  /** Module flags that must also be on. */
  requires: (keyof TenantFeatures)[];
  /** The agent's own page. */
  href: string;
  /**
   * "ready" = the engine is wired and can run. "pending" = the tile shows "Needs setup" and nothing is enqueued; the lead flips
   * it to "ready" when the engine in src/lib/crew/<agent>/** is registered in definitions.ts.
   */
  engine: "ready" | "pending";
  /** Per-agent defaults (design section 3.7, 3.8, 3.13). The monthly cap is overridable per workspace by a platform admin. */
  defaults: { schedule: ScheduleDef; sensitivity: Sensitivity; monthlyTokenCap: number; retentionDays: number };
  /** The tile's accent (a CSS colour token pair, light and dark are handled by the logo itself). */
  accent: "amber" | "teal" | "violet" | "rose" | "blue" | "green";
};

export const AGENTS: readonly AgentEntry[] = [
  {
    key: "tender_watch",
    name: "Tender Watch",
    purpose: "Spots tenders at risk of missing their bid end date and says who is holding them up.",
    logo: "tender_watch",
    flag: "crew_tender_watch",
    requires: ["gcc_tender", "pipeline"],
    href: ROUTES.aiAutomationAgent("tender_watch"),
    engine: "ready",
    defaults: { schedule: { time: "07:30" }, sensitivity: "balanced", monthlyTokenCap: 600_000, retentionDays: 180 },
    accent: "amber",
  },
  {
    key: "attendance",
    name: "Attendance Anomalies",
    purpose: "Finds attendance patterns a daily list hides: a site, a day or a setting, not just a person.",
    logo: "attendance",
    flag: "crew_attendance",
    requires: ["wfm"],
    href: ROUTES.aiAutomationAgent("attendance"),
    // Flipped to "ready" by the lead once src/lib/crew/attendance/** is wired into definitions.ts.
    engine: "pending",
    defaults: { schedule: { time: "02:00", weeklyDay: 1 }, sensitivity: "balanced", monthlyTokenCap: 500_000, retentionDays: 90 },
    accent: "teal",
  },
];

/** Planned agents, shown quieter and not clickable so the gallery reads as a roadmap. No data, no sign-up. */
export type ComingSoon = { key: string; name: string; purpose: string; logo: LogoKey };

export const COMING_SOON: readonly ComingSoon[] = [
  { key: "quote_follow_up", name: "Quote Follow-up", purpose: "Notices quotes that went quiet and drafts the nudge.", logo: "quote_follow_up" },
  { key: "invoice_chaser", name: "Invoice Chaser", purpose: "Finds overdue invoices and drafts a polite reminder.", logo: "invoice_chaser" },
  { key: "lead_nurture", name: "Lead Nurture", purpose: "Picks the leads worth a personal touch this week.", logo: "lead_nurture" },
  { key: "contract_renewal", name: "Contract Renewal", purpose: "Watches contracts nearing their end and prepares the renewal.", logo: "contract_renewal" },
];

export function agentEntry(key: string): AgentEntry | undefined {
  return AGENTS.find((a) => a.key === key);
}

export function isAgentKey(key: unknown): key is AgentKey {
  return typeof key === "string" && AGENTS.some((a) => a.key === key);
}

/** The agents this workspace may see: `crew` on, the agent's own flag on, and its module flags on. */
export function availableAgents(features: Partial<TenantFeatures> | null | undefined): AgentEntry[] {
  if (features?.crew !== true) return [];
  return AGENTS.filter((a) => features[a.flag] === true && a.requires.every((k) => features[k] === true));
}
