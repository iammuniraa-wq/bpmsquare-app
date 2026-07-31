import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getConnectorDef } from "@/lib/connectors/registry";
import { signOAuthState } from "@/lib/connectors/oauthState";
import { buildAbsoluteUrl } from "@/lib/quotePublicLink";

/** Hit via a real browser navigation (a link, not fetch) -- it has to end in
 * an actual redirect to the provider's own consent screen. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const settingsUrl = await buildAbsoluteUrl("/settings/connectors");

  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    return NextResponse.redirect(settingsUrl);
  }
  if (role !== "admin") {
    return NextResponse.redirect(`${settingsUrl}?connector_error=${encodeURIComponent("Only a workspace admin can connect this")}`);
  }

  const def = getConnectorDef(id);
  if (!def?.oauth) return NextResponse.redirect(`${settingsUrl}?connector_error=${encodeURIComponent("Unknown connector")}`);

  const clientId = process.env[def.oauth.provider.clientIdEnv];
  if (!clientId) {
    return NextResponse.redirect(`${settingsUrl}?connector_error=${encodeURIComponent(`${def.oauth.provider.clientIdEnv} is not configured on the server`)}`);
  }

  const state = signOAuthState(tenantId, id);
  if (!state) {
    return NextResponse.redirect(`${settingsUrl}?connector_error=${encodeURIComponent("CONNECTOR_OAUTH_STATE_SECRET is not configured on the server")}`);
  }

  const redirectUri = await buildAbsoluteUrl(`/api/connectors/${id}/oauth/callback`);
  const url = new URL(def.oauth.provider.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", def.oauth.scopes.join(" "));
  url.searchParams.set("state", state);
  for (const [k, v] of Object.entries(def.oauth.provider.extraAuthParams ?? {})) url.searchParams.set(k, v);

  return NextResponse.redirect(url.toString());
}
