import { escapeHtml as esc } from "@/lib/emailTemplates";
import { readableOn, type ResolvedBrandKit } from "./brandKit";
import { isTenantAssetPath, safeUrl, isHexColor } from "./sanitize";
import { fillTokens, SAMPLE_MERGE, type TokenValues } from "./tokens";
import { FONT_PAIRINGS, type BlockType, type LanguageRow, type NewsletterBlock } from "./types";

// THE ONLY PLACE HTML IS MADE (docs/newsletter-studio-architecture.md section 4).
// Pure: no I/O, so the same function renders the studio preview, the stored
// version and the campaign send. Nothing a person types is ever markup:
//   - every text is HTML-escaped here, whatever the stored string contains;
//   - urls go through safeUrl() again (https, http, mailto, tel only);
//   - colours must be strict #rrggbb;
//   - images must be a path under <tenantId>/assets/ and are resolved against
//     the storage base here, so an external or cross-tenant image cannot appear;
//   - the block type is a closed union, anything else renders nothing.
// Layout is tables with inline CSS (Outlook's engine ignores most else), `dir`
// is repeated on every cell that holds text (Outlook ignores the root), and
// under RTL a multi-cell row is emitted in MIRRORED order in the markup itself,
// not by CSS. Fonts are email-safe stacks: no web-font @import, Gmail drops it.

export type RenderTarget = "preview" | "version";

export type RenderInput = {
  blocks: readonly NewsletterBlock[];
  language: Pick<LanguageRow, "lang" | "dir" | "subject" | "preheader" | "texts">;
  kit: ResolvedBrandKit;
  tenantId: string;
  /** Public base of the company-assets bucket, no trailing slash. */
  assetBase: string;
  /**
   * "version": tracked links are written as {{click_N}} and the link/merge
   * tokens stay in place, ready for the send. "preview": tokens are filled with
   * sample values and links point at their real address.
   */
  target: RenderTarget;
  /** Adds the open-tracking pixel ({{open_pixel_url}}). Off unless the workspace turned opens on. */
  openPixel?: boolean;
  /** Preview only: values for the merge fields. */
  sample?: TokenValues;
};

export type RenderedLink = {
  url: string;
  label: string;
  block_id: string;
  block_type: BlockType;
  topic_id?: string;
  product_id?: string;
};

export type RenderOutput = { html: string; text: string; links: RenderedLink[] };

const WIDTH = 600;
const MUTED = "#5f6b7a";
const SOFT = "#f6f8fb";
const RULE = "#e2e7ee";
const NUM_RUN = /\+?\d(?:[\d.,:/()-]|\s(?=[\d(]))*\d/g;

export const DEFAULT_FOOTER_LABELS = { unsub: "Unsubscribe", prefs: "Manage preferences" } as const;

type Dir = "ltr" | "rtl";

type Ctx = {
  dir: Dir;
  rtl: boolean;
  start: "left" | "right";
  end: "left" | "right";
  kit: ResolvedBrandKit;
  tenantId: string;
  assetBase: string;
  target: RenderTarget;
  /** One slot per link a design CAN carry, in block order, independent of the words: the same index in every language. */
  links: RenderedLink[];
  slots: Map<string, number>;
};

function inline(s: string, rtl: boolean): string {
  if (!rtl) return esc(s).replace(/\n/g, "<br>");
  let out = "";
  let last = 0;
  for (const m of s.matchAll(NUM_RUN)) {
    const at = m.index ?? 0;
    out += esc(s.slice(last, at));
    out += `<span dir="ltr" style="unicode-bidi:isolate">${esc(m[0])}</span>`;
    last = at + m[0].length;
  }
  out += esc(s.slice(last));
  return out.replace(/\n/g, "<br>");
}

function paragraphs(text: string, c: Ctx, size = 15): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px 0;font-size:${size}px;line-height:1.55;">${inline(p, c.rtl)}</p>`)
    .join("");
}

function assetUrl(c: Ctx, path: unknown): string | null {
  return isTenantAssetPath(path, c.tenantId) ? `${c.assetBase}/${path}` : null;
}

/**
 * Link slots are fixed by the blocks and the brand kit, never by the words, so
 * a link has the same index in every language of a version -- the click link
 * carries that index. A slot whose block renders nothing in some language is
 * simply unused there.
 */
function buildSlots(blocks: readonly NewsletterBlock[], kit: ResolvedBrandKit): { links: RenderedLink[]; slots: Map<string, number> } {
  const links: RenderedLink[] = [];
  const slots = new Map<string, number>();
  const add = (key: string, raw: unknown, meta: Omit<RenderedLink, "url">) => {
    const url = safeUrl(raw);
    if (!url) return;
    slots.set(key, links.length);
    links.push({ url, ...meta });
  };
  for (const b of blocks) {
    if (!b.visible) continue;
    const topic = b.topic_id ? { topic_id: b.topic_id } : {};
    if (b.type === "image") add(`${b.id}:0`, b.settings.link, { label: "Image", block_id: b.id, block_type: "image", ...topic });
    else if (b.type === "button") add(`${b.id}:0`, b.settings.url, { label: "Button", block_id: b.id, block_type: "button", ...topic });
    else if (b.type === "event") add(`${b.id}:0`, b.settings.url, { label: "Event", block_id: b.id, block_type: "event", ...topic });
    else if (b.type === "product") {
      const productId = typeof b.settings.product_id === "string" ? b.settings.product_id : undefined;
      add(`${b.id}:0`, b.settings.url, { label: "Product", block_id: b.id, block_type: "product", ...(productId ? { product_id: productId } : {}), ...topic });
    } else if (b.type === "social") kit.socialLinks.forEach((sl, n) => add(`${b.id}:${n}`, sl.url, { label: sl.label, block_id: b.id, block_type: "social", ...topic }));
  }
  return { links, slots };
}

/** The href to write for a slot: a token in a version, the real address in a preview. Null when the block has no valid link. */
function track(c: Ctx, blockId: string, n: number, label: string): string | null {
  const index = c.slots.get(`${blockId}:${n}`);
  if (index === undefined) return null;
  if (label) c.links[index].label = label;
  return c.target === "version" ? `{{click_${index}}}` : c.links[index].url;
}

function row(c: Ctx, inner: string, opts: { pad?: string; bg?: string; cls?: string; align?: string; extra?: string } = {}): string {
  const bg = opts.bg ? `background-color:${opts.bg};` : "";
  const bgAttr = opts.bg ? ` bgcolor="${opts.bg}"` : "";
  return `<tr><td class="nl-px ${opts.cls ?? ""}" dir="${c.dir}"${bgAttr} style="${bg}padding:${opts.pad ?? "18px 26px"};text-align:${opts.align ?? c.start};${opts.extra ?? ""}">${inner}</td></tr>`;
}

function button(c: Ctx, href: string | null, label: string, bg: string, align: "left" | "center" | "right"): string {
  const fg = readableOn(bg);
  const inner = href
    ? `<a href="${esc(href)}" style="display:inline-block;padding:12px 24px;border-radius:8px;background-color:${bg};color:${fg};font-size:14px;font-weight:bold;text-decoration:none;">${inline(label, c.rtl)}</a>`
    : `<span style="display:inline-block;padding:12px 24px;border-radius:8px;background-color:${bg};color:${fg};font-size:14px;font-weight:bold;">${inline(label, c.rtl)}</span>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:0 auto;"><tr><td align="center" dir="${c.dir}" bgcolor="${bg}" style="border-radius:8px;">${inner}</td></tr></table>`;
}

/** A row of cells, laid out left to right. Under RTL the cells are emitted in reverse so the first one sits at the right edge. */
function cells(c: Ctx, parts: string[]): string {
  const ordered = c.rtl ? [...parts].reverse() : parts;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="ltr"><tr>${ordered.join("")}</tr></table>`;
}

type Piece = { html: string; text: string };
const none: Piece = { html: "", text: "" };

function words(texts: LanguageRow["texts"], id: string): Record<string, string> {
  return texts[id] ?? {};
}

function renderBlock(b: NewsletterBlock, t: Record<string, string>, c: Ctx, previewing: boolean): Piece {
  const kit = c.kit;
  switch (b.type) {
    case "header": {
      const fg = readableOn(kit.primary);
      const logo = kit.logoUrl
        ? `<img src="${esc(kit.logoUrl)}" alt="${esc(kit.companyName)}" height="32" style="display:block;border:0;height:32px;width:auto;">`
        : `<span style="font-size:16px;font-weight:bold;color:${fg};">${esc(kit.companyName)}</span>`;
      const left = `<td dir="${c.dir}" align="${c.start}" valign="middle" style="text-align:${c.start};">${logo}</td>`;
      const right = `<td dir="${c.dir}" align="${c.end}" valign="middle" style="text-align:${c.end};font-size:12px;color:${fg};">${t.tag ? inline(t.tag, c.rtl) : ""}</td>`;
      return {
        html: `<tr><td class="nl-head" dir="${c.dir}" bgcolor="${kit.primary}" style="background-color:${kit.primary};padding:14px 26px;">${cells(c, [left, right])}</td></tr>`,
        text: `${kit.companyName}${t.tag ? ` | ${t.tag}` : ""}`,
      };
    }
    case "hero": {
      if (!t.title && !t.text) return none;
      const bg = isHexColor(b.settings.background) ? (b.settings.background as string) : kit.primary;
      const fg = readableOn(bg);
      const inner = `${t.title ? `<div style="font-size:26px;line-height:1.2;font-weight:bold;margin:0 0 6px 0;color:${fg};">${inline(t.title, c.rtl)}</div>` : ""}${t.text ? `<div style="font-size:15px;line-height:1.5;color:${fg};">${inline(t.text, c.rtl)}</div>` : ""}`;
      return { html: row(c, inner, { pad: "30px 26px", bg, cls: "nl-hero" }), text: [t.title, t.text].filter(Boolean).join("\n") };
    }
    case "text": {
      if (!t.text) return none;
      const align = b.settings.align === "center" ? "center" : b.settings.align === "right" ? "right" : b.settings.align === "left" ? "left" : c.start;
      return { html: row(c, paragraphs(t.text, c), { align }), text: t.text };
    }
    case "image": {
      const src = assetUrl(c, b.settings.path);
      if (!src && !previewing) return none;
      const alt = t.alt ?? "";
      const img = src
        ? `<img src="${esc(src)}" alt="${esc(alt)}" width="${WIDTH - 52}" style="display:block;width:100%;max-width:${WIDTH - 52}px;height:auto;border:0;border-radius:8px;">`
        : `<div style="height:140px;border-radius:8px;background-color:${SOFT};color:${MUTED};font-size:13px;text-align:center;line-height:140px;">${esc(alt || "Choose a picture")}</div>`;
      const href = track(c, b.id, 0, alt || "Image");
      return { html: row(c, href ? `<a href="${esc(href)}" style="text-decoration:none;">${img}</a>` : img), text: alt ? `[${alt}]` : "" };
    }
    case "button": {
      if (!t.label) return none;
      const href = track(c, b.id, 0, t.label);
      const align = b.settings.align === "left" ? "left" : b.settings.align === "right" ? "right" : "center";
      return { html: row(c, button(c, href, t.label, kit.secondary, align), { align: "center" }), text: href ? `${t.label}: ${href}` : t.label };
    }
    case "columns": {
      if (!t.t1 && !t.t2 && !t.p1 && !t.p2) return none;
      const col = (title: string, body: string) =>
        `<td class="nl-col" width="50%" valign="top" dir="${c.dir}" style="width:50%;padding:0 7px;text-align:${c.start};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="nl-soft" dir="${c.dir}" bgcolor="${SOFT}" style="background-color:${SOFT};border-radius:10px;padding:14px;text-align:${c.start};">${title ? `<div style="font-size:15px;font-weight:bold;margin:0 0 4px 0;">${inline(title, c.rtl)}</div>` : ""}${body ? `<div style="font-size:14px;line-height:1.5;">${inline(body, c.rtl)}</div>` : ""}</td></tr></table></td>`;
      return { html: row(c, cells(c, [col(t.t1 ?? "", t.p1 ?? ""), col(t.t2 ?? "", t.p2 ?? "")]), { pad: "10px 19px" }), text: [t.t1, t.p1, t.t2, t.p2].filter(Boolean).join("\n") };
    }
    case "product": {
      if (!t.name) return none;
      const src = assetUrl(c, b.settings.path);
      const href = track(c, b.id, 0, t.name);
      const name = href ? `<a href="${esc(href)}" style="color:inherit;text-decoration:none;">${inline(t.name, c.rtl)}</a>` : inline(t.name, c.rtl);
      const img = src ? `<td width="96" valign="middle" style="width:96px;padding:12px;"><img src="${esc(src)}" alt="${esc(t.name)}" width="84" height="84" style="display:block;width:84px;height:84px;border:0;border-radius:8px;"></td>` : "";
      const body = `<td valign="middle" dir="${c.dir}" style="padding:12px;text-align:${c.start};"><div style="font-size:15px;font-weight:bold;">${name}</div>${t.from ? `<div style="font-size:12.5px;color:${MUTED};">${inline(t.from, c.rtl)}</div>` : ""}${t.text ? `<div style="font-size:14px;line-height:1.5;margin-top:2px;">${inline(t.text, c.rtl)}</div>` : ""}${t.price ? `<div dir="ltr" style="font-weight:bold;color:${kit.secondary};margin-top:4px;text-align:${c.start};unicode-bidi:isolate;">${esc(t.price)}</div>` : ""}</td>`;
      const box = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${RULE};border-radius:10px;" class="nl-card">${`<tr><td>${cells(c, src ? [img, body] : [body])}</td></tr>`}</table>`;
      return { html: row(c, box), text: [t.name, t.from, t.text, t.price, href].filter(Boolean).join("\n") };
    }
    case "event": {
      if (!t.title && !t.text) return none;
      const href = track(c, b.id, 0, t.title || "Event");
      const title = t.title ? `<div style="font-size:16px;font-weight:bold;margin:0 0 4px 0;">${href ? `<a href="${esc(href)}" style="color:inherit;text-decoration:none;">${inline(t.title, c.rtl)}</a>` : inline(t.title, c.rtl)}</div>` : "";
      const meta = [t.when, t.where].filter(Boolean).map((m) => `<div style="font-size:13px;color:${MUTED};">${inline(m, c.rtl)}</div>`).join("");
      return { html: row(c, `${title}${meta}${t.text ? `<div style="margin-top:6px;">${paragraphs(t.text, c, 14)}</div>` : ""}`), text: [t.title, t.when, t.where, t.text, href].filter(Boolean).join("\n") };
    }
    case "divider":
      return { html: `<tr><td style="padding:0 26px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="nl-rule" height="1" bgcolor="${RULE}" style="height:1px;line-height:1px;font-size:1px;background-color:${RULE};">&nbsp;</td></tr></table></td></tr>`, text: "----" };
    case "social": {
      if (kit.socialLinks.length === 0) return none;
      const items = kit.socialLinks.map((s, n) => {
        const href = track(c, b.id, n, s.label);
        return href ? `<a href="${esc(href)}" style="display:inline-block;margin:0 5px 6px 5px;padding:6px 12px;border:1px solid ${RULE};border-radius:999px;font-size:12px;color:inherit;text-decoration:none;">${esc(s.label)}</a>` : "";
      });
      return { html: row(c, items.join(""), { align: "center" }), text: kit.socialLinks.map((s) => `${s.label}: ${s.url}`).join("\n") };
    }
    case "interest": {
      if (!t.label) return none;
      return { html: row(c, button(c, "{{interest_url}}", t.label, kit.primary, "center"), { align: "center" }), text: `${t.label}: {{interest_url}}` };
    }
    case "footer": {
      const body = t.text || kit.footerAddress;
      const unsub = t.unsub || DEFAULT_FOOTER_LABELS.unsub;
      const prefs = t.prefs || DEFAULT_FOOTER_LABELS.prefs;
      const link = (token: string, label: string) => `<a href="{{${token}}}" style="color:inherit;text-decoration:underline;">${inline(label, c.rtl)}</a>`;
      const inner = `${body ? `<div style="margin:0 0 8px 0;">${inline(body, c.rtl)}</div>` : ""}<div>${link("unsubscribe_url", unsub)} &middot; ${link("preferences_url", prefs)}</div>`;
      return {
        html: row(c, inner, { pad: "18px 26px", bg: SOFT, cls: "nl-foot", align: "center", extra: "font-size:12px;line-height:1.5;color:#6b7684;" }),
        text: `${body ? `${body}\n` : ""}${unsub}: {{unsubscribe_url}}\n${prefs}: {{preferences_url}}`,
      };
    }
    default:
      return none;
  }
}

const DARK_CSS = `
@media (prefers-color-scheme: dark) {
  .nl-bg { background-color:#0f1115 !important; }
  .nl-card, .nl-body { background-color:#1e1f23 !important; color:#e6e6e6 !important; }
  .nl-soft, .nl-foot { background-color:#2a2d35 !important; color:#c9ced8 !important; }
  .nl-rule { background-color:#3a3d45 !important; }
}
@media only screen and (max-width: 620px) {
  .nl-px { padding-left:16px !important; padding-right:16px !important; }
  .nl-col { display:block !important; width:100% !important; padding:0 0 10px 0 !important; }
}`;

/** The email, from the design. Pure. */
export function renderNewsletter(input: RenderInput): RenderOutput {
  const { language, kit } = input;
  const dir: Dir = language.dir === "rtl" ? "rtl" : "ltr";
  const rtl = dir === "rtl";
  const c: Ctx = {
    dir, rtl, start: rtl ? "right" : "left", end: rtl ? "left" : "right",
    kit, tenantId: input.tenantId, assetBase: input.assetBase.replace(/\/+$/, ""), target: input.target,
    ...buildSlots(input.blocks, kit),
  };
  const pairing = FONT_PAIRINGS[kit.fontPairing] ?? FONT_PAIRINGS.arial;
  const font = rtl ? pairing.arabic : pairing.latin;
  const previewing = input.target === "preview";

  const pieces: Piece[] = [];
  for (const b of input.blocks) {
    if (!b.visible) continue;
    const piece = renderBlock(b, words(language.texts, b.id), c, previewing);
    // Preview only: lets the studio find a block's row to select it and pin "Check this" to it. Never in a version.
    pieces.push(previewing && piece.html ? { ...piece, html: piece.html.replace(/^<tr/, `<tr data-nl-block="${esc(b.id)}"`) } : piece);
  }

  const pre = language.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${esc(language.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>`
    : "";
  const pixel = input.openPixel ? `<tr><td style="font-size:0;line-height:0;"><img src="{{open_pixel_url}}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;"></td></tr>` : "";

  let html = `<!doctype html>
<html lang="${esc(language.lang)}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(language.subject)}</title>
<style>${DARK_CSS}</style>
</head>
<body class="nl-bg" dir="${dir}" style="margin:0;padding:0;background-color:#eef1f5;">
${pre}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nl-bg" style="background-color:#eef1f5;"><tr><td align="center" dir="${dir}" style="padding:16px 8px;">
<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" class="nl-body" style="width:100%;max-width:${WIDTH}px;background-color:#ffffff;color:${kit.text};font-family:${font};font-size:15px;line-height:1.55;text-align:${c.start};">
${pieces.map((p) => p.html).join("\n")}
${pixel}</table>
</td></tr></table>
</body>
</html>`;

  let text = pieces.map((p) => p.text).filter(Boolean).join("\n\n");

  if (previewing) {
    const values: TokenValues = {
      ...SAMPLE_MERGE,
      company_name: kit.companyName,
      ...(input.sample ?? {}),
      unsubscribe_url: "#", preferences_url: "#", interest_url: "#",
    };
    html = fillTokens(html, values, { html: true });
    text = fillTokens(text, values, { html: false });
  }

  return { html, text, links: c.links };
}
