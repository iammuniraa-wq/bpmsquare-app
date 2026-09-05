import { authorizeApi, jsonOk, jsonError, readJsonBody, optionsResponse, RW_METHODS } from "../_auth";
import { runPrice, replayPricingDocument, PricingConfigError } from "@/lib/pricing/server";
import { PricingError, DslError, type DocumentLine, type TraceStep } from "@/lib/pricing-core";

// POST /api/v1/price — BPMSquare Pricing's headless surface (spec §10, §15.1).
// Prices a document against the tenant's PUBLISHED config (or an explicit
// version, for replay) and returns the priced lines with the full waterfall
// trace. Deterministic: same document + config version + pricing_date =>
// same result. Configuration problems (ambiguous rules, missing required
// components, formula errors) surface as structured 422s with a code —
// never a silently wrong price.
//
// Every call is stored (spec §7) and its id returned in meta.document_id;
// options.replay_of re-prices a stored document instead of document.lines.

export const maxDuration = 30;

const MAX_LINES = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = {
  document?: { attributes?: Record<string, unknown>; lines?: unknown };
  options?: {
    trace?: "full" | "summary" | "none";
    pricing_date?: string;
    config_version?: number;
    pricing_area?: string;
    procedure?: string;
    currency?: string;
    replay_of?: string;
  };
};

function parseLines(raw: unknown): { ok: true; lines: DocumentLine[] } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, message: "document.lines must be a non-empty array." };
  if (raw.length > MAX_LINES) return { ok: false, message: `document.lines exceeds ${MAX_LINES} lines per call.` };
  const lines: DocumentLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i] as Record<string, unknown>;
    if (typeof l !== "object" || l === null) return { ok: false, message: `Line ${i} is not an object.` };
    const lineNo = typeof l.line_no === "number" ? l.line_no : (i + 1) * 10;
    for (const numField of ["quantity", "weight_kg"] as const) {
      if (l[numField] !== undefined && typeof l[numField] !== "number") {
        return { ok: false, message: `Line ${lineNo}: ${numField} must be a number.` };
      }
    }
    if (l.cost_items !== undefined) {
      if (!Array.isArray(l.cost_items)) return { ok: false, message: `Line ${lineNo}: cost_items must be an array.` };
      for (const item of l.cost_items as Record<string, unknown>[]) {
        if (typeof item?.path !== "string" || typeof item?.qty !== "number") {
          return { ok: false, message: `Line ${lineNo}: each cost_item needs {path: string, qty: number}.` };
        }
      }
    }
    lines.push({
      line_no: lineNo,
      attributes: (l.attributes as Record<string, unknown>) ?? {},
      quantity: l.quantity as number | undefined,
      weight_kg: l.weight_kg as number | undefined,
      cost_items: l.cost_items as DocumentLine["cost_items"],
      manual: l.manual as DocumentLine["manual"],
    });
  }
  return { ok: true, lines };
}

function filterTrace(trace: TraceStep[], mode: "full" | "summary" | "none"): TraceStep[] | undefined {
  if (mode === "none") return undefined;
  if (mode === "summary") return trace.filter((t) => t.status === "APPLIED" || t.status === "SUBTOTAL");
  return trace;
}

export async function POST(req: Request) {
  const auth = await authorizeApi(req, "pricing");
  if ("error" in auth) return auth.error;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Body;

  const opts = body.options ?? {};
  const traceMode = opts.trace ?? "full";
  if (!["full", "summary", "none"].includes(traceMode)) {
    return jsonError(422, "Invalid options", { message: "options.trace must be full | summary | none." });
  }
  if (opts.pricing_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.pricing_date)) {
    return jsonError(422, "Invalid options", { message: "options.pricing_date must be yyyy-mm-dd." });
  }
  if (opts.replay_of !== undefined && !UUID_RE.test(opts.replay_of)) {
    return jsonError(422, "Invalid options", { message: "options.replay_of must be a pricing document id." });
  }

  const meta = { source: "api" as const, apiKeyId: auth.keyId };

  try {
    let call;
    if (opts.replay_of) {
      call = await replayPricingDocument(auth.tenantId, opts.replay_of, {
        configVersion: opts.config_version, pricingDate: opts.pricing_date, meta,
      });
    } else {
      const linesResult = parseLines(body.document?.lines);
      if (!linesResult.ok) return jsonError(422, "Invalid document", { message: linesResult.message });
      call = await runPrice(
        auth.tenantId,
        { attributes: body.document?.attributes ?? {}, lines: linesResult.lines },
        {
          pricingDate: opts.pricing_date,
          configVersion: opts.config_version,
          pricingArea: opts.pricing_area,
          procedure: opts.procedure,
          currency: opts.currency,
          meta,
        }
      );
    }
    const { result, config_version, procedure, calc_ms, document_id } = call;

    return jsonOk({
      data: {
        pricing_date: result.pricing_date,
        currency: result.currency,
        totals: result.totals,
        lines: result.lines.map((l) => ({
          line_no: l.line_no,
          net: l.net,
          subtotals: l.subtotals,
          components: l.components,
          ...(traceMode !== "none" ? { trace: filterTrace(l.trace, traceMode) } : {}),
        })),
      },
      meta: {
        config_version, procedure, calc_ms, trace: traceMode, generated_at: new Date().toISOString(),
        document_id, ...(opts.replay_of ? { replay_of: opts.replay_of } : {}),
      },
      _links: { self: "/api/v1/price" },
    }, RW_METHODS);
  } catch (e) {
    if (e instanceof PricingConfigError) return jsonError(e.status, "Pricing configuration", { message: e.message });
    if (e instanceof PricingError) return jsonError(422, e.code, { message: e.message });
    if (e instanceof DslError) return jsonError(422, "FORMULA_ERROR", { message: e.message });
    console.error("v1/price failed:", e);
    return jsonError(500, "Pricing failed", { message: "Unexpected error while pricing the document." });
  }
}

export function OPTIONS() {
  return optionsResponse(RW_METHODS);
}
