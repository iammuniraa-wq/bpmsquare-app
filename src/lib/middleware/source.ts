import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { normaliseLine, toExportLine, templateGroupNames } from "@/lib/estimator/lines";
import type { ExportLineInput } from "@/lib/estimator/exports";
import { ROUTES } from "@/lib/constants";
import type { FenceInfo, OutLine } from "./fence";
import type { EstimateInfo } from "./estimate";

// Reads a Standard Quote and what it came from. Every query names the tenant
// (the admin client bypasses RLS): the quote id alone never selects a row.
// A quote's source is found from the links already stored -- the fence project
// or the estimate that points at it -- and a missing fence or estimate table
// (migration pending) simply means "neither".

export type QuoteRow = {
  id: string; ref: string; account_id: string; contact_id: string | null; status: string;
  valid_until: string | null; terms: string | null; notes: string | null;
  subtotal: number; total: number; header_discount_pct: number; tax_pct: number; shipping_amount: number; intro_text: string | null;
};

export type QuoteSource = {
  quote: QuoteRow;
  lines: OutLine[];
  accountName: string;
  fence: FenceInfo | null;
  estimate: { info: EstimateInfo; exportLines: ExportLineInput[] } | null;
};

const QUOTE_COLS = "id, ref, account_id, contact_id, status, valid_until, terms, notes, subtotal, total, header_discount_pct, tax_pct, shipping_amount, intro_text";
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export async function loadQuoteSource(admin: SupabaseClient, tenantId: string, quoteId: string, origin: string): Promise<QuoteSource | null> {
  const { data: q } = await admin.from("standard_quotes").select(QUOTE_COLS).eq("id", quoteId).eq("tenant_id", tenantId).maybeSingle();
  if (!q) return null;
  const quote = q as unknown as QuoteRow;

  const [{ data: lineRows }, { data: acct }] = await Promise.all([
    admin.from("standard_quote_lines").select("sl_no, description, uom, qty, rate, discount_pct, amount, is_selected").eq("standard_quote_id", quoteId).eq("tenant_id", tenantId).order("sl_no"),
    admin.from("accounts").select("name").eq("id", quote.account_id).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const lines: OutLine[] = ((lineRows ?? []) as Record<string, unknown>[])
    .filter((l) => l.is_selected !== false)
    .map((l, i) => ({
      sl_no: String(l.sl_no ?? i + 1), description: String(l.description ?? ""), uom: (l.uom as string | null) ?? null,
      qty: num(l.qty, 1), rate: num(l.rate), discount_pct: num(l.discount_pct), amount: num(l.amount),
    }));

  const out: QuoteSource = { quote, lines, accountName: String((acct as { name?: string } | null)?.name ?? "Customer"), fence: null, estimate: null };

  const { data: fp, error: fpErr } = await admin.from("fence_projects")
    .select("id, name, layout, total_length_m, fabric_height_m, mesh_spec, coating, security_profile_id")
    .eq("standard_quote_id", quoteId).eq("tenant_id", tenantId).limit(1).maybeSingle();
  if (fp && !fpErr) {
    const f = fp as Record<string, unknown>;
    const [{ data: prof }, { data: gates }] = await Promise.all([
      f.security_profile_id
        ? admin.from("fence_security_profiles").select("label").eq("id", f.security_profile_id as string).eq("tenant_id", tenantId).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("fence_gates").select("gate_type, width_m").eq("fence_project_id", f.id as string).eq("tenant_id", tenantId),
    ]);
    out.fence = {
      name: String(f.name ?? "Fence"), layout: String(f.layout ?? "closed_perimeter"), total_length_m: num(f.total_length_m),
      fabric_height_m: f.fabric_height_m == null ? null : num(f.fabric_height_m),
      mesh_spec: (f.mesh_spec as string | null) ?? null, coating: (f.coating as string | null) ?? null,
      security_profile: (prof as { label?: string } | null)?.label ?? null,
      gates: ((gates ?? []) as { gate_type: string; width_m: number }[]).map((g) => ({ gate_type: g.gate_type, width_m: num(g.width_m) })),
      drawing_url: `${origin}${ROUTES.fenceProject(f.id as string)}`,
    };
    return out;
  }
  if (fpErr && !isSchemaPending(fpErr)) return out;

  const { data: est, error: estErr } = await admin.from("estimates").select("*").eq("standard_quote_id", quoteId).eq("tenant_id", tenantId).limit(1).maybeSingle();
  if (est && !estErr) {
    const e = est as Record<string, unknown>;
    const rawLines: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("estimate_lines").select("*").eq("tenant_id", tenantId).eq("estimate_id", e.id as string)
        .order("sort_order").order("created_at").order("id").range(from, from + 999);
      if (error || !data?.length) break;
      rawLines.push(...(data as Record<string, unknown>[]));
      if (data.length < 1000) break;
    }
    let groups = new Map<string, string>();
    if (e.template_id) {
      const { data: tpl } = await admin.from("estimate_templates").select("rules").eq("id", e.template_id as string).eq("tenant_id", tenantId).maybeSingle();
      const rules = (tpl as { rules?: { group: string }[] } | null)?.rules;
      if (Array.isArray(rules)) groups = templateGroupNames(rules);
    }
    out.estimate = {
      info: {
        name: String(e.name ?? "Estimate"), ref: (e.ref as string | null) ?? null,
        params: (e.params as Record<string, number | string | boolean> | null) ?? null,
        notes: (e.notes as string | null) ?? null,
        totals: (e.totals as EstimateInfo["totals"]) ?? null,
      },
      exportLines: rawLines.map((r) => toExportLine(normaliseLine(r), groups)),
    };
  }
  return out;
}
