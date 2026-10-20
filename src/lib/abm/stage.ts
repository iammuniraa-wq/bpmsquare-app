// Buying stage is read from Signals and nowhere else (docs/abm-architecture.md
// section 5.1): ABM never computes, edits or re-scores it, and there is no ABM
// score. Signals ships as its own module (src/lib/signals/stage.ts); this thin
// adapter keeps ABM working, with an empty stage, in a workspace or a build
// where that module is not there.
//
// The module is reached through a guarded require so a missing file is a
// quiet "no stage" and not a compile or load failure. Once Signals has landed
// everywhere this can become a plain import with no other change.

export const BUYING_STAGES = ["quiet", "looking", "comparing", "deciding"] as const;
export type BuyingStage = (typeof BUYING_STAGES)[number];
export const STAGE_LABEL: Record<BuyingStage, string> = { quiet: "Quiet", looking: "Looking", comparing: "Comparing", deciding: "Deciding" };

type SignalsStageModule = {
  getBuyingStage?: (tenantId: string, accountId: string) => Promise<unknown> | unknown;
};

let injected: SignalsStageModule | null | undefined;

/** Tests inject a fake (or null for "module missing"); production never calls this. */
export function __setSignalsStageModuleForTest(mod: SignalsStageModule | null | undefined) {
  injected = mod;
}

function loadModule(): SignalsStageModule | null {
  if (injected !== undefined) return injected;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@/lib/signals/stage") as SignalsStageModule;
  } catch {
    return null;
  }
}

/** Accepts the stage as a plain string or as an object carrying it; anything else is "no stage". */
export function normaliseStage(raw: unknown): BuyingStage | null {
  const value = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { stage?: unknown }).stage : null;
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  return (BUYING_STAGES as readonly string[]).includes(v) ? (v as BuyingStage) : null;
}

/** The account's buying stage, or null when Signals is off, missing, has nothing, or throws. */
export async function getAbmBuyingStage(tenantId: string, accountId: string): Promise<BuyingStage | null> {
  try {
    const mod = loadModule();
    if (!mod || typeof mod.getBuyingStage !== "function") return null;
    return normaliseStage(await mod.getBuyingStage(tenantId, accountId));
  } catch {
    return null;
  }
}

/** Stages for many accounts at once. A failure for one account leaves that one empty and never breaks the list. */
export async function getAbmBuyingStages(tenantId: string, accountIds: readonly string[]): Promise<Map<string, BuyingStage | null>> {
  const out = new Map<string, BuyingStage | null>();
  if (!loadModule()) {
    for (const id of accountIds) out.set(id, null);
    return out;
  }
  const unique = [...new Set(accountIds)].slice(0, 300);
  const results = await Promise.all(unique.map((id) => getAbmBuyingStage(tenantId, id)));
  unique.forEach((id, i) => out.set(id, results[i]));
  return out;
}
