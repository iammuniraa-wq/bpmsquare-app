import type Anthropic from "@anthropic-ai/sdk";
import { canEditWorkcenter, canViewWorkcenter, type PermissionSet } from "@/lib/permissions";
import { actionsEnabled } from "@/lib/actions/registry";
import { promptText } from "@/lib/assistant/promptSafe";

// The three price tools of the dock: what each is for, who may have it, and how its input is read. The model passes words; the server resolves them
// inside the caller's own workspace. No tool takes a workspace, a person or a database id from the model.

export const COMPARE_TOOL = "compare_quotes";
export const AWARD_TOOL = "propose_award";
export const CHECK_TOOL = "price_check";
export const PRICE_TOOL_NAMES: ReadonlySet<string> = new Set([COMPARE_TOOL, AWARD_TOOL, CHECK_TOOL]);

export type PriceAccess = { compare: boolean; check: boolean; award: boolean };

/** Which of the three this person has here: the module, the Business Role and, for the award, the assistant's actions flag and edit rights. */
export function priceAccess(g: { features: Record<string, boolean | undefined>; perms: PermissionSet; userId?: string | null }): PriceAccess {
  const rfq = g.features.rfq === true && canViewWorkcenter(g.perms, "rfqs");
  const check = g.features.gcc_tender === true && g.features.pipeline === true && canViewWorkcenter(g.perms, "pipeline");
  const award = rfq && !!g.userId && actionsEnabled(g.features) && canEditWorkcenter(g.perms, "rfqs");
  return { compare: rfq, check, award };
}

export const PRICE_COMPARE_PROMPT_RULE =
  "\nPRICE COMPARISON: when the person asks to compare supplier quotes or prices, who is cheapest, or which supplier to award, call compare_quotes with the RFQ or deal reference they gave (ask which one if it is unclear). " +
  "The app works out every figure and draws the card, so after it write ONE short sentence and repeat none of its figures. " +
  "When they ask to award, call propose_award: it only shows a card and nothing is awarded until they press the button on it, so never say it was awarded. " +
  "When they ask whether a tender's BOQ rates are in line with our own history, call price_check.";

export function priceTools(access: PriceAccess, o: { webHistory?: boolean } = {}): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  if (access.compare) {
    tools.push({
      name: COMPARE_TOOL,
      description:
        "Show a price comparison card for the supplier quotes on one RFQ: each line by supplier, the cheapest per line, totals, a split award against a single supplier, price outliers against our own history, and a recommended supplier with a score. " +
        "Use it when the person asks to compare quotes or prices, who is cheapest, or which supplier to award. " +
        "Pass the RFQ reference (RFQ-0014), or the reference of the deal it belongs to (OPP-0034), or words from the RFQ's title. If several RFQs match you get them back: ask which one. " +
        "Every figure is worked out by the app, not by you. The app draws the card: you then write ONE short sentence and repeat none of its figures.",
      input_schema: {
        type: "object",
        properties: {
          reference: { type: "string", description: "RFQ-0014, OPP-0034, or words from the RFQ title, as the person wrote them." },
          suppliers: { type: "array", items: { type: "string" }, description: "Only when the person named suppliers: compare just their quotes. Names as written." },
        },
        required: ["reference"],
      },
    });
  }
  if (access.check) {
    tools.push({
      name: CHECK_TOOL,
      description:
        "Show a ranked card of the lines on a tender's bill of quantities whose current rate differs most from our own history (past RFQ answers, product cost, estimates). " +
        "Use it when the person asks whether the BOQ prices are in line, or which lines look off. Pass the deal reference (OPP-0034); leave it out when they have the tender open. The app draws the card: write ONE short sentence.",
      input_schema: { type: "object", properties: { deal: { type: "string", description: "OPP-0034, only when the person named a tender." } } },
    });
  }
  if (access.award && !o.webHistory) {
    tools.push({
      name: AWARD_TOOL,
      description:
        "Show a confirm card to award the lines of one RFQ (Award and price): to ONE supplier, or each line to its cheapest valid supplier. It awards nothing: the person reads the lines, the cost, the markup and any warning, and presses the button. " +
        "Use it only when the person asks to award or to propose the award. Pass the RFQ reference and, for mode single, the supplier's name as the person wrote it.",
      input_schema: {
        type: "object",
        properties: {
          reference: { type: "string", description: "RFQ-0014, or OPP-0034 when that deal has one RFQ." },
          mode: { type: "string", enum: ["single", "split"], description: "single = every line to one supplier; split = each line to its cheapest valid supplier." },
          supplier: { type: "string", description: "Mode single only: the supplier's name." },
        },
        required: ["reference", "mode"],
      },
    });
  }
  return tools;
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? promptText(v, max) : "");

export type CompareInput = { reference: string; suppliers: string[] };
export type AwardInput = { reference: string; mode: "single" | "split"; supplier: string };
export type CheckInput = { deal: string };

export const parseCompareInput = (raw: unknown): CompareInput => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { reference: text(r.reference, 80), suppliers: (Array.isArray(r.suppliers) ? r.suppliers : []).map((s) => text(s, 80)).filter(Boolean).slice(0, 10) };
};
export const parseAwardInput = (raw: unknown): AwardInput => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { reference: text(r.reference, 80), mode: r.mode === "split" ? "split" : "single", supplier: text(r.supplier, 80) };
};
export const parseCheckInput = (raw: unknown): CheckInput => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { deal: text(r.deal, 40) };
};
