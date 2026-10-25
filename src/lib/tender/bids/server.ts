import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { loadActorNames } from "@/lib/actorNames";
import { boqOrderedLines } from "../boq/lineSync";
import { PRICE_SOURCE_LABEL, type PriceSource } from "../boq/price";
import { isMissingSchema } from "../server";
import { buildSnapshot, parseStoredLines, type BidLine, type BidVersionSummary, type Snapshot, type SnapshotSource } from "./rules";

// Server side of the bid versions (migration 0225, slice 4). Every query is tenant-scoped on the admin client and every one
// tolerates the migration being pending (a missing table answers `pending`, never a crash).

const SUMMARY_COLS = "id, version_no, submitted_at, submitted_by, currency, total, line_count, revision_reason, note";

type Row = { id: string; version_no: number; submitted_at: string; submitted_by: string | null; currency: string | null; total: number | string; line_count: number; revision_reason: string | null; note: string | null };

/** Every version of a deal, newest first, without the lines. */
export async function listBidVersions(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ versions: BidVersionSummary[]; pending: boolean }> {
  const { data, error } = await admin.from("tender_bid_versions").select(SUMMARY_COLS).eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("version_no", { ascending: false }).limit(1000);
  if (error) return { versions: [], pending: isMissingSchema(error) };
  const rows = (data ?? []) as Row[];
  const names = await loadActorNames(admin, tenantId, rows.map((r) => r.submitted_by));
  return {
    pending: false,
    versions: rows.map((r) => ({
      id: r.id, version_no: Number(r.version_no), submitted_at: r.submitted_at, submitted_by_name: r.submitted_by ? names.get(r.submitted_by) ?? null : null,
      currency: r.currency, total: Number(r.total), line_count: Number(r.line_count ?? 0), revision_reason: r.revision_reason, note: r.note,
    })),
  };
}

/** One version with its lines (for the comparison). */
export async function loadBidVersion(admin: SupabaseClient, tenantId: string, opportunityId: string, versionNo: number): Promise<{ version_no: number; total: number; currency: string | null; lines: BidLine[] } | null> {
  const { data, error } = await admin.from("tender_bid_versions").select("version_no, total, currency, lines").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).eq("version_no", versionNo).maybeSingle();
  if (error || !data) return null;
  const r = data as { version_no: number; total: number | string; currency: string | null; lines: unknown };
  return { version_no: Number(r.version_no), total: Number(r.total), currency: r.currency, lines: parseStoredLines(r.lines) };
}

/** The highest version number so far (0 when none), or `pending`. */
export async function latestVersionNo(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ no: number; pending: boolean }> {
  const { data, error } = await admin.from("tender_bid_versions").select("version_no").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("version_no", { ascending: false }).limit(1);
  if (error) return { no: 0, pending: isMissingSchema(error) };
  return { no: Number((data as { version_no: number }[] | null)?.[0]?.version_no ?? 0), pending: false };
}

/** The deal's lines right now as a bid snapshot: the client's file order, the whitelisted fields, product ref and price-source LABEL only. */
export async function currentSnapshot(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<Snapshot> {
  const saved = await loadOpportunityLines(admin, tenantId, opportunityId);
  const ordered = (await boqOrderedLines(admin, tenantId, opportunityId, saved)) as unknown as (SnapshotSource & { id: string })[];

  const productIds = [...new Set(ordered.map((l) => l.product_id).filter((x): x is string => !!x))];
  const productRef = new Map<string, string>();
  for (let i = 0; i < productIds.length; i += 100) {
    const { data, error } = await admin.from("products").select("id, sku, name").eq("tenant_id", tenantId).in("id", productIds.slice(i, i + 100));
    if (error) break;
    for (const p of (data ?? []) as { id: string; sku: string | null; name: string | null }[]) productRef.set(p.id, p.sku?.trim() || p.name?.trim() || "");
  }

  // Only the LABEL of the price source is read; the cost and markup columns of the BOQ row are never selected.
  const priceSource = new Map<string, string>();
  const { data: boq, error: boqErr } = await admin.from("tender_boq_lines").select("line_id, price_source").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).limit(5000);
  if (!boqErr) {
    for (const r of (boq ?? []) as { line_id: string | null; price_source: PriceSource | null }[]) {
      if (r.line_id && r.price_source && PRICE_SOURCE_LABEL[r.price_source]) priceSource.set(r.line_id, PRICE_SOURCE_LABEL[r.price_source]);
    }
  }
  return buildSnapshot(ordered, { productRef, priceSource });
}
