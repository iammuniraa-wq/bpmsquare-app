// Run history helpers for the Dynamics 365 connector screens -- pure, client-safe.

export type D365Run = {
  id: string;
  entity: string;
  direction: "pull" | "push";
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  counts: Record<string, number>;
  error: string | null;
  issues: string[];
};

/** The short outcome kept under an entity row after an action. */
export type SyncResult = {
  ok: boolean;
  text: string;
  issues?: string[];
  /** When it happened (ISO). */
  at: string;
};

export const COUNT_KEYS = ["read", "created", "updated", "unchanged", "skipped", "failed"] as const;

/** "6 read · 6 created · 0 updated · 0 unchanged · 0 skipped · 0 failed" */
export function countsLine(counts: Record<string, number> | null | undefined): string {
  return COUNT_KEYS.map((k) => `${counts?.[k] ?? 0} ${k}`).join(" · ");
}

/** A run longer than the routes' 300 s limit cannot still be alive; one left "running" is a crashed run. */
export const LIVE_RUN_MS = 6 * 60_000;

export function isLiveRun(r: Pick<D365Run, "status" | "started_at">, now: number): boolean {
  if (r.status !== "running") return false;
  const t = Date.parse(r.started_at);
  return Number.isFinite(t) && now - t < LIVE_RUN_MS;
}

/** The newest finished run per entity (runs arrive newest first). */
export function latestRunByEntity(runs: D365Run[]): Record<string, D365Run> {
  const out: Record<string, D365Run> = {};
  for (const r of runs) if (r.status !== "running" && !out[r.entity]) out[r.entity] = r;
  return out;
}

export function resultFromRun(r: D365Run): SyncResult {
  const ok = r.status === "succeeded" || r.status === "partial";
  const base = r.error && !ok ? r.error : countsLine(r.counts);
  return { ok, text: r.status === "failed" && !r.error ? `Failed · ${base}` : base, issues: r.issues?.length ? r.issues : undefined, at: r.finished_at ?? r.started_at };
}

/**
 * What an entity row shows: the outcome of this session's last action, unless
 * the run history holds something clearly newer (another admin, or a scheduled
 * run). The two clocks differ, so a minute or two of skew favours the session.
 */
export function pickResult(session: SyncResult | null | undefined, history: SyncResult | null | undefined): SyncResult | null {
  if (!session) return history ?? null;
  if (!history) return session;
  const s = Date.parse(session.at);
  const h = Date.parse(history.at);
  return Number.isFinite(s) && Number.isFinite(h) && h - s > 2 * 60_000 ? history : session;
}
