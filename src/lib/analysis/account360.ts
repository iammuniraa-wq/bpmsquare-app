import "server-only";
import { analysisAccess, readCachedAnalysis, type AnalysisAccess, type AnalyseDeps } from "./service";
import type { AnalysisCard } from "./types";

// What the Account 360 drawer asks before it draws the Company analysis card: is this person allowed to see company
// analysis, and is there a saved one. It reads the cache only -- no web, no AI call, no daily limit used -- so opening
// the drawer costs nothing (docs/design/account-analysis.md 3, step 2). `null` means the card is not there at all.

export type Analysis360 = { card: AnalysisCard | null };

export async function loadAnalysis360(access: AnalysisAccess, accountId: string, deps?: AnalyseDeps): Promise<Analysis360 | null> {
  if (!analysisAccess(access).ok) return null;
  const r = await readCachedAnalysis(access, { accountId }, deps);
  // An unknown account is the drawer's own 404; any other failure simply leaves the card out rather than the drawer empty.
  if (!r.ok) return null;
  return { card: r.card };
}
