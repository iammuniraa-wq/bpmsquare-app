import type { MonitorMessage } from "./api";

// The one slim line at the top of the page: "Set up 3 of 5 · Next: send a test quote"
// (docs/design/integration-middleware.md, round 2 C). Five checks from connected to the
// first real quote; hidden when all are done. Pure: the page feeds it what it already read.

export const TAB_IDS = ["links", "mapping", "monitor", "resync"] as const;
export type TabId = (typeof TAB_IDS)[number];
export const TAB_LABEL: Record<TabId, string> = {
  links: "Links",
  mapping: "Mapping",
  monitor: "Monitor",
  resync: "Resync",
};

export type SetupInputs = {
  connected: boolean;
  /** At least one link is switched on. */
  outcomeOn: boolean;
  /** The link panel was saved once (`confirmed_at`); the defaults being on is not a choice. */
  outcomeConfirmed: boolean;
  /** Customers have been read from the ERP at least once (a quote needs its customer there). True where the product has no such step. */
  customersSynced: boolean;
  testSent: boolean;
  realSeen: boolean;
};

export type SetupStepId = "connect" | "links" | "customers" | "test" | "real";
/** Where a step is finished: a tab, or the connection panel behind the connector chip. */
export type SetupTarget = TabId | "connection";
export type SetupStep = { id: SetupStepId; label: string; next: string; done: boolean; target: SetupTarget };

export type SetupStatus = { steps: SetupStep[]; doneCount: number; complete: boolean; next: SetupStep | null };

export function deriveSetup(i: SetupInputs): SetupStatus {
  const steps: SetupStep[] = [
    { id: "connect", label: "Connect", next: "connect your ERP", done: i.connected, target: "connection" },
    { id: "links", label: "Choose the links", next: "open Links and save once", done: i.connected && i.outcomeOn && i.outcomeConfirmed, target: "links" },
    { id: "customers", label: "Read customers", next: "read your customers in Resync", done: i.connected && i.customersSynced, target: "resync" },
    { id: "test", label: "Send a test quote", next: "send a test quote", done: i.testSent, target: "links" },
    { id: "real", label: "First real quote", next: "award a quote and watch it in Monitor", done: i.realSeen, target: "monitor" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, complete: doneCount === steps.length, next: steps.find((s) => !s.done) ?? null };
}

/** A connector that only reads (SAP S/4HANA): connect, then read customers. Nothing is sent, so nothing about sending is asked. */
export function deriveInboundSetup(i: Pick<SetupInputs, "connected" | "customersSynced">): SetupStatus {
  const steps: SetupStep[] = [
    { id: "connect", label: "Connect", next: "connect your ERP", done: i.connected, target: "connection" },
    { id: "customers", label: "Read customers", next: "read your customers in Resync", done: i.connected && i.customersSynced, target: "resync" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, complete: doneCount === steps.length, next: steps.find((s) => !s.done) ?? null };
}

/** "Set up 3 of 5 · Next: send a test quote"; empty once everything is done. */
export function slimLine(status: SetupStatus): string {
  if (status.complete || !status.next) return "";
  return `Set up ${status.doneCount} of ${status.steps.length} · Next: ${status.next.next}`;
}

/** The test quote's reference starts with this (the product never deletes it). */
export const TEST_REF_PREFIX = "ZZ";

const isTestRef = (m: MonitorMessage) =>
  (m.record?.label ?? "").toUpperCase().startsWith(TEST_REF_PREFIX) || /\bZZ-TEST\b/i.test(m.summary);

/**
 * What the recent outgoing messages prove: a test quote went through, and a
 * real Standard Quote did. A message that did not reach the ERP counts for neither.
 */
export function sentEvidence(items: readonly MonitorMessage[]): { testSent: boolean; realSeen: boolean } {
  let testSent = false;
  let realSeen = false;
  for (const m of items) {
    if (m.direction !== "out" || m.channel !== "connector" || m.status !== "ok") continue;
    if (isTestRef(m)) testSent = true;
    else if (m.record?.type === "standard_quotes") realSeen = true;
  }
  return { testSent, realSeen };
}
