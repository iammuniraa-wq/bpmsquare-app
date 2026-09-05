// Stored pricing contexts (spec §7, §17 batch 1): the pure half. Builds the
// pricing_documents row from a pricing call and computes retention cutoffs.
// No framework imports so it is unit-testable and importable from client
// code (the cockpit renders rows shaped like PricingDocumentRow).

import type { LineFlag, PriceInput, PriceResult, TraceStep } from "@/lib/pricing-core";

export const PRICING_DOCUMENT_SOURCES = ["api", "quote", "standard_quote", "work_order", "test", "simulation"] as const;
export type PricingDocumentSource = (typeof PRICING_DOCUMENT_SOURCES)[number];

/** Who priced what -- travels with runPrice() into the stored row. */
export type PricingCallMeta = {
  source: PricingDocumentSource;
  sourceId?: string | null;
  apiKeyId?: string | null;
  actorId?: string | null;
  replayOf?: string | null;
};

export type PricingDocumentRow = {
  tenant_id: string;
  pricing_area: string;
  config_version: number;
  procedure: string;
  pricing_date: string;
  source: PricingDocumentSource;
  source_id: string | null;
  api_key_id: string | null;
  replay_of: string | null;
  context: PriceInput["document"];
  result: {
    currency: string | null;
    totals: PriceResult["totals"];
    lines: { line_no: number; net: number; subtotals: Record<string, number>; components: Record<string, number>; flags: LineFlag[] }[];
  };
  trace: { line_no: number; steps: TraceStep[] }[];
  currency: string | null;
  net_total: number;
  line_count: number;
  calc_ms: number | null;
  created_by: string | null;
};

export const DEFAULT_PRICING_RETENTION_DAYS = 180;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 3650;

export function buildPricingDocumentRow(args: {
  tenantId: string;
  area: string;
  configVersion: number;
  procedure: string;
  document: PriceInput["document"];
  result: PriceResult;
  calcMs: number | null;
  meta: PricingCallMeta;
}): PricingDocumentRow {
  const { result } = args;
  return {
    tenant_id: args.tenantId,
    pricing_area: args.area,
    config_version: args.configVersion,
    procedure: args.procedure,
    pricing_date: result.pricing_date,
    source: args.meta.source,
    source_id: args.meta.sourceId ?? null,
    api_key_id: args.meta.apiKeyId ?? null,
    replay_of: args.meta.replayOf ?? null,
    context: args.document,
    result: {
      currency: result.currency,
      totals: result.totals,
      lines: result.lines.map((l) => ({ line_no: l.line_no, net: l.net, subtotals: l.subtotals, components: l.components, flags: l.flags ?? [] })),
    },
    trace: result.lines.map((l) => ({ line_no: l.line_no, steps: l.trace })),
    currency: result.currency,
    net_total: Math.round(result.totals.net * 100) / 100,
    line_count: result.lines.length,
    calc_ms: args.calcMs,
    created_by: args.meta.actorId ?? null,
  };
}

/** Tenant retention for stored contexts, clamped to a sane window. A
 *  missing or nonsensical setting reads as the default, never as "keep
 *  forever" and never as "purge everything". */
export function pricingRetentionDays(config: { pricing?: { retention_days?: unknown } } | null | undefined): number {
  const raw = Number(config?.pricing?.retention_days);
  if (!Number.isFinite(raw)) return DEFAULT_PRICING_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(raw)));
}

export function retentionCutoff(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
