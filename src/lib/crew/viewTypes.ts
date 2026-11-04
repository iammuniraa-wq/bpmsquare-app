// The data the AI automation screens are given (client-safe, serialisable). Built by src/lib/crew/server/view.ts.

import type { TileStatus } from "./core/settings";
import type { LogoKey } from "./registry";
import type { AgentConfig, AgentKey, EvidenceView, FindingStatus, ProposalStatus, RunStatus, RunTrigger, Severity } from "./types";

export type TileDTO = {
  key: AgentKey;
  name: string;
  purpose: string;
  logo: LogoKey;
  accent: "amber" | "teal" | "violet" | "rose" | "blue" | "green";
  href: string;
  status: TileStatus;
  lastRunAt: string | null;
  lastRunNote: string | null;
  openFindings: number;
  used: number;
  cap: number;
  percent: number;
};

export type FindingDTO = {
  id: string;
  agent: AgentKey;
  kind: string;
  severity: Severity;
  title: string;
  body: string;
  evidence: EvidenceView[];
  gaps: string[];
  status: FindingStatus;
  createdAt: string;
  subjectId: string;
  /** Tender: the deal link, built by the server. */
  href: string | null;
  runId: string | null;
  /** A small visual for the card (tender: priced/unpriced bar and days left), taken from the run's stored facts. */
  visual: { pricedPct: number | null; daysLeft: number | null; unpriced: number | null; lines: number | null } | null;
};

export type ProposalDTO = {
  id: string;
  findingId: string;
  actionKey: string;
  message: string;
  toNames: string[];
  status: ProposalStatus;
  expiresAt: string;
  /** True when the viewer may press Edit and send. */
  canDecide: boolean;
};

export type RunDTO = {
  id: string;
  agent: AgentKey;
  agentName: string;
  trigger: RunTrigger;
  because: string;
  status: RunStatus;
  at: string;
  tokens: number;
  findings: number;
  proposals: number;
  note: string | null;
  error: string | null;
};

export type AgentSettingsDTO = {
  enabled: boolean;
  paused: boolean;
  config: AgentConfig;
  cap: number;
  used: number;
  percent: number;
  digestOn: boolean;
  /** The workspace has no time zone yet (Tender Watch cannot be switched on). */
  needsTimezone: boolean;
};

export type CrewView = {
  pending: boolean;
  isAdmin: boolean;
  workspacePaused: boolean;
  platformStopped: boolean;
  tiles: TileDTO[];
  findings: FindingDTO[];
  proposals: ProposalDTO[];
  runs: RunDTO[];
  runsVisible: boolean;
  settings: Partial<Record<AgentKey, AgentSettingsDTO>>;
};
