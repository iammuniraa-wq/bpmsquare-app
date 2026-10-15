import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { signOAuthState } from "@/lib/connectors/oauthState";
import { buildAbsoluteUrl } from "@/lib/quotePublicLink";
import { loadD365 } from "@/lib/connectors/d365/server";
import { authorizeUrl } from "@/lib/connectors/d365/jwt";
import { resourceFor } from "@/lib/connectors/d365/catalog";

// GET -- "Connect with Microsoft" for the sign-in-as-a-user login type.
// Uses the CUSTOMER's own app registration (client id + secret saved on the
// connector), not a BPMSquare-wide app, so their IT controls consent. The
// state is HMAC-signed (CSRF) and the redirect returns to this host.
export async function GET() {
  let tenantId: string;
  try {
    const a = await requireTenantUser();
    if (a.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = a.tenantId;
  } catch {
    return NextResponse.redirect(await buildAbsoluteUrl("/login"));
  }
  const back = await buildAbsoluteUrl("/settings/connectors/dynamics365");
  const row = await loadD365(createAdminSupabase(), tenantId);
  if (!row || row.cfg.auth_mode !== "authorization_code") return NextResponse.redirect(`${back}?d365_error=${encodeURIComponent("Choose 'sign in as a user' and save first.")}`);
  const state = signOAuthState(tenantId, "dynamics365");
  if (!state) return NextResponse.redirect(`${back}?d365_error=${encodeURIComponent("Sign-in isn't configured on this platform (CONNECTOR_OAUTH_STATE_SECRET).")}`);
  const url = new URL(authorizeUrl(row.cfg.directory_id!));
  url.searchParams.set("client_id", row.cfg.client_id!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", await buildAbsoluteUrl("/api/connectors/dynamics365/oauth/callback"));
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", `${resourceFor(row.cfg)}/.default offline_access`);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return NextResponse.redirect(url.toString());
}
