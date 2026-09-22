import { Archivo, IBM_Plex_Sans } from "next/font/google";

/**
 * Spectacular's type system (owner request 2026-09-22: "the font doesn't look
 * good, look for the best enterprise grade font").
 *
 * The app's base is the system stack, which on Windows resolves to Segoe UI —
 * competent, and the reason every screen read as generic. These two are the
 * pairing from the design board the owner approved (the "Inside the shell"
 * proposal, 2026-09-21), so the theme now matches the drawing rather than
 * approximating it:
 *
 *   IBM Plex Sans — body. Commissioned as IBM's corporate typeface for
 *     exactly this job: dense business UI, long labels, numbers in tables. It
 *     has real tabular figures, which a stat strip and a money column need,
 *     and it is not one of the three faces that make software look
 *     machine-generated (Inter, Roboto, Arial).
 *   Archivo — display, for headings and the greeting. A grotesque with
 *     tighter apertures than the body face, so a heading reads as a heading
 *     at the same weight instead of relying on size alone.
 *
 * Scoped to the Spectacular variants in globals.css, exactly as novaFonts is
 * scoped to [data-nova="true"]. Every other theme keeps the system stack, so
 * no client's screens change and nobody else pays the download.
 *
 * next/font self-hosts both at build time — no request to Google at runtime,
 * no layout shift from a late webfont, and nothing for a CSP to allow.
 */
export const specDisplay = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-spec-display",
  display: "swap",
});

export const specBody = IBM_Plex_Sans({
  subsets: ["latin"],
  // 550/650 are not real Plex weights; the app asks for them in places
  // (fontWeight: 650 in the nav, 550 on chips) and a browser rounds to the
  // nearest available, so 600 and 700 both have to be here or those land on
  // 400 and look unstyled.
  weight: ["400", "500", "600", "700"],
  variable: "--font-spec-body",
  display: "swap",
});
