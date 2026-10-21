import type { MonitorMessage } from "./api";

// The five ticks at the top of the page (docs/design/integration-middleware.md,
// "Easy to use" 1): connected, price list and currency picked, what goes out
// chosen, a test quote sent, the first real quote seen. Each opens the tab
// where it is done. Pure: the page feeds it what it already read.

export const TAB_IDS = ["connections", "out", "mapping", "monitor", "resync"] as const;
export type TabId = (typeof TAB_IDS)[number];
export const TAB_LABEL: Record<TabId, string> = {
  connections: "Connections",
  out: "What goes out",
  mapping: "Mapping",
  monitor: "Monitor",
  resync: "Resync",
};

export type SetupInputs = {
  connected: boolean;
  /** Only Dynamics 365 Sales needs a price list and a currency; other products tick this step by themselves. */
  pickListsApplicable: boolean;
  priceListChosen: boolean;
  currencyChosen: boolean;
  /** At least one of "awarded" and "rejected" is switched on. */
  outcomeOn: boolean;
  testSent: boolean;
  realSeen: boolean;
};

export type SetupStepId = "connect" | "pick" | "out" | "test" | "real";
export type SetupStep = { id: SetupStepId; label: string; state: string; done: boolean; tab: TabId };

export type SetupStatus = { steps: SetupStep[]; doneCount: number; complete: boolean };

export function deriveSetup(i: SetupInputs): SetupStatus {
  const pickDone = i.connected && (!i.pickListsApplicable || (i.priceListChosen && i.currencyChosen));
  const steps: SetupStep[] = [
    { id: "connect", label: "Connect", state: i.connected ? "Connected" : "Not yet", done: i.connected, tab: "connections" },
    {
      id: "pick", label: "Price list and currency",
      state: !i.connected ? "Not yet" : !i.pickListsApplicable ? "Not needed" : pickDone ? "Chosen" : i.priceListChosen ? "Pick a currency" : "Pick a price list",
      done: pickDone, tab: "connections",
    },
    { id: "out", label: "What goes out", state: i.connected && i.outcomeOn ? "Chosen" : i.connected ? "Nothing is switched on" : "Not yet", done: i.connected && i.outcomeOn, tab: "out" },
    { id: "test", label: "Send a test quote", state: i.testSent ? "Sent" : "Not yet", done: i.testSent, tab: "out" },
    { id: "real", label: "First real quote", state: i.realSeen ? "Seen" : "Not yet", done: i.realSeen, tab: "monitor" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, complete: doneCount === steps.length };
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
