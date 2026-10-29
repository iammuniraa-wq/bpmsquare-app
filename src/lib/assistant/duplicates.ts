import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// "Does this already exist?", asked before anything is created. Only ever a warning, never a block: account names are
// legitimately non-unique, and phone, email and GSTIN are encrypted at rest so they cannot be matched in SQL. Every
// query is tenant-scoped; the session client is the one passed in (RLS is the second lock).

export type DuplicateHit = { id: string; name: string; ref: string | null };

const clean = (s: string, max = 80): string => s.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** "https://www.Tesla.com/de" -> "tesla.com"; null when it does not look like an address. */
export function websiteHost(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;
  const host = t.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** Case-insensitive contains, both ways (the stored name may be the shorter one), plus the same website host. */
export async function findAccountDuplicates(
  supabase: SupabaseClient,
  tenantId: string,
  draftName: string | undefined,
  website?: string | null,
): Promise<DuplicateHit[]> {
  const hits = new Map<string, DuplicateHit>();
  const add = (rows: { id: string; name: string; ref?: string | null }[] | null) => {
    for (const d of rows ?? []) if (!hits.has(d.id)) hits.set(d.id, { id: d.id, name: d.name, ref: d.ref ?? null });
  };

  const needle = clean(draftName ?? "");
  if (needle.length >= 3) {
    const { data } = await supabase.from("accounts").select("id, name, ref")
      .eq("tenant_id", tenantId).ilike("name", `%${needle}%`).limit(3);
    add(data);
    if (hits.size === 0) {
      const firstWords = needle.split(" ").slice(0, 2).join(" ");
      if (firstWords.length >= 4) {
        const { data: rev } = await supabase.from("accounts").select("id, name, ref")
          .eq("tenant_id", tenantId).ilike("name", `%${firstWords}%`).limit(3);
        add(rev);
      }
    }
  }

  const host = websiteHost(website);
  if (host) {
    const { data } = await supabase.from("accounts").select("id, name, ref, website")
      .eq("tenant_id", tenantId).ilike("website", `%${host}%`).limit(10);
    add(((data ?? []) as { id: string; name: string; ref?: string | null; website?: string | null }[]).filter((r) => websiteHost(r.website) === host));
  }
  return [...hits.values()].slice(0, 5);
}

/** A contact of the same name already on the same account. */
export async function findContactDuplicates(
  supabase: SupabaseClient,
  tenantId: string,
  accountId: string | undefined,
  draftName: string | undefined,
): Promise<DuplicateHit[]> {
  const needle = clean(draftName ?? "");
  if (!accountId || needle.length < 2) return [];
  const { data } = await supabase.from("contacts").select("id, name, ref")
    .eq("tenant_id", tenantId).eq("account_id", accountId).ilike("name", `%${needle}%`).limit(3);
  return ((data ?? []) as { id: string; name: string; ref?: string | null }[]).map((d) => ({ id: d.id, name: d.name, ref: d.ref ?? null }));
}

/** A supplier whose name contains this one (the stored name may be the longer). */
export async function findSupplierDuplicates(supabase: SupabaseClient, tenantId: string, draftName: string | undefined): Promise<DuplicateHit[]> {
  const needle = clean(draftName ?? "");
  if (needle.length < 3) return [];
  const { data } = await supabase.from("suppliers").select("id, name, ref").eq("tenant_id", tenantId).ilike("name", `%${needle}%`).limit(3);
  return ((data ?? []) as { id: string; name: string; ref?: string | null }[]).map((d) => ({ id: d.id, name: d.name, ref: d.ref ?? null }));
}

/** The same SKU, or a product of a similar name. */
export async function findProductDuplicates(
  supabase: SupabaseClient,
  tenantId: string,
  draftName: string | undefined,
  sku: string | undefined,
): Promise<DuplicateHit[]> {
  const hits = new Map<string, DuplicateHit>();
  const add = (rows: { id: string; name: string; ref?: string | null }[] | null) => {
    for (const d of rows ?? []) if (!hits.has(d.id)) hits.set(d.id, { id: d.id, name: d.name, ref: d.ref ?? null });
  };
  const code = (sku ?? "").trim();
  if (code) {
    const { data } = await supabase.from("products").select("id, name, ref").eq("tenant_id", tenantId).eq("sku", code).limit(3);
    add(data);
  }
  const needle = clean(draftName ?? "");
  if (needle.length >= 3) {
    const { data } = await supabase.from("products").select("id, name, ref").eq("tenant_id", tenantId).ilike("name", `%${needle}%`).limit(3);
    add(data);
  }
  return [...hits.values()].slice(0, 5);
}

/** A tender with this number already in the workspace; the hit is its deal. A missing tender table is simply no duplicate. */
export async function findTenderDuplicates(supabase: SupabaseClient, tenantId: string, tenderNo: string | undefined): Promise<DuplicateHit[]> {
  const no = (tenderNo ?? "").trim();
  if (!no) return [];
  const { data: t } = await supabase.from("opportunity_tenders").select("opportunity_id").eq("tenant_id", tenantId).eq("tender_no", no).limit(3);
  const ids = ((t ?? []) as { opportunity_id: string }[]).map((r) => r.opportunity_id);
  if (ids.length === 0) return [];
  const { data } = await supabase.from("opportunities").select("id, title, ref").eq("tenant_id", tenantId).in("id", ids);
  return ((data ?? []) as { id: string; title: string; ref?: string | null }[]).map((d) => ({ id: d.id, name: d.title, ref: d.ref ?? null }));
}
