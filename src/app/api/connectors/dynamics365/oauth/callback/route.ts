import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { verifyOAuthState } from "@/lib/connectors/oauthState";
import { buildAbsoluteUrl } from "@/lib/quotePublicLink";
import { loadD365, exchangeAuthCode, testConnection, markStatus } from "@/lib/connectors/d365/server";
import { PKCE_COOKIE, PKCE_COOKIE_PATH, validVerifier } from "@/lib/connectors/d365/pkce";

// GET ?code&state -- Microsoft sends the admin back here after sign-in. The
// signed state must name THIS tenant (the host's) and this connector, so a
// code can never be attached to another workspace. PKCE binds the code to
// the browser that started the sign-in: the verifier comes from an httpOnly
// cookie set by /oauth/start, is used once and is cleared on every outcome.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const back = await buildAbsoluteUrl("/settings/connectors/dynamics365");
  const clear = (res: NextResponse) => { res.cookies.set(PKCE_COOKIE, "", { httpOnly: true, path: PKCE_COOKIE_PATH, maxAge: 0 }); return res; };
  const fail = (m: string) => clear(NextResponse.redirect(`${back}?d365_error=${encodeURIComponent(m)}`));
  let tenantId: string;
  try {
    const a = await requireTenantUser();
    if (a.role !== "admin") return fail("Only an admin can connect Dynamics 365.");
    tenantId = a.tenantId;
  } catch {
    return NextResponse.redirect(await buildAbsoluteUrl("/login"));
  }
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return fail(`Microsoft: ${(sp.get("error_description") ?? sp.get("error") ?? "").split("\n")[0].slice(0, 300)}`);
  const state = verifyOAuthState(sp.get("state") ?? "");
  if (!state || state.tenantId !== tenantId || state.connectorId !== "dynamics365") return fail("The sign-in link expired or wasn't for this workspace — try again.");
  const code = sp.get("code");
  if (!code) return fail("Microsoft didn't return a code.");
  const verifier = req.cookies.get(PKCE_COOKIE)?.value;
  if (!validVerifier(verifier)) return fail("This sign-in wasn't started in this browser, or it took too long — press Connect with Microsoft again.");
  const admin = createAdminSupabase();
  const row = await loadD365(admin, tenantId);
  if (!row) return fail("Save the connection first.");
  try {
    await exchangeAuthCode(admin, tenantId, row.cfg, row.creds, code, await buildAbsoluteUrl("/api/connectors/dynamics365/oauth/callback"), verifier);
    const fresh = await loadD365(admin, tenantId);
    await testConnection(admin, tenantId, fresh!.cfg, fresh!.creds);
    await markStatus(admin, tenantId, true);
    return clear(NextResponse.redirect(`${back}?d365_connected=1`));
  } catch (e) {
    await markStatus(admin, tenantId, false, (e as Error).message);
    return fail((e as Error).message);
  }
}
