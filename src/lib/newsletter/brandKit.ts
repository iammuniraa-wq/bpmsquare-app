import type { BrandKit } from "@/lib/constants";
import { isHexColor, safeUrl, cleanText } from "./sanitize";
import { DEFAULT_FONT_PAIRING, FONT_PAIRINGS } from "./types";

// The brand kit (docs/newsletter-studio-architecture.md 2.2): logo, three
// colours, one email-safe font pairing, footer address, social links. Stored in
// tenants.config.brand_kit; this file only validates and fills in defaults.

export type ResolvedBrandKit = {
  companyName: string;
  /** Public https URL, or null (the header then shows the company name only). */
  logoUrl: string | null;
  primary: string;
  secondary: string;
  text: string;
  fontPairing: string;
  footerAddress: string;
  socialLinks: { label: string; url: string }[];
  tone: "formal" | "warm";
};

// Email output colours (an email cannot read the app's CSS variables).
export const DEFAULT_KIT_COLOURS = { primary: "#16365c", secondary: "#c8892a", text: "#1c2733" } as const;

export function sanitizeBrandKit(input: unknown): BrandKit {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: BrandKit = {};
  const logo = typeof o.logo_url === "string" ? safeUrl(o.logo_url) : null;
  if (logo && logo.startsWith("https://")) out.logo_url = logo;
  if (isHexColor(o.primary)) out.primary = o.primary;
  if (isHexColor(o.secondary)) out.secondary = o.secondary;
  if (isHexColor(o.text)) out.text = o.text;
  if (typeof o.font_pairing === "string" && o.font_pairing in FONT_PAIRINGS) out.font_pairing = o.font_pairing;
  const addr = cleanText(o.footer_address, 400);
  if (addr) out.footer_address = addr;
  if (Array.isArray(o.social_links)) {
    const links = o.social_links.flatMap((s) => {
      const r = (s ?? {}) as Record<string, unknown>;
      const url = safeUrl(r.url);
      const label = cleanText(r.label, 20);
      return url && label && (url.startsWith("https://") || url.startsWith("http://")) ? [{ label, url }] : [];
    });
    if (links.length) out.social_links = links.slice(0, 6);
  }
  if (o.tone === "warm" || o.tone === "formal") out.tone = o.tone;
  return out;
}

export function resolveBrandKit(kit: BrandKit | null | undefined, tenant: { name: string; logo_url?: string | null }): ResolvedBrandKit {
  const k = sanitizeBrandKit(kit ?? {});
  const tenantLogo = tenant.logo_url ? safeUrl(tenant.logo_url) : null;
  return {
    companyName: tenant.name,
    logoUrl: k.logo_url ?? (tenantLogo && tenantLogo.startsWith("https://") ? tenantLogo : null),
    primary: k.primary ?? DEFAULT_KIT_COLOURS.primary,
    secondary: k.secondary ?? DEFAULT_KIT_COLOURS.secondary,
    text: k.text ?? DEFAULT_KIT_COLOURS.text,
    fontPairing: k.font_pairing ?? DEFAULT_FONT_PAIRING,
    footerAddress: k.footer_address ?? "",
    socialLinks: k.social_links ?? [],
    tone: k.tone ?? "formal",
  };
}

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#000000") ? "#ffffff" : "#000000";
}
