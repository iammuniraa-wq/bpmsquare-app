import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES } from "@/lib/constants";
import type { Account360Card, Account360Suggestion } from "@/lib/account360/types";
import { dayLabel } from "./rubric";
import { loadAccountSignals } from "./queries";
import { SOURCE_LABEL, STAGE_LABEL } from "./types";

// The Account 360 contract (bpmsquare core 10a): a card is data. This returns
// the "Buying signals" card and, for an account that is Comparing or Deciding,
// the one suggestion. The account's health rating is untouched -- health answers
// "how is the relationship", this answers "are they buying now" -- and both
// numbers are explainable rubrics, so there is still no fourth number.

export async function buildSignalsCard(
  admin: SupabaseClient, tenantId: string, accountId: string, now: Date = new Date(),
): Promise<{ card: Account360Card; suggestion: Account360Suggestion | null } | null> {
  const s = await loadAccountSignals({ admin, tenantId }, accountId, now);
  if (!s) return null;

  const last = s.timeline[0];
  const delta = s.movement.scoreDelta;
  const card: Account360Card = {
    id: "buying_signals",
    title: "Buying signals",
    subtitle: s.reason,
    kind: "internal",
    stats: [
      { label: "Score", value: String(s.score), hint: delta ? `${delta > 0 ? "up" : "down"} ${Math.abs(delta)} this week` : undefined },
      {
        label: "Buying stage", value: STAGE_LABEL[s.stage],
        hint: s.movement.movedText ?? (s.movement.daysInStage !== null ? `${s.movement.daysInStage} days in stage` : undefined),
        tone: s.stage === "deciding" ? "good" : s.stage === "comparing" ? "neutral" : s.stage === "looking" ? "warn" : undefined,
      },
      { label: "Last signal", value: last ? dayLabel(last.occurred_at) : "—" },
    ],
    spark: { values: s.series, tone: s.movement.direction, label: s.movement.label },
    rows: s.timeline.slice(0, 5).map((t) => ({
      title: t.headline, meta: `${SOURCE_LABEL[t.source]} · ${dayLabel(t.occurred_at)}`,
      value: t.points > 0 ? `+${t.points}` : String(t.points), tone: t.points < 0 ? ("bad" as const) : undefined, href: t.href,
    })),
    empty: s.timeline.length === 0 ? "No signals in the last 60 days" : undefined,
  };

  const suggestion: Account360Suggestion | null = s.stage === "comparing" || s.stage === "deciding"
    ? {
        id: "in-market",
        title: `In market now: ${STAGE_LABEL[s.stage]} (${s.score})`,
        detail: s.reason.replace(/^[A-Za-z]+: /, "").replace(/^./, (c) => c.toUpperCase()) + ".",
        urgency: s.stage === "deciding" ? "high" : "medium",
        href: ROUTES.marketingSignals,
      }
    : null;
  return { card, suggestion };
}
