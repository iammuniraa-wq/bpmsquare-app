import { NextResponse, type NextRequest } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { signChallenge, relyingParty, CHALLENGE_COOKIE } from "@/lib/passkeys";
import { SUPABASE_COOKIE_OPTIONS, type TenantConfig, type TenantFeatures } from "@/lib/constants";

// POST /api/auth/passkey/login-options — start a passkey sign-in. Pre-session
// by nature (middleware public list); the tenant is resolved from the host and
// must have passkey_login on. Usernameless: no allowCredentials, the device
// offers whichever discoverable credential it holds for this domain.
export async function POST(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!host) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, features, config")
    .eq("custom_domain", host)
    .maybeSingle();
  const features = (tenant?.features ?? {}) as TenantFeatures;
  const wfm = ((tenant?.config as TenantConfig | null)?.wfm ?? {}) as { passkey_login?: boolean };
  if (!tenant || features.wfm !== true || wfm.passkey_login !== true) {
    return NextResponse.json({ error: "Passkey sign-in isn't enabled for this workspace." }, { status: 403 });
  }

  const { rpID } = relyingParty(host);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: [],
  });

  const res = NextResponse.json(options);
  res.cookies.set(CHALLENGE_COOKIE, signChallenge(options.challenge, "auth"), {
    httpOnly: true, sameSite: "lax", path: "/api/auth/passkey", maxAge: 300, ...SUPABASE_COOKIE_OPTIONS,
  });
  return res;
}
