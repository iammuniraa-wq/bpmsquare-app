// Shared builder for every festival/occasion template -- one consistent,
// well-designed layout (banner + card + highlighted message + signature),
// parameterized by colour and copy so ~60 templates stay visually
// consistent and maintainable instead of being 60 one-off hand-built
// layouts of varying quality.
//
// {{account_name}} / {{company_name}} stay as literal tokens in the stored
// body -- the send route's per-recipient renderTemplate() call substitutes
// them at send time, same as every other campaign.

export type MarketingTemplateDef = {
  id: string;
  /** Folder grouping shown in the picker, e.g. "Diwali". */
  category: string;
  /** Variant name within the folder, e.g. "Classic Gold". */
  variantName: string;
  emoji: string;
  description: string;
  defaultSubject: string;
  /** The design's banner background (solid colour or gradient) -- shown as a
   * small colour preview strip in the picker so the folder view itself looks
   * like the design it represents instead of a flat, colourless list. */
  swatch: string;
  buildBodyHtml: (customMessageHtml: string) => string;
};

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

function greetingBody(opening: string, closing: string, customMessageHtml: string, accentColor: string, highlightBg: string): string {
  return `<div style="font-size:16px;color:#1c2733;font-weight:600;margin-bottom:14px;">Dear {{account_name}},</div>
      <div style="font-size:14px;color:#3a4552;line-height:1.7;margin-bottom:18px;">${opening}</div>
      ${customMessageHtml ? `<div style="font-size:14px;color:#3a4552;line-height:1.7;margin-bottom:18px;padding:14px 16px;background:${highlightBg};border-left:3px solid ${accentColor};border-radius:6px;">${customMessageHtml}</div>` : ""}
      <div style="font-size:14px;color:#3a4552;line-height:1.7;">${closing}</div>`;
}

/** One of five consistent visual archetypes, re-coloured per festival --
 * keeps 60 templates looking deliberate instead of randomly styled. */
export type StyleArchetype = {
  key: "classic" | "minimal" | "vibrant" | "elegant_dark" | "pastel";
  label: string;
  bannerBg: string;
  bannerFg: string;
  accentColor: string;
  highlightBg: string;
};

export function festivalTemplate(opts: {
  idPrefix: string;
  category: string;
  emoji: string;
  title: string;
  archetype: StyleArchetype;
  subject: string;
  opening: string;
  closing: string;
}): MarketingTemplateDef {
  const { idPrefix, category, emoji, title, archetype, subject, opening, closing } = opts;
  return {
    id: `${idPrefix}_${archetype.key}`,
    category,
    variantName: archetype.label,
    emoji,
    description: archetype.label,
    defaultSubject: subject,
    swatch: archetype.bannerBg,
    buildBodyHtml: (customMessageHtml) =>
      wrapper(archetype.bannerBg, archetype.bannerFg, emoji, title, greetingBody(opening, closing, customMessageHtml, archetype.accentColor, archetype.highlightBg)),
  };
}

/** Escapes the always-plain-text custom-message textarea before it's merged
 * into a template -- never treats it as pre-formatted HTML. */
export function escapeCustomMessage(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
