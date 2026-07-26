// Curated, code-defined starting designs for marketing campaigns -- trusted
// HTML (banners, colour, table layout) that a free-text rich editor could
// never safely produce or preserve. A rep picks one, types a plain-text
// custom message, and the server renders the final HTML from these
// definitions -- never from client-submitted HTML -- so there's no path for
// a spoofed request to inject arbitrary markup into an outbound email.
//
// {{account_name}} / {{company_name}} stay as literal tokens in the stored
// body -- the send route's existing per-recipient renderTemplate() call
// substitutes them at send time, same as every other campaign.

export type MarketingTemplateId = "diwali_greeting" | "new_year_wishes" | "service_reminder";

export type MarketingTemplateDef = {
  id: MarketingTemplateId;
  name: string;
  emoji: string;
  description: string;
  defaultSubject: string;
  /** customMessageHtml is pre-escaped, <br>-converted HTML -- never raw user input. */
  buildBodyHtml: (customMessageHtml: string) => string;
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function wrapper(bannerBg: string, bannerFg: string, emoji: string, title: string, bodyContent: string, accentColor: string): string {
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

export const MARKETING_TEMPLATES: MarketingTemplateDef[] = [
  {
    id: "diwali_greeting",
    name: "Diwali Greeting",
    emoji: "🪔",
    description: "Warm festive wishes with a deep maroon & gold banner",
    defaultSubject: "Happy Diwali from {{company_name}}! 🪔",
    buildBodyHtml: (customMessageHtml) => wrapper(
      "linear-gradient(135deg,#7a1f2b 0%,#a3342f 60%,#c9622a 100%)",
      "#fdeecb",
      "🪔",
      "Happy Diwali",
      `<div style="font-size:16px;color:#1c2733;font-weight:600;margin-bottom:14px;">Dear {{account_name}},</div>
      <div style="font-size:14px;color:#3a4552;line-height:1.7;margin-bottom:18px;">
        As the diyas light up and the festival of lights fills the air with joy, we wanted to take a moment to wish you and your team a very Happy Diwali.
      </div>
      ${customMessageHtml ? `<div style="font-size:14px;color:#3a4552;line-height:1.7;margin-bottom:18px;padding:14px 16px;background:#fdf6ec;border-left:3px solid #c9622a;border-radius:6px;">${customMessageHtml}</div>` : ""}
      <div style="font-size:14px;color:#3a4552;line-height:1.7;">
        May this festive season bring you prosperity, good health, and success in everything you do. Thank you for being a valued part of our journey.
      </div>`,
      "#c9622a"
    ),
  },
  {
    id: "new_year_wishes",
    name: "New Year Wishes",
    emoji: "🎆",
    description: "Forward-looking message with a deep navy & gold banner",
    defaultSubject: "Wishing you a wonderful year ahead — from {{company_name}} 🎆",
    buildBodyHtml: (customMessageHtml) => wrapper(
      "linear-gradient(135deg,#0e1a28 0%,#152233 60%,#1d3352 100%)",
      "#f6b23c",
      "🎆",
      "Happy New Year",
      `<div style="font-size:16px;color:#1c2733;font-weight:600;margin-bottom:14px;">Dear {{account_name}},</div>
      <div style="font-size:14px;color:#3a4552;line-height:1.7;margin-bottom:18px;">
        As we step into a new year, we wanted to pause and thank you for your continued trust and partnership over the past year.
      </div>
      ${customMessageHtml ? `<div style="font-size:14px;color:#3a4552;line-height:1.7;margin-bottom:18px;padding:14px 16px;background:#f4f6f9;border-left:3px solid #378add;border-radius:6px;">${customMessageHtml}</div>` : ""}
      <div style="font-size:14px;color:#3a4552;line-height:1.7;">
        Wishing you and your team a year ahead filled with growth, good health, and continued success. We look forward to serving you again.
      </div>`,
      "#378add"
    ),
  },
  {
    id: "service_reminder",
    name: "Service Reminder",
    emoji: "🔧",
    description: "A friendly, professional maintenance/AMC check-up nudge",
    defaultSubject: "A quick reminder from {{company_name}}",
    buildBodyHtml: (customMessageHtml) => wrapper(
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
      </div>`,
      "#1d9e75"
    ),
  },
];

export function getMarketingTemplate(id: string | null | undefined): MarketingTemplateDef | null {
  return MARKETING_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** The custom-message textarea is always plain text -- always escape it (no
 * "might already be HTML" branch, unlike lib/richText.ts's legacy-data case). */
export function escapeCustomMessage(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
