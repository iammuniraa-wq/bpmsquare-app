import "server-only";
import type { createAdminSupabase } from "@/lib/supabase-server";

// What an instance tells the control plane about itself (GET /api/platform/summary) and what the console shows for the app it
// runs on. Platform-level data, so it reads across tenants on the service role; that is only acceptable because the caller is
// either the signed endpoint (signature verified first) or the platform-admin page. The projection is a WHITELIST: a tenant row is
// reduced to the fields below, so a secret column (api_key, config) or a person's e-mail cannot ride along by being added to a
// select later.

type Admin = ReturnType<typeof createAdminSupabase>;

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  custom_domain: string | null;
  is_demo: boolean;
  created_at: string;
  user_count: number;
  flags_on: string[];
};

export type InstanceSummary = {
  instance: { slug: string; name: string; build: string | null; region: string | null; now: string };
  tenants: TenantSummary[];
  health: { db: boolean; ai_configured: boolean; email_configured: boolean };
};

type TenantRow = {
  id: string; slug: string; name: string; status: string; plan: string; custom_domain: string | null; is_demo: boolean | null;
  created_at: string; features: Record<string, unknown> | null;
};

export function toTenantSummary(row: TenantRow, userCount: number): TenantSummary {
  const flags = Object.entries(row.features ?? {}).filter(([, v]) => v === true).map(([k]) => k).sort();
  return {
    id: row.id, slug: row.slug, name: row.name, status: row.status, plan: row.plan,
    custom_domain: row.custom_domain ?? null, is_demo: row.is_demo === true, created_at: row.created_at,
    user_count: userCount, flags_on: flags,
  };
}

/** Members per tenant. Paged, because PostgREST caps one response at 1000 rows. */
async function countMembers(admin: Admin): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("tenant_users").select("tenant_id").order("tenant_id").range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data as { tenant_id: string }[]) counts.set(r.tenant_id, (counts.get(r.tenant_id) ?? 0) + 1);
    if (data.length < PAGE) break;
  }
  return counts;
}

export async function buildSummary(admin: Admin, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<InstanceSummary> {
  // The columns are named one by one on purpose: tenants also holds api_key and a config with sealed secrets.
  const { data, error } = await admin
    .from("tenants")
    .select("id, slug, name, status, plan, custom_domain, is_demo, created_at, features")
    .order("created_at", { ascending: true });
  const members = error ? new Map<string, number>() : await countMembers(admin);
  const slug = (env.INSTANCE_SLUG ?? "").trim();
  return {
    instance: {
      slug,
      name: (env.INSTANCE_NAME ?? "").trim() || slug,
      build: env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 8) : null,
      region: env.VERCEL_REGION || null,
      now: now.toISOString(),
    },
    tenants: error ? [] : ((data ?? []) as TenantRow[]).map((t) => toTenantSummary(t, members.get(t.id) ?? 0)),
    health: { db: !error, ai_configured: !!env.ANTHROPIC_API_KEY, email_configured: !!env.RESEND_API_KEY },
  };
}

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const strOrNull = (v: unknown, max = 200): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);

/**
 * What another instance sent back is untrusted input to this one: rebuilt field by field (types coerced, lengths and counts
 * capped) before it is stored or drawn, so a compromised or buggy instance cannot plant an extra key or a huge payload.
 */
export function sanitizeRemoteSummary(raw: unknown): InstanceSummary | null {
  const r = raw as { instance?: Record<string, unknown>; tenants?: unknown; health?: Record<string, unknown> } | null;
  if (!r || typeof r !== "object" || !r.instance || typeof r.instance !== "object" || !Array.isArray(r.tenants) || !r.health) return null;
  const tenants: TenantSummary[] = [];
  for (const t of r.tenants.slice(0, 500) as Record<string, unknown>[]) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || typeof t.slug !== "string") continue;
    tenants.push({
      id: str(t.id, 64), slug: str(t.slug, 80), name: str(t.name, 200), status: str(t.status, 30), plan: str(t.plan, 30),
      custom_domain: strOrNull(t.custom_domain, 253), is_demo: t.is_demo === true, created_at: str(t.created_at, 40),
      user_count: Number.isFinite(t.user_count) ? Math.max(0, Math.floor(t.user_count as number)) : 0,
      flags_on: Array.isArray(t.flags_on) ? t.flags_on.filter((f): f is string => typeof f === "string").slice(0, 100).map((f) => f.slice(0, 60)) : [],
    });
  }
  return {
    instance: {
      slug: str(r.instance.slug, 80), name: str(r.instance.name, 200), build: strOrNull(r.instance.build, 40),
      region: strOrNull(r.instance.region, 40), now: str(r.instance.now, 40),
    },
    tenants,
    health: { db: r.health.db === true, ai_configured: r.health.ai_configured === true, email_configured: r.health.email_configured === true },
  };
}

/** Parses a stored last_summary back into the shape above; anything that does not fit reads as "no summary". */
export function readStoredSummary(raw: unknown): InstanceSummary | null {
  const s = raw as Partial<InstanceSummary> | null;
  if (!s || typeof s !== "object" || !s.instance || !Array.isArray(s.tenants) || !s.health) return null;
  return s as InstanceSummary;
}
