import type { CallsData } from "@/lib/tender/calls";
import type { BidsData } from "@/lib/tender/bids/rules";
import type { OutcomeData } from "@/lib/tender/outcome";

// The slice 4 screens (calls, outcome, bids) show server-rendered data. After a successful save each one reloads what it shows
// from its own endpoint, then tells its parent (`onChanged`) so the page's other facts (header, overdue chip, stage) refresh too --
// the same shape as BoqTab (`load()` + `onLinesChanged`). The reload never decides whether the save worked: a failed reload still
// tells the parent, which re-renders the page from the server.

export type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function reloadAfterSave<T>(url: string, apply: (fresh: T) => void, onChanged?: () => void, fetcher: Fetcher = fetch): Promise<boolean> {
  let reloaded = false;
  try {
    const res = await fetcher(url, { cache: "no-store" });
    if (res.ok) { apply((await res.json()) as T); reloaded = true; }
  } catch { /* the parent's refresh below still runs */ }
  onChanged?.();
  return reloaded;
}

export const callsUrl = (opportunityId: string) => `/api/opportunities/${opportunityId}/tender/calls`;
export const bidsUrl = (opportunityId: string) => `/api/opportunities/${opportunityId}/tender/bids`;

/** The GET answers `{ calls, pending }`; whether the person may edit is the page's, so it is kept from the current data. */
export function mergeCalls(current: CallsData, fresh: { calls?: CallsData["calls"]; pending?: boolean }): CallsData {
  return { ...current, calls: Array.isArray(fresh.calls) ? fresh.calls : current.calls, pending: fresh.pending ?? current.pending };
}

/** The GET answers `{ versions, pending }`; the working total is the page's own (its line editor), so it is kept. */
export function mergeBids(current: BidsData, fresh: { versions?: BidsData["versions"]; pending?: boolean }): BidsData {
  return { ...current, versions: Array.isArray(fresh.versions) ? fresh.versions : current.versions, pending: fresh.pending ?? current.pending };
}

/** The PATCH answers the four saved facts; the lost reason and the winner (the deal's competitor) are what was just sent. */
export function mergeOutcome(current: OutcomeData, saved: { award_value?: number | null; winning_bidder?: string | null; award_date?: string | null; outcome_note?: string | null }, sent: { lost: boolean; winning_bidder: string; loss_reason: string }): OutcomeData {
  return {
    ...current,
    award_value: saved.award_value ?? null, winning_bidder: saved.winning_bidder ?? null, award_date: saved.award_date ?? null, outcome_note: saved.outcome_note ?? null,
    ...(sent.lost ? { loss_reason: (sent.loss_reason || current.loss_reason) as OutcomeData["loss_reason"], competitor: sent.winning_bidder.trim() || current.competitor } : {}),
  };
}
