import { NextResponse, type NextRequest } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig } from "@/lib/wfm/server";
import { signChallenge, relyingParty, CHALLENGE_COOKIE } from "@/lib/passkeys";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/constants";

// POST /api/auth/passkey/register-options — start registering THIS session's
// user a passkey on THIS device. Session-authenticated (you can only ever
// enroll a passkey for yourself). Returns WebAuthn creation options; the
// challenge rides back in a short-lived signed httpOnly cookie bound to the
// session user, which register-verify checks.
export async function POST(request: NextRequest) {
  let tenantId, userId;
  try {
    ({ tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, tenantId);
  if (!config.passkey_login) {
    return NextResponse.json({ error: "Passkey sign-in isn't enabled for this workspace." }, { status: 403 });
  }

  const host = (request.headers.get("host") ?? "").split(":")[0];
  if (!host) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { rpID } = relyingParty(host);

  const [{ data: tenant }, { data: membership }, { data: existing }] = await Promise.all([
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    admin.from("tenant_users").select("display_name").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
    admin.from("webauthn_credentials").select("credential_id, transports").eq("tenant_id", tenantId).eq("user_id", userId),
  ]);

  const options = await generateRegistrationOptions({
    rpName: tenant?.name ?? "BPMSquare",
    rpID,
    userName: membership?.display_name || "Employee",
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    // Discoverable + user-verified: sign-in later needs no username typed,
    // and the device MUST use its biometric/PIN, not mere possession.
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    // Don't let the same device register twice.
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id as string,
      transports: (c.transports ?? undefined) as import("@simplewebauthn/server").WebAuthnCredential["transports"],
    })),
  });

  const res = NextResponse.json(options);
  res.cookies.set(CHALLENGE_COOKIE, signChallenge(options.challenge, "reg", userId), {
    httpOnly: true, sameSite: "lax", path: "/api/auth/passkey", maxAge: 300, ...SUPABASE_COOKIE_OPTIONS,
  });
  return res;
}
