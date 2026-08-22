import { NextResponse, type NextRequest } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { verifyChallenge, relyingParty, CHALLENGE_COOKIE } from "@/lib/passkeys";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";

// POST /api/auth/passkey/login-verify — finish a passkey sign-in. Pre-session
// (middleware public list). The device signed our challenge with a key it
// only unlocks via its own biometric/PIN; we verify the signature against
// the stored public key, then mint the same single-use token the face and
// password-reset flows use, finished through /auth/callback. Failures are
// one generic message -- no probe surface for which credentials exist.
const GENERIC = "Couldn't sign in with this passkey. Use your ID and password.";

export async function POST(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!host) return NextResponse.json({ error: GENERIC }, { status: 400 });

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
  const tenantId = tenant.id as string;

  const challenge = verifyChallenge(request.cookies.get(CHALLENGE_COOKIE)?.value, "auth");
  if (!challenge) return NextResponse.json({ error: "Sign-in expired — try again." }, { status: 400 });

  const body = await request.json().catch(() => null);
  const response = body?.response as AuthenticationResponseJSON | undefined;
  if (!response?.id) return NextResponse.json({ error: GENERIC }, { status: 400 });

  const refuse = (reason: string) => {
    console.error(`passkey login refused [tenant ${tenantId}]: ${reason}`);
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  };

  // Tenant-scoped lookup: a credential registered on another tenant's domain
  // can't be replayed here even if the rpID check were somehow bypassed.
  const { data: cred, error: credErr } = await admin
    .from("webauthn_credentials")
    .select("id, user_id, public_key, counter, transports")
    .eq("tenant_id", tenantId)
    .eq("credential_id", response.id)
    .maybeSingle();
  if (credErr) {
    console.error("passkey login: credential lookup failed:", credErr.message);
    return NextResponse.json({ error: GENERIC }, { status: 500 });
  }
  if (!cred) return refuse("unknown credential id");

  const { rpID, origin } = relyingParty(host);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: response.id,
        publicKey: new Uint8Array(Buffer.from(cred.public_key as string, "base64")),
        counter: Number(cred.counter ?? 0),
        transports: (cred.transports ?? undefined) as import("@simplewebauthn/server").WebAuthnCredential["transports"],
      },
    });
  } catch (e) {
    return refuse(`verification threw: ${(e as Error).message}`);
  }
  if (!verification.verified) return refuse("signature did not verify");

  // The credential's owner must still be a usable member of THIS tenant.
  const { data: membership } = await admin
    .from("tenant_users")
    .select("user_id, is_locked, valid_from, valid_to")
    .eq("tenant_id", tenantId)
    .eq("user_id", cred.user_id)
    .maybeSingle();
  if (!membership || membership.is_locked) return refuse("membership missing or locked");
  const today = new Date().toISOString().slice(0, 10);
  if ((membership.valid_from && today < membership.valid_from) || (membership.valid_to && today > membership.valid_to)) {
    return refuse("membership outside validity window");
  }

  await admin
    .from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq("id", cred.id);

  const { data: userRes } = await admin.auth.admin.getUserById(cred.user_id);
  const email = userRes?.user?.email;
  if (!email) return refuse("auth user has no email");

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error("passkey login: generateLink failed:", linkErr?.message);
    return NextResponse.json({ error: GENERIC }, { status: 500 });
  }

  const res = NextResponse.json({ token_hash: link.properties.hashed_token });
  res.cookies.delete(CHALLENGE_COOKIE);
  return res;
}
