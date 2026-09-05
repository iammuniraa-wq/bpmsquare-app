import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { assertSafeSourceUrl } from "@/lib/account360/externalSource";
import type { Account360Config, Account360SourceDef } from "@/lib/constants";

/**
 * Account 360 configuration: which built-in cards a tenant shows, in what
 * order, and the external sources it has plugged in.
 *
 * Admin-only in BOTH directions -- unlike most settings routes, GET is
 * gated too, because a source's auth_value is a credential (the same
 * reasoning that added the role check to GET /api/settings/integration-push).
 */

const CARD_IDS = ["pipeline", "revenue", "service", "people", "installed_base", "coverage", "sales_coverage", "projects"];

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await tenantHasFeature(supabase, tenantId, "next_experience"))) {
    return NextResponse.json({ error: "Nova isn't enabled for your workspace" }, { status: 403 });
  }

  const { data, error } = await createAdminSupabase()
    .from("tenants").select("config").eq("id", tenantId).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const config = (data?.config as { account_360?: Account360Config } | null)?.account_360 ?? {};
  // The editor needs to know a secret EXISTS, never what it is -- a saved
  // credential has no reason to travel back out to a browser, and PUT
  // preserves it when the field comes back blank.
  const sources = (config.sources ?? []).map(({ auth_value, ...rest }) => ({
    ...rest,
    auth_value: auth_value ? "••••••••" : "",
  }));
  return NextResponse.json({ hidden_cards: [], card_order: [], ...config, sources });
}

export async function PUT(request: NextRequest) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await tenantHasFeature(supabase, tenantId, "next_experience"))) {
    return NextResponse.json({ error: "Nova isn't enabled for your workspace" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid payload");

  const hidden: string[] = Array.isArray(body.hidden_cards)
    ? body.hidden_cards.filter((x: unknown): x is string => typeof x === "string")
    : [];
  const order: string[] = Array.isArray(body.card_order)
    ? body.card_order.filter((x: unknown): x is string => typeof x === "string" && CARD_IDS.includes(x))
    : [];

  const rawSources: unknown[] = Array.isArray(body.sources) ? body.sources : [];
  if (rawSources.length > 6) return badRequest("Up to 6 external sources per workspace");

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin
    .from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const existing = ((current?.config as { account_360?: Account360Config } | null)?.account_360?.sources ?? []);

  const seen = new Set<string>();
  const sources: Account360SourceDef[] = [];
  for (const raw of rawSources) {
    const s = raw as Partial<Account360SourceDef>;
    const id = typeof s.id === "string" ? s.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") : "";
    const title = typeof s.title === "string" ? s.title.trim().slice(0, 60) : "";
    const url = typeof s.url === "string" ? s.url.trim() : "";
    if (!id || !title || !url) return badRequest("Every source needs an id, a title and a URL");
    if (seen.has(id)) return badRequest(`Duplicate source id "${id}"`);
    seen.add(id);

    // Validated with the account tokens stripped out, so a template that is
    // only unsafe once filled still can't be saved.
    try {
      await assertSafeSourceUrl(url.replace(/\{\w+\}/g, "x"));
    } catch (e) {
      return badRequest(`${title}: ${(e as Error).message}`);
    }

    const fields = (Array.isArray(s.fields) ? s.fields : [])
      .filter((f): f is { label: string; path: string } =>
        !!f && typeof f.label === "string" && typeof f.path === "string" && !!f.label.trim() && !!f.path.trim())
      .slice(0, 12)
      .map((f) => ({ label: f.label.trim().slice(0, 40), path: f.path.trim().slice(0, 120) }));

    // A blank auth_value means "unchanged", never "clear it" -- the editor
    // only ever receives a masked placeholder for an already-saved secret,
    // so treating blank as a clear would wipe the credential on every save.
    const prior = existing.find((e) => e.id === id);
    const authValue = typeof s.auth_value === "string" && s.auth_value.trim() && !/^•+$/.test(s.auth_value)
      ? s.auth_value.trim()
      : prior?.auth_value;

    sources.push({
      id,
      title,
      url,
      auth_header: typeof s.auth_header === "string" && s.auth_header.trim() ? s.auth_header.trim().slice(0, 60) : undefined,
      auth_value: authValue,
      root_path: typeof s.root_path === "string" && s.root_path.trim() ? s.root_path.trim().slice(0, 120) : undefined,
      fields,
      enabled: s.enabled !== false,
    });
  }

  const account_360: Account360Config = { hidden_cards: hidden, card_order: order, sources };
  const merged = { ...(current?.config ?? {}), account_360 };
  const { error } = await admin.from("tenants").update({ config: merged }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
