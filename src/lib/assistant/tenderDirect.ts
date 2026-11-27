import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { availableVerbs } from "@/lib/actions/registry";
import { buildVerbCard } from "@/lib/actions/verbs";
import { resolveRecord } from "@/lib/actions/records";
import type { PermissionSet } from "@/lib/permissions";
import type { ConfirmCard } from "./cards";
import type { ResolvedPage } from "./pageService";
import { AWARD_TOOL, priceIntro, runPriceTool, type PriceCard, type PriceEnv } from "./priceCompare";
import { WHICH_TENDER, type TenderAsk } from "./tenderAsk";

// A plain tender instruction (tenderAsk.ts) answered with no model: the same card builders the model's tools call, with the
// words taken from the sentence itself, so the same sentence always gives the same card or the same refusal. Nothing is done
// until the card is pressed. Null when this person has no such step here: the model then answers as for any other message.

export type TenderReply = { answer: string; card?: ConfirmCard; price?: PriceCard };

export type TenderEnv = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  isWorkspaceAdmin: boolean;
  open: ResolvedPage | null;
  price: PriceEnv;
};

const SUPPLIERS = { table: "suppliers", nameColumn: "name" } as const;

/** "A, B and C" into names. A part that is a supplier's whole name is kept whole, so a name holding "and" is not cut. */
async function supplierNames(env: TenderEnv, raw: string): Promise<string[]> {
  const out: string[] = [];
  for (const part of raw.split(",").map((p) => p.replace(/^\s*and\s+/i, "").trim()).filter(Boolean)) {
    const whole = await resolveRecord(env.supabase, env.tenantId, SUPPLIERS, part);
    if (whole.kind === "one") out.push(part);
    else out.push(...part.split(/\s+(?:and|&)\s+/i).map((p) => p.trim()).filter(Boolean));
  }
  return out;
}

export async function answerTenderAsk(ask: TenderAsk, env: TenderEnv): Promise<TenderReply | null> {
  const openDealId = env.open?.objectType === "opportunity" ? env.open.recordId : null;

  if (ask.verb === "award") {
    if (!env.price.access.award) return null;
    const openRfq = env.open?.objectType === "rfq" ? String(env.open.record.row.ref ?? "") : "";
    const reference = ask.rfq ?? ask.deal ?? openRfq;
    if (!reference && !openDealId) return { answer: WHICH_TENDER };
    const o = await runPriceTool(AWARD_TOOL, { reference, mode: ask.mode, supplier: ask.supplier, lines: ask.lines }, env.price);
    if (o.card) return { answer: priceIntro(o.card), price: o.card };
    return { answer: o.say ?? "I could not prepare that award. Open the compare screen and award it there." };
  }

  const def = availableVerbs({ features: env.features, perms: env.perms }).find((v) => v.verb === ask.verb);
  if (!def) return null;
  if (!ask.deal && !openDealId) return { answer: WHICH_TENDER };
  const built = await buildVerbCard(
    { supabase: env.supabase, tenantId: env.tenantId, userId: env.userId, perms: env.perms, isWorkspaceAdmin: env.isWorkspaceAdmin, pageRecordId: openDealId },
    def,
    {
      deal: ask.deal,
      ...(ask.verb === "price" ? { markup_pct: ask.markupPct } : {}),
      ...(ask.verb === "rfq" ? { suppliers: await supplierNames(env, ask.suppliers), lines: ask.lines } : {}),
    },
  );
  if (!built.ok) return { answer: built.say };
  return { answer: `Check the card, then press ${built.card.primaryLabel}. Nothing is done until you do.`, card: built.card };
}
