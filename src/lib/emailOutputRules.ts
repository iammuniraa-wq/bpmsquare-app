import type { TenantConfig, EmailOutputConfig, EmailOutputMode } from "@/lib/constants";

// Pure rules (no server deps) so they are unit-testable; the tenant read
// lives in emailOutput.ts.
//
// The one gate every outbound email passes through (owner requirement
// 2026-09-06, modelled on SAP C4C's Email and Fax Settings):
//
//   partners  -- send to the address on the account / contact / employee.
//   redirect  -- send everything to ONE internal inbox instead, with the
//                intended recipient named in the subject and body, so output
//                can still be verified end to end from a controlled mailbox.
//
// A demo workspace (tenants.is_demo) is redirect-only, always. That is not a
// default a tenant admin can flip back: the point is certainty that a test
// document never reaches a customer, and certainty cannot depend on a
// setting someone might change. With no redirect address set, a demo
// workspace sends nothing at all rather than falling through to partners.
//
// Every sender must route through resolveOutbound() -- quotes, standard
// quotes, invoices, marketing campaigns, WFM notifications. Excluded on
// purpose: password-reset mail (it goes to the requesting user's own login,
// never a business partner) and the SMTP connector's own test message (the
// admin types the address they want to test). Anything new that emails a
// business partner joins this list, not the exclusions.

export type EmailOutput = EmailOutputConfig & {
  /** True on a demo workspace: redirect is enforced, not configured. */
  forced: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailOutputFor(tenant: { is_demo?: boolean | null; config?: TenantConfig | null }): EmailOutput {
  const stored = tenant.config?.email_output;
  const redirect_to = typeof stored?.redirect_to === "string" ? stored.redirect_to.trim().toLowerCase() : "";
  const forced = tenant.is_demo === true;
  const mode: EmailOutputMode = forced ? "redirect" : stored?.mode === "redirect" ? "redirect" : "partners";
  return { mode, redirect_to, forced };
}

export type RoutedEmail = {
  /** Where the message actually goes. */
  to: string[];
  /** Where the document said it should go. Equal to `to` unless redirected. */
  intended: string[];
  redirected: boolean;
  subject: string;
  text: string;
  html?: string;
};

/**
 * Decide the real recipients and stamp a redirected message so the reviewer
 * can see who it was for. Returns an error instead of a message when a
 * redirect is required but no inbox is configured -- the caller must refuse
 * to send, never fall back to the partner address.
 */
export function resolveOutbound(
  output: EmailOutput,
  message: { to: string[]; subject: string; text: string; html?: string }
): { ok: true; email: RoutedEmail } | { ok: false; error: string } {
  const intended = [...new Set(message.to.map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (intended.length === 0) return { ok: false, error: "No recipient." };

  if (output.mode !== "redirect") {
    return { ok: true, email: { to: intended, intended, redirected: false, subject: message.subject, text: message.text, html: message.html } };
  }

  if (!EMAIL_RE.test(output.redirect_to)) {
    return {
      ok: false,
      error: output.forced
        ? "This is a demo workspace: outbound email is redirected to an internal inbox, and none is set yet. Add one under Settings → General → Email output."
        : "Email output is set to redirect, but no redirect address is set. Add one under Settings → General → Email output.",
    };
  }

  const who = intended.join(", ");
  const banner = `Redirected by the workspace's email output setting. Intended recipient${intended.length === 1 ? "" : "s"}: ${who}`;
  const html = message.html
    ? `<div style="padding:10px 12px;margin:0 0 16px;border:1px solid #f6b23c;background:#fff8e6;color:#5a4300;font:13px/1.5 sans-serif;">${escape(banner)}</div>${message.html}`
    : undefined;
  return {
    ok: true,
    email: {
      to: [output.redirect_to],
      intended,
      redirected: true,
      subject: `[Redirected · for ${who}] ${message.subject}`,
      text: `${banner}\n\n---\n\n${message.text}`,
      html,
    },
  };
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
