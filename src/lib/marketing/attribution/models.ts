// Attribution, the arithmetic. Pure: no database, no clock (the caller passes `now`), so the same inputs always
// give the same answer and a test can pin it. The three models are set in code on purpose; nothing is fitted or
// learned, so every figure can be explained in a sentence (docs/shells/attribution-shell.md).

export const MODELS = ["first", "last", "linear"] as const;
export type Model = (typeof MODELS)[number];
export const MODES = ["engaged", "all"] as const;
export type Mode = (typeof MODES)[number];
export const ASSET_TYPES = ["campaign", "newsletter", "form", "journey", "whatsapp", "event"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const WINDOW_DAYS = 90;
const DAY = 86_400_000;

export type Touch = { assetType: AssetType; assetId: string; accountId: string; at: Date; strength: "engaged" | "reached" };

export type Deal = {
  id: string;
  accountId: string;
  createdAt: Date;
  closedAt: Date | null;
  outcome: "open" | "won" | "lost" | "dropped";
  amount: number;
  /** Invoiced and paid on the quotes of this deal (0 when none). */
  invoiced: number;
  paid: number;
};

export type AssetMetrics = {
  touches: number;
  people: number;
  sourcedDeals: number;
  sourcedOpenValue: number;
  sourcedWonDeals: number;
  sourcedWonValue: number;
  sourcedPaidValue: number;
  influencedDeals: number;
  influencedWonDeals: number;
  influencedWonValue: number;
};

const empty = (): AssetMetrics => ({
  touches: 0, people: 0, sourcedDeals: 0, sourcedOpenValue: 0, sourcedWonDeals: 0, sourcedWonValue: 0, sourcedPaidValue: 0,
  influencedDeals: 0, influencedWonDeals: 0, influencedWonValue: 0,
});

/** Whole currency units and thousandths of a deal: more precision than the data has would be a false claim. */
const money = (n: number) => Math.round(n);
const share = (n: number) => Math.round(n * 1000) / 1000;

/**
 * One company touching the same asset several times within a day is one touch, not several: a person who registers
 * for an event and then attends it, or clicks a link twice, must not hold three shares of a linear split. (The
 * per-asset `touches` figure still counts every one.) Input is in time order.
 */
function collapse(list: Touch[]): Touch[] {
  const lastKept = new Map<string, number>();
  const out: Touch[] = [];
  for (const t of list) {
    const prev = lastKept.get(t.assetId);
    if (prev !== undefined && t.at.getTime() - prev < DAY) continue;
    lastKept.set(t.assetId, t.at.getTime());
    out.push(t);
  }
  return out;
}

export type AttributeOptions ={ model: Model; mode: Mode; assetType: AssetType; windowDays?: number; now: Date };

/**
 * For every asset of one kind, what it STARTED (credit shared among the touches before a deal existed, by the
 * model) and what it TOUCHED (any touch from the window before the deal until it closed, or until now).
 *
 *  - first:  the earliest touch before the deal gets all of it;
 *  - last:   the latest touch before the deal gets all of it;
 *  - linear: every touch before the deal gets an equal share, so an asset that touched the company three times
 *            holds three shares.
 * Sourced credit adds up to one deal per deal. Influenced counts a deal under EVERY asset that touched it, so
 * influenced figures overlap and are never to be added together. Dropped deals are not deals.
 */
export function attribute(deals: Deal[], touches: Touch[], o: AttributeOptions): Map<string, AssetMetrics> {
  const windowMs = (o.windowDays ?? WINDOW_DAYS) * DAY;
  const out = new Map<string, AssetMetrics>();
  const get = (id: string): AssetMetrics => { let m = out.get(id); if (!m) { m = empty(); out.set(id, m); } return m; };

  const wanted = touches.filter((t) => t.assetType === o.assetType && (o.mode === "all" || t.strength === "engaged"));
  const people = new Map<string, Set<string>>();
  for (const t of wanted) {
    get(t.assetId).touches++;
    let s = people.get(t.assetId);
    if (!s) { s = new Set(); people.set(t.assetId, s); }
    s.add(t.accountId);
  }
  for (const [id, s] of people) get(id).people = s.size;

  const byAccount = new Map<string, Touch[]>();
  for (const t of wanted) {
    const list = byAccount.get(t.accountId);
    if (list) list.push(t); else byAccount.set(t.accountId, [t]);
  }
  // Stable order so a tie (two touches in the same instant) always resolves the same way.
  for (const list of byAccount.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime() || a.assetId.localeCompare(b.assetId));

  for (const d of deals) {
    if (d.outcome === "dropped") continue;
    const end = d.closedAt ?? o.now;
    const from = d.createdAt.getTime() - windowMs;
    const inWindow = collapse((byAccount.get(d.accountId) ?? []).filter((t) => t.at.getTime() >= from && t.at.getTime() <= end.getTime()));
    if (inWindow.length === 0) continue;

    // Influenced: once per asset.
    for (const id of new Set(inWindow.map((t) => t.assetId))) {
      const m = get(id);
      m.influencedDeals++;
      if (d.outcome === "won") { m.influencedWonDeals++; m.influencedWonValue += d.amount; }
    }

    // Sourced: only touches before the deal existed.
    const before = inWindow.filter((t) => t.at.getTime() <= d.createdAt.getTime());
    if (before.length === 0) continue;
    const credit = new Map<string, number>();
    if (o.model === "first") credit.set(before[0].assetId, 1);
    else if (o.model === "last") credit.set(before[before.length - 1].assetId, 1);
    else for (const t of before) credit.set(t.assetId, (credit.get(t.assetId) ?? 0) + 1 / before.length);
    for (const [id, w] of credit) {
      const m = get(id);
      m.sourcedDeals += w;
      if (d.outcome === "open") m.sourcedOpenValue += w * d.amount;
      if (d.outcome === "won") { m.sourcedWonDeals += w; m.sourcedWonValue += w * d.amount; m.sourcedPaidValue += w * d.paid; }
    }
  }

  for (const m of out.values()) {
    m.sourcedDeals = share(m.sourcedDeals);
    m.sourcedWonDeals = share(m.sourcedWonDeals);
    m.sourcedOpenValue = money(m.sourcedOpenValue);
    m.sourcedWonValue = money(m.sourcedWonValue);
    m.sourcedPaidValue = money(m.sourcedPaidValue);
    m.influencedWonValue = money(m.influencedWonValue);
  }
  return out;
}

// ── words ────────────────────────────────────────────────────────────────────

export const MODEL_LABEL: Record<Model, string> = { first: "First touch", last: "Last touch", linear: "Shared evenly" };
export const MODEL_HINT: Record<Model, string> = {
  first: "The first thing a company engaged with before the deal started gets all the credit. Good for asking what brings new companies in.",
  last: "The last thing a company engaged with before the deal started gets all the credit. Good for asking what tips a company over.",
  linear: "Every touch before the deal started gets an equal share. A middle road when you do not want to pick one moment.",
};
export const ASSET_LABEL: Record<AssetType, string> = {
  campaign: "Campaigns", newsletter: "Newsletters", form: "Forms", journey: "Journeys", whatsapp: "WhatsApp templates", event: "Events",
};
export const ASSET_HINT: Record<AssetType, string> = {
  campaign: "Email campaigns you sent from Marketing.",
  newsletter: "The newsletter designs behind those emails.",
  form: "Forms on your website that people filled in.",
  journey: "Automated follow-ups people were put through.",
  whatsapp: "WhatsApp messages sent from a template.",
  event: "Webinars, shows and visits people registered for.",
};
export const MODE_LABEL: Record<Mode, string> = { engaged: "The person did something", all: "Also people only sent something" };
export const MODE_HINT: Record<Mode, string> = {
  engaged: "A touch counts only when the person clicked, replied, filled in a form or registered. Being sent a message is not influence.",
  all: "Also count people who were only sent a message. This gives credit to things nobody may have read, so use it with care.",
};

export type ReportTotals = { assets: number; sourcedWonValue: number; sourcedOpenValue: number; sourcedDeals: number; touches: number };

export function totalsOf(rows: AssetMetrics[]): ReportTotals {
  return rows.reduce<ReportTotals>((t, r) => ({
    assets: t.assets + 1, sourcedWonValue: t.sourcedWonValue + r.sourcedWonValue, sourcedOpenValue: t.sourcedOpenValue + r.sourcedOpenValue,
    sourcedDeals: t.sourcedDeals + r.sourcedDeals, touches: t.touches + r.touches,
  }), { assets: 0, sourcedWonValue: 0, sourcedOpenValue: 0, sourcedDeals: 0, touches: 0 });
}

/** The line under the report: which model produced these numbers, and what they can and cannot say. */
export function interpretation(model: Model, mode: Mode, assetType: AssetType, dealsConsidered: number): string[] {
  const lines = [
    `${MODEL_LABEL[model]}: ${MODEL_HINT[model]} ${mode === "engaged" ? "Only touches where the person did something are counted." : "People who were only sent a message are counted too."}`,
    `Started means the touches before a deal was created, in the ${WINDOW_DAYS} days before it. Touched means any ${ASSET_LABEL[assetType].toLowerCase()} touch from ${WINDOW_DAYS} days before the deal until it closed or today. A deal is touched by every ${ASSET_LABEL[assetType].toLowerCase().replace(/s$/, "")} that reached it, so touched figures overlap: do not add them up.`,
    "This shows where deals came from, not why they were won. A company that clicked may have been going to buy anyway, and a deal with no touch may have come from a phone call that is not recorded here.",
  ];
  if (dealsConsidered < 20) lines.push(`Only ${dealsConsidered} deal${dealsConsidered === 1 ? "" : "s"} in this period. Read it as a list of what happened, not as a rate.`);
  return lines;
}
