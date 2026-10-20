import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { applyFilters } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { CONSENTS_SPEC } from "@/lib/import/consentsSchema";
import { decrypt } from "@/lib/encryption";
import { topicsOf } from "@/lib/marketing/config";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";

type StateRow = { id: string; contact_id: string; channel: string; topic: string; status: string; basis: string; jurisdiction: string; since: string };

/**
 * Read-only export of the CURRENT consent answer per contact, channel and topic.
 * There is no Update for consents: the ledger is append-only history.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "consents");
  if (gate) return gate;
  const { data: tenantRow } = await createAdminSupabase().from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  if ((tenantRow?.features as Partial<TenantFeatures> | undefined)?.marketing !== true) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  // A missing ledger (migration pending) is an empty file, never an error.
  let states: StateRow[];
  try {
    const probe = await supabase.from("consent_state").select("id").eq("tenant_id", tenantId).limit(1);
    if (probe.error && isSchemaPending(probe.error)) return NextResponse.json({ rows: [] } satisfies ExportResponse);
    states = await fetchAllRows<StateRow>(supabase, "consent_state", "id, contact_id, channel, topic, status, basis, jurisdiction, since", tenantId);
  } catch {
    return NextResponse.json({ rows: [] } satisfies ExportResponse);
  }

  const [contacts, accounts] = await Promise.all([
    fetchAllRows<{ id: string; name: string; email: string | null; account_id: string }>(supabase, "contacts", "id, name, email, account_id", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const topics = topicsOf((tenantRow?.config ?? null) as Partial<TenantConfig> | null);

  const rows: Record<string, string>[] = states.map((s) => {
    const contact = contactById.get(s.contact_id);
    return {
      id: s.id,
      email: decrypt(contact?.email ?? null) ?? "",
      channel: s.channel,
      topic: s.topic === "" ? "" : (topics.find((t) => t.key === s.topic)?.label ?? s.topic),
      status: s.status,
      basis: s.basis,
      given_on: "",
      note: "",
      contact_id: s.contact_id,
      contact_name: contact?.name ?? "",
      account_name: contact ? (accountName.get(contact.account_id) ?? "") : "",
      since: s.since.slice(0, 10),
      jurisdiction: s.jurisdiction,
    };
  });

  const typeByKey = new Map(CONSENTS_SPEC.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}
