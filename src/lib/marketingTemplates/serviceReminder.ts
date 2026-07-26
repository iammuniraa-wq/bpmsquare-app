import type { MarketingTemplateDef } from "./shared";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function wrapper(bannerBg: string, bannerFg: string, emoji: string, title: string, bodyContent: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;border-collapse:collapse;font-family:${FONT};">
  <tr>
    <td style="background:${bannerBg};padding:36px 32px;text-align:center;border-radius:12px 12px 0 0;">
      <div style="font-size:40px;line-height:1;margin-bottom:8px;">${emoji}</div>
      <div style="font-size:22px;font-weight:700;color:${bannerFg};letter-spacing:0.2px;">${title}</div>
    </td>
  </tr>
  <tr>
    <td style="background:#ffffff;padding:32px;border:1px solid #e2e7ee;border-top:none;">
      ${bodyContent}
    </td>
  </tr>
  <tr>
    <td style="background:#ffffff;padding:0 32px 28px;border:1px solid #e2e7ee;border-top:none;border-radius:0 0 12px 12px;">
      <div style="height:1px;background:#e2e7ee;margin-bottom:18px;"></div>
      <div style="font-size:13px;color:#5f6b7a;line-height:1.6;">
        Warm regards,<br><strong style="color:#1c2733;">{{company_name}}</strong>
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:18px 8px 0;text-align:center;">
      <div style="font-size:11px;color:#8a96a5;">You're receiving this because you're a valued customer of {{company_name}}.</div>
    </td>
  </tr>
</table>`;
}

/** Not a festival -- kept as the one always-relevant business/AMC nudge
 * template, in its own file since it doesn't fit the festival archetype set. */
export const SERVICE_REMINDER_TEMPLATES: MarketingTemplateDef[] = [
  {
    id: "service_reminder",
    category: "Service Reminder",
    variantName: "Teal Check-Up",
    emoji: "🔧",
    description: "A friendly, professional maintenance/AMC check-up nudge",
    defaultSubject: "A quick reminder from {{company_name}}",
    buildBodyHtml: (customMessageHtml) =>
      wrapper(
        "linear-gradient(135deg,#04342c 0%,#0f6b5c 60%,#1d9e75 100%)",
        "#e1f5ee",
        "🔧",
        "Time for a Check-Up?",
        `<div style="font-size:16px;color:#1c2733;font-weight:600;margin-bottom:14px;">Dear {{account_name}},</div>
      <div style="font-size:14px;color:#3a4552;line-height:1.7;margin-bottom:18px;">
        Regular maintenance keeps your equipment running reliably and avoids costly downtime. We wanted to check in and see if it's time to schedule your next service visit.
      </div>
      ${customMessageHtml ? `<div style="font-size:14px;color:#3a4552;line-height:1.7;margin-bottom:18px;padding:14px 16px;background:#eaf6f1;border-left:3px solid #1d9e75;border-radius:6px;">${customMessageHtml}</div>` : ""}
      <div style="font-size:14px;color:#3a4552;line-height:1.7;">
        Just reply to this email or reach out to our team, and we'll be happy to arrange a convenient time.
      </div>`
      ),
  },
];
