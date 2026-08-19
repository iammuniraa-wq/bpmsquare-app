import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { createAdminSupabase } from "@/lib/supabase-server";
import { logEmail } from "@/lib/emailLog";
import { PRIMARY_HOST, isMembershipActive } from "@/lib/constants";
import { escapeHtml } from "@/lib/emailTemplates";

/**
 * Password reset, sent by us instead of by Supabase Auth.
 *
 * Supabase's own recovery email uses the PKCE flow: the link carries a
 * `code` that can only be exchanged by the browser holding the matching
 * code_verifier cookie. That breaks in the two most ordinary cases there
 * are -- requesting the reset on a laptop and opening the mail on a phone,
 * and a tenant whose custom domain isn't in the project's redirect
 * allow-list (Supabase then rewrites the link to the project Site URL, a
 * different origin, where the verifier cookie was never set). Both end
 * with the exchange failing and the user staring at a login screen.
 *
 * generateLink gives us the `hashed_token` for the same recovery, which
 * `verifyOtp` accepts from ANY browser with no verifier involved, and lets
 * us point the link at this request's own host -- so the link always lands
 * back on the workspace the user asked from.
 *
 * Public by necessity (nobody can log in to ask for a password reset), so
 * the response is identical whether or not the address exists: an
 * unauthenticated caller must not be able to use this to discover who has
 * an account.
 */

const OK = NextResponse.json({ ok: true });

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const host = (request.headers.get("host") ?? "").split(":")[0];
  const proto = host === "localhost" || host === "127.0.0.1" ? "http" : "https";
  const origin = `${proto}://${request.headers.get("host") ?? host}`;

  const admin = createAdminSupabase();

  // Which workspace is being asked from? The reset link must come back to
  // this same host, or the user lands in a workspace they aren't a member
  // of and gets bounced right back out by the host-isolation gate.
  let tenant: { id: string; name: string; slug: string } | null = null;
  if (host === PRIMARY_HOST) {
    const { data } = await admin.from("tenants").select("id, name, slug").eq("is_demo", true).maybeSingle();
    tenant = data ?? null;
  } else if (host !== "localhost" && host !== "127.0.0.1") {
    const { data } = await admin.from("tenants").select("id, name, slug").eq("custom_domain", host).maybeSingle();
    tenant = data ?? null;
  }

  try {
    const link = await buildRecoveryLink(email, origin);
    if (!link) return OK;

    // A reset link is only sent to someone who can actually use this
    // workspace. Without this, a real user of tenant A could be sent a
    // working link into tenant B's host, where they'd reset their password
    // and then be denied at the door -- confusing, and it tells an outsider
    // that the address exists.
    if (tenant && !(await hasActiveMembership(email, tenant.id))) return OK;

    await sendResetEmail({ email, link, tenant, origin });
  } catch (e) {
    console.error("[auth/request-reset] failed", e);
  }

  return OK;
}

async function buildRecoveryLink(email: string, origin: string): Promise<string | null> {
  const { data, error } = await createAdminSupabase().auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${origin}/auth/callback` },
  });
  // No such user is the common case, and is deliberately indistinguishable
  // from success to the caller.
  if (error || !data?.properties?.hashed_token) return null;
  return `${origin}/auth/callback?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
}

async function hasActiveMembership(email: string, tenantId: string): Promise<boolean> {
  const admin = createAdminSupabase();
  let page = 1;
  let userId: string | null = null;
  while (page <= 3 && !userId) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) break;
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (data.users.length < 1000) break;
    page++;
  }
  if (!userId) return false;

  const { data: platformAdmin } = await admin
    .from("platform_admins").select("id").eq("user_id", userId).maybeSingle();
  if (platformAdmin) return true;

  const { data: membership } = await admin
    .from("tenant_users")
    .select("role, is_locked, valid_from, valid_to")
    .eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
  return !!membership && isMembershipActive(membership);
}

async function sendResetEmail(params: {
  email: string;
  link: string;
  tenant: { id: string; name: string; slug: string } | null;
  origin: string;
}) {
  const { email, link, tenant, origin } = params;
  if (!process.env.RESEND_API_KEY) {
    console.error("[auth/request-reset] RESEND_API_KEY is not set — no reset email can be sent");
    return;
  }

  const workspace = tenant?.name || "BPMSquare";
  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = (tenant?.slug || "no-reply").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const subject = `Reset your ${workspace} password`;

  const text = [
    `Someone asked to reset the password for this address on ${workspace}.`,
    "",
    "Open this link to choose a new password:",
    link,
    "",
    "The link is valid for one use and expires shortly. If you didn't ask for this, you can ignore this email — nothing has changed.",
  ].join("\n");

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#1f2937">
  <p>Someone asked to reset the password for this address on <b>${escapeHtml(workspace)}</b>.</p>
  <p><a href="${escapeHtml(link)}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#1f6feb;color:#fff;text-decoration:none;font-weight:600">Choose a new password</a></p>
  <p style="font-size:13px;color:#6b7280">Or paste this into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
  <p style="font-size:13px;color:#6b7280">The link is valid for one use and expires shortly. If you didn't ask for this, you can ignore this email — nothing has changed.</p>
  <p style="font-size:12px;color:#9ca3af">${escapeHtml(origin)}</p>
</div>`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: `${workspace} <${fromLocalPart}@${sendingDomain}>`,
    to: email,
    subject,
    text,
    html,
  });
  if (result.error) console.error("[auth/request-reset] send failed", result.error);

  // Best-effort: the admin client is used because there is no session here,
  // and tenant_id is the host's tenant, never anything client-supplied.
  // Fails harmlessly until migration 0091 widens email_log.kind.
  if (tenant) {
    await logEmail(createAdminSupabase(), {
      tenantId: tenant.id,
      kind: "auth",
      toEmail: email,
      subject,
      status: result.error ? "failed" : "sent",
      error: result.error?.message,
    });
  }
}
