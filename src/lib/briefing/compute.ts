import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canUseObject } from "@/lib/assistant/sources";
import type { ObjectDef } from "@/lib/assistant/objects";
import { dayWindow, type DayWindow } from "./day";
import { loadOpen, loadYesterday, type BriefingCtx } from "./load";
import { groupOpen, rankFocus } from "./score";
import type { WordingRequest, WordingResult } from "./wording";
import { supabaseBriefingStore, type BriefingStore } from "./store";
import { yesterdayLines, type ChangeRow, type CommentRow } from "./yesterday";
import { REFRESH_COOLDOWN_MS, type Briefing, type Candidate } from "./types";

/** Pure: the loaded rows in, the briefing out. No clock, no I/O. */
export function buildBriefing(input: {
  win: DayWindow; now: Date; changes: readonly ChangeRow[]; comments: readonly CommentRow[]; candidates: readonly Candidate[];
  canSee: (def: ObjectDef) => boolean; formatValue?: (n: number) => string;
}): Briefing {
  const yesterday = yesterdayLines(input.changes, input.comments, input.canSee);
  const today = groupOpen(input.candidates);
  return {
    day: input.win.today, timeZone: input.win.timeZone,
    yesterday, today, focus: rankFocus(input.candidates, { limit: 5, formatValue: input.formatValue }),
    computedAt: input.now.toISOString(), empty: yesterday.length === 0 && today.length === 0,
    cached: false, stored: true, refreshableAt: null,
  };
}

export type BriefingSources = {
  yesterday: typeof loadYesterday;
  open: typeof loadOpen;
};

const live: BriefingSources = { yesterday: loadYesterday, open: loadOpen };

const nextRefresh = (computedAt: string, now: Date): string | null => {
  const at = Date.parse(computedAt) + REFRESH_COOLDOWN_MS;
  return Number.isFinite(at) && at > now.getTime() ? new Date(at).toISOString() : null;
};

/**
 * The person's briefing for today in the workspace's time zone. First call of the day works it out and stores it;
 * later calls read the stored row; `refresh` recomputes at most once per five minutes. If the storage table is not
 * there yet the briefing is worked out on every call (and says `stored: false`), which is slower but identical.
 */
export type WordingResolver = (req: WordingRequest) => Promise<WordingResult>;

export async function getBriefing(opts: {
  admin: SupabaseClient; ctx: BriefingCtx; timeZone: unknown; now?: Date; lang?: string | null; refresh?: boolean;
  formatValue?: (n: number) => string; sources?: BriefingSources; store?: BriefingStore;
  /** Adds the optional AI paragraph. Absent: no wording and no model call. */
  wording?: WordingResolver;
}): Promise<Briefing> {
  const now = opts.now ?? new Date();
  const { ctx } = opts;
  const win = dayWindow(now, opts.timeZone);
  const store = opts.store ?? supabaseBriefingStore(opts.admin);
  const sources = opts.sources ?? live;
  const lang = opts.lang ?? null;

  const phrase = async (briefing: Briefing, previous: Briefing["wording"]): Promise<WordingResult> => {
    if (!opts.wording) return { wording: previous ?? null, tokens: 0 };
    return opts.wording({ briefing, previous: previous ?? null, lang, since: win.todayStart }).catch(() => ({ wording: null, tokens: 0 }));
  };

  const existing = await store.read(ctx.tenantId, ctx.userId, win.today).catch(() => ({ row: null, pending: true }));
  if (existing.row && (!opts.refresh || nextRefresh(existing.row.computedAt, now))) {
    const data = existing.row.data;
    const w = await phrase(data, data.wording);
    const briefing: Briefing = opts.wording ? { ...data, wording: w.wording } : data;
    if (w.wording !== (data.wording ?? null)) {
      await store.write({ tenantId: ctx.tenantId, userId: ctx.userId, day: win.today, lang, data: briefing, tokens: w.tokens }).catch(() => ({ pending: true }));
    }
    return { ...briefing, cached: true, stored: true, refreshableAt: nextRefresh(existing.row.computedAt, now) };
  }

  const [{ changes, comments }, candidates] = await Promise.all([
    sources.yesterday(opts.admin, ctx, win),
    sources.open(opts.admin, ctx, win, now),
  ]);
  const built = buildBriefing({
    win, now, changes, comments, candidates,
    canSee: (def) => canUseObject(ctx, def), formatValue: opts.formatValue,
  });
  const w = await phrase(built, existing.row?.data.wording);
  const briefing: Briefing = opts.wording ? { ...built, wording: w.wording } : built;

  const written = existing.pending ? { pending: true } : await store.write({
    tenantId: ctx.tenantId, userId: ctx.userId, day: win.today, lang, data: briefing, tokens: w.tokens,
  }).catch(() => ({ pending: true }));
  const stored = !written.pending;
  return { ...briefing, stored, refreshableAt: stored ? nextRefresh(briefing.computedAt, now) : null };
}
