import "server-only";
import { Resend } from "resend";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutput";
import type { StudioCtx } from "./server";
import type { StudySummary } from "./summary";
import type { StudyRow } from "./types";

// The "Talk to us" email (doc section 2 step 6): to the BPMSquare team, at an
// address the owner configures (platform setting, then PROCESS_STUDIO_NOTIFY_EMAIL;
// nothing is hard-coded). It goes through resolveOutbound() like every business
// email, so a demo workspace is redirected to the sandbox inbox and can never
// reach anyone else. The request is in the /admin/studies queue either way: a
// failed or skipped email never loses the request.

export type EmailOutcome = { status: "not_sent" | "sent" | "redirected" | "failed"; note: string | null };

const esc = (s: unknown): string => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendStudyRequestEmail(
  ctx: StudioCtx,
  a: { study: StudyRow; version: number; contactName: string; contactEmail: string; summary: StudySummary; notifyTo: string | null; adminUrl: string },
): Promise<EmailOutcome> {
  if (!a.notifyTo) return { status: "not_sent", note: "No Talk to us address is set yet. The request is in the BPMSquare queue." };
  if (!process.env.RESEND_API_KEY) return { status: "not_sent", note: "Email sending isn't configured (missing RESEND_API_KEY). The request is in the BPMSquare queue." };

  const s = a.summary;
  const subject = `Process study ${a.study.ref ?? ""} from ${ctx.tenantName || "a workspace"}: ${a.study.name} (version ${a.version})`.replace(/\s+/g, " ");
  const text = [
    `${a.contactName} <${a.contactEmail}> sent a Process Design Studio study to BPMSquare.`,
    "",
    `Study: ${a.study.name} (${a.study.ref ?? "no ref"}), version ${a.version}`,
    `Workspace: ${ctx.tenantName}${ctx.isDemo ? " (demo)" : ""}`,
    `${s.steps} steps mapped, ${s.standardOrSetup} standard or setup, ${s.needChange} need a change, ${s.changesKept} changes kept, plan ${s.planDays} working days.`,
    a.study.summary ? `\n${a.study.summary}` : "",
    "",
    `Review it: ${a.adminUrl}`,
  ].join("\n");
  const html = `<div style="font:14px/1.5 sans-serif"><p><b>${esc(a.contactName)}</b> &lt;${esc(a.contactEmail)}&gt; sent a Process Design Studio study to BPMSquare.</p>
    <p><b>${esc(a.study.name)}</b> (${esc(a.study.ref ?? "no ref")}), version ${a.version}<br>Workspace: ${esc(ctx.tenantName)}${ctx.isDemo ? " (demo)" : ""}</p>
    <p>${s.steps} steps mapped, ${s.standardOrSetup} standard or setup, ${s.needChange} need a change, ${s.changesKept} changes kept, plan ${s.planDays} working days.</p>
    ${a.study.summary ? `<p>${esc(a.study.summary)}</p>` : ""}<p><a href="${esc(a.adminUrl)}">Review the study</a></p></div>`;

  const routed = resolveOutbound(emailOutputFor({ is_demo: ctx.isDemo, config: ctx.config }), { to: [a.notifyTo], subject, text, html });
  if (!routed.ok) return { status: "failed", note: routed.error };
  const mail = routed.email;

  try {
    const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: `BPMSquare Process Design Studio <studio@${sendingDomain}>`,
      to: mail.to,
      replyTo: a.contactEmail,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if (result.error) return { status: "failed", note: result.error.message };
    return { status: mail.redirected ? "redirected" : "sent", note: mail.redirected ? "Redirected to the workspace's email-output inbox." : null };
  } catch (e) {
    console.error("process studio request email failed:", e);
    return { status: "failed", note: "The email could not be sent. The request is in the BPMSquare queue." };
  }
}
