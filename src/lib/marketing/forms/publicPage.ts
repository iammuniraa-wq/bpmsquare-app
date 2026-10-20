import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIMARY_HOST } from "@/lib/constants";
import { createAdminSupabase } from "@/lib/supabase-server";
import { signRenderToken } from "./guards";
import { formsEnabled, toFormRow, type TenantForSubmit } from "./submit";
import type { PublicForm } from "./types";

// The hosted form page (/f/<slug>). The visitor has no session, so the tenant is read from the
// host the page is served on - the tenant's own domain - and the form from that tenant's slug.
// Anything that does not line up answers "not found": an unknown host, a slug that belongs to
// another workspace, a draft, a workspace without the flag.
//
// On a bare development host (localhost) there is no tenant domain to read, so a slug that
// exists in exactly one workspace is accepted; production hosts never take that path.

type TenantWithLogo = TenantForSubmit & { logo_url?: string | null };

export type PublicPage = {
  form: PublicForm;
  brand: { name: string; logoUrl: string | null };
};

async function tenantForHost(admin: SupabaseClient, host: string): Promise<TenantForSubmit | "dev" | null> {
  const cols = "id, name, custom_domain, is_demo, features, config, logo_url";
  if (host === "localhost" || host === "127.0.0.1") return "dev";
  const q = host === PRIMARY_HOST
    ? admin.from("tenants").select(cols).eq("is_demo", true).maybeSingle()
    : admin.from("tenants").select(cols).eq("custom_domain", host).maybeSingle();
  const { data } = await q;
  return (data as TenantForSubmit | null) ?? null;
}

export async function loadPublicPage(slug: string): Promise<PublicPage | null> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug)) return null;
  const host = ((await headers()).get("host") ?? "").split(":")[0].toLowerCase();
  const admin = createAdminSupabase();

  const resolved = await tenantForHost(admin, host);
  if (!resolved) return null;

  let formRow: Record<string, unknown> | null = null;
  let tenant: TenantWithLogo | null = null;
  if (resolved === "dev") {
    const { data } = await admin.from("forms").select("*").eq("slug", slug).eq("status", "live").limit(2);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length !== 1) return null;
    formRow = rows[0];
    const { data: t } = await admin.from("tenants").select("id, name, custom_domain, is_demo, features, config, logo_url").eq("id", formRow.tenant_id as string).maybeSingle();
    tenant = (t as TenantWithLogo | null) ?? null;
  } else {
    tenant = resolved as TenantWithLogo;
    const { data } = await admin.from("forms").select("*").eq("tenant_id", resolved.id).eq("slug", slug).eq("status", "live").maybeSingle();
    formRow = (data as Record<string, unknown> | null) ?? null;
  }
  if (!formRow || !tenant || !formsEnabled(tenant.features)) return null;

  const form = toFormRow(formRow);
  return {
    brand: { name: tenant.name, logoUrl: tenant.logo_url ?? null },
    form: {
      key: form.public_key,
      title: form.title || form.name,
      intro: form.intro ?? "",
      button: form.button_label || "Send",
      fields: form.fields.filter((f) => f.enabled).map((f) => ({ key: f.key, label: f.label, required: f.required })),
      consent: { text: form.consent.text, required: form.consent.required },
      renderToken: signRenderToken(form.public_key),
    },
  };
}
