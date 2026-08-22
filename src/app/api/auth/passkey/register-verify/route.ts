import { NextResponse, type NextRequest } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { verifyChallenge, relyingParty, CHALLENGE_COOKIE } from "@/lib/passkeys";

// POST /api/auth/passkey/register-verify — finish registration: verify the
// authenticator's response against the challenge cookie register-options set
// for this same session user, then store the credential's PUBLIC key. The
// private key never leaves the device; no biometric data reaches us at all.
export async function POST(request: NextRequest) {
  let tenantId, userId;
  try {
    ({ tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const challenge = verifyChallenge(request.cookies.get(CHALLENGE_COOKIE)?.value, "reg", userId);
  if (!challenge) {
    return NextResponse.json({ error: "Registration expired — try again." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const response = body?.response as RegistrationResponseJSON | undefined;
  const deviceLabel = typeof body?.device_label === "string" ? body.device_label.slice(0, 60) : null;
  if (!response) return NextResponse.json({ error: "Missing response" }, { status: 400 });

  const host = (request.headers.get("host") ?? "").split(":")[0];
  const { rpID, origin } = relyingParty(host);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    console.error("passkey register-verify failed:", (e as Error).message);
    return NextResponse.json({ error: "This device's response couldn't be verified — try again." }, { status: 400 });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "This device's response couldn't be verified — try again." }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const admin = createAdminSupabase();
  const { error } = await admin.from("webauthn_credentials").upsert(
    {
      tenant_id: tenantId,
      user_id: userId,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString("base64"),
      counter: credential.counter,
      transports: credential.transports ?? null,
      device_label: deviceLabel,
    },
    { onConflict: "credential_id" }
  );
  if (error) {
    // 42P01 = the webauthn_credentials migration (0095) hasn't been applied yet.
    const code = (error as { code?: string }).code;
    console.error("passkey register: insert failed:", error.message);
    return NextResponse.json(
      { error: code === "42P01" ? "Passkeys aren't set up on the server yet (missing table)." : "Could not save the passkey." },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(CHALLENGE_COOKIE);
  return res;
}
