import { namesLines } from "./lineWords";

// The plain tender instructions the assistant answers with no model: match the BOQ to products, price all lines, raise an RFQ to named
// suppliers, award named lines. Pure and deliberately narrow: the whole sentence has to be the instruction. Anything with more in it
// (a question, a date, a condition) returns null and goes to the model as before.

export type TenderAsk = { deal?: string } & (
  | { verb: "match" }
  | { verb: "price"; markupPct?: string }
  | { verb: "rfq"; suppliers: string; lines?: string }
  | { verb: "award"; lines: string; supplier: string; mode: "single" | "split"; rfq?: string }
);

export const WHICH_TENDER = "Which tender is this for? Give its reference (for example OPP-0034), or open the tender and ask again.";

const POLITE = /^(?:(?:ok(?:ay)?|now|please|kindly|can you|could you|would you)[,\s]+)+/i;
const DEAL_REF = /\s*\b(?:(?:on|for|of|in)\s+)?(?:(?:the\s+)?(?:tender|deal)\s+)?(OPP-\d{3,})\b/i;
const THIS_TENDER = /\s+(?:on|for|of|in)\s+(?:this|the open|the current)\s+(?:tender|deal)\b/gi;

const MATCH = /^(?:match|link)\s+(?:(?:the|this|all)\s+)*(?:tender(?:'s)?\s+)?(?:(?:boq|bill of quantities)(?:\s+lines?)?|lines?\s+(?:of|in|on)\s+(?:the\s+)?(?:boq|bill of quantities))(?:\s+(?:to|with|against)\s+(?:(?:the|our)\s+)?(?:product\s+catalog(?:ue)?|catalog(?:ue)?(?:\s+products?)?|products?))?$/i;

const PCT = String.raw`(\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b|pct\b)`;
const PRICE = new RegExp(
  String.raw`^price\s+(?:(?:all|the|every|this)\s+)*(?:(?:unpriced|remaining)\s+)?(?:(?:boq|bill of quantities)(?:\s+lines?)?|lines(?:\s+(?:of|in|on)\s+(?:the\s+)?(?:boq|bill of quantities))?)` +
  String.raw`(?:\s+(?:without a price|with no price))?(?:\s+(?:with|at|using|plus|adding)\s+(?:an?\s+)?(?:${PCT}(?:\s+mark[\s-]?up)?|mark[\s-]?up\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent|per cent|pct)?))?$`,
  "i",
);

const RFQ_VERB = String.raw`^(?:raise|create|send|make|prepare|draft|start)\s+(?:(?:an?|the|new)\s+)*(?:rfq|request for quotation)`;
const RFQ_TO_FOR = new RegExp(String.raw`${RFQ_VERB}\s+to\s+(.+?)(?:\s+(?:for|covering)\s+(.+))?$`, "i");
const RFQ_FOR_TO = new RegExp(String.raw`${RFQ_VERB}\s+(?:for|covering)\s+(.+?\b(?:lines?|items?))\s+to\s+(.+)$`, "i");
// A date or a second instruction in the sentence: the model reads those.
const MORE = /\b(?:by|before|until|reply|replies|respond|titled?|called|and send|then)\b/i;
const LINE_PHRASE = /\b(?:lines?|items?)$/i;

const AWARD = /^award\s+(?:the\s+)?(?:(.+?)\s+(?:lines?|items?)|(?:lines?|items?)\s+([\w.]+(?:\s*(?:,|and)\s*[\w.]+)*))(?:\s+(?:of|on|in|from)\s+(RFQ-\d+))?\s+to\s+(.+?)(?:\s+(?:of|on|in|from)\s+(RFQ-\d+))?$/i;
const CHEAPEST = /\b(?:cheapest|lowest)\b/i;

export function parseTenderAsk(message: string): TenderAsk | null {
  let text = message.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "");
  if (!text || text.length > 220 || text.includes("\n")) return null;
  if (text.endsWith("?")) {
    if (!/^(?:can|could|would) you\b/i.test(text)) return null;
    text = text.replace(/\?+$/, "");
  }
  text = text.replace(POLITE, "").replace(/[,\s]+please$/i, "");
  const ref = DEAL_REF.exec(text);
  const deal = ref ? ref[1].toUpperCase() : undefined;
  if (ref) text = text.replace(DEAL_REF, "");
  text = text.replace(THIS_TENDER, "").trim();
  const base = deal ? { deal } : {};

  if (MATCH.test(text)) return { ...base, verb: "match" };

  const price = PRICE.exec(text);
  if (price) {
    const markupPct = price[1] ?? price[2];
    return { ...base, verb: "price", ...(markupPct ? { markupPct } : {}) };
  }

  const forTo = RFQ_FOR_TO.exec(text);
  const toFor = forTo ? null : RFQ_TO_FOR.exec(text);
  if (forTo || toFor) {
    const suppliers = (forTo ? forTo[2] : toFor![1]).trim();
    const lines = (forTo ? forTo[1] : toFor![2] ?? "").trim();
    if (MORE.test(suppliers) || MORE.test(lines)) return null;
    if (lines && !LINE_PHRASE.test(lines) && lines.split(" ").length > 3) return null;
    return { ...base, verb: "rfq", suppliers, ...(namesLines(lines) ? { lines } : {}) };
  }

  const award = AWARD.exec(text);
  if (award) {
    const lines = (award[1] ?? award[2] ?? "").trim();
    const supplier = award[4].trim();
    if (!namesLines(lines) || /%|\bpercent\b|\bmark[\s-]?up\b|\bbecause\b|\bat\b/i.test(supplier)) return null;
    const rfq = (award[3] ?? award[5])?.toUpperCase();
    const split = CHEAPEST.test(supplier);
    return { ...base, verb: "award", lines, supplier: split ? "" : supplier, mode: split ? "split" : "single", ...(rfq ? { rfq } : {}) };
  }
  return null;
}

/** "OPP-0034" typed as the answer to "Which tender is this for?": the instruction asked just before, now with its tender. */
export function parseWhichTenderAnswer(history: readonly { role: "user" | "assistant"; text: string }[]): TenderAsk | null {
  const [asked, question, answer] = history.slice(-3);
  if (!answer || asked.role !== "user" || question.role !== "assistant" || question.text !== WHICH_TENDER) return null;
  const ref = /^(?:(?:it is|it's|on|for|the tender|tender)\s+)?(OPP-\d{3,})[.!]?$/i.exec(answer.text.trim());
  const ask = ref ? parseTenderAsk(asked.text) : null;
  return ask ? { ...ask, deal: ref![1].toUpperCase() } : null;
}
