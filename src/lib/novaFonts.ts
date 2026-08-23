import { Space_Grotesk, DM_Sans } from "next/font/google";

// Nova's own type system (owner decision 2026-08-23, from the design canvas
// proposal at .../artifact/99e32596-ed92-473f-b026-2efa37d2f38a) — display
// face for headings/wordmarks, body face for everything else. Scoped to
// [data-nova="true"] only (globals.css); the rest of the app is untouched.
export const novaDisplay = Space_Grotesk({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-nova-display",
  display: "swap",
});

export const novaBody = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-nova-body",
  display: "swap",
});
