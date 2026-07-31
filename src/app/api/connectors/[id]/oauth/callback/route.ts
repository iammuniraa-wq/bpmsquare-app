import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getConnectorDef } from "@/lib/connectors/registry";
import { verifyOAuthState } from "@/lib/connectors/oauthState";
import { storeOAuthTokens } from "@/lib/connectors/server";
import { buildAbsoluteUrl } from "@/lib/quotePublicLink";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const settingsUrl = await buildAbsoluteUrl("/settings/connectors");
  const fail = (msg: string) => NextResponse.redirect(`${settingsUrl}?connector_error=${encodeURIComponent(msg)}`);

  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) return fail(providerError);

  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch {
    return fail("Sign in and try connecting again");
  }
  if (role !== "admin") return fail("Only a workspace admin can connect this");

  const def = getConnectorDef(id);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!def?.oauth || !code || !state) return fail("Invalid callback");

  // state only ever proves "this redirect matches a /start call this same
  // tenant made in the last 10 minutes" -- tenant identity itself always
  // comes from the live session (requireTenantUser), never from state alone,
  // so a captured/replayed state can't be used to attach tokens to a
  // different tenant's session.
  const verified = verifyOAuthState(state);
  if (!verified || verified.connectorId !== id || verified.tenantId !== tenantId) {
    return fail("This connection link expired or doesn't match your session — try connecting again");
  }

  const clientId = process.env[def.oauth.provider.clientIdEnv];
  const clientSecret = process.env[def.oauth.provider.clientSecretEnv];
  if (!clientId || !clientSecret) return fail("Server is not configured for this connector");

  const redirectUri = await buildAbsoluteUrl(`/api/connectors/${id}/oauth/callback`);
  const tokenRes = await fetch(def.oauth.provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    return fail(`Could not complete the connection: ${body || tokenRes.status}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };

  await storeOAuthTokens(supabase, tenantId, id, userId, {
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    expires_in: tokenJson.expires_in,
  });

  return NextResponse.redirect(settingsUrl);
}
