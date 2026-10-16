import { Inter } from "next/font/google";

// The product's base face. Self-hosted by next/font at build time, so no
// request to Google at runtime. Weights match the type scale in globals.css:
// 400 body, 500 labels, 600 subheadings, 700 headings.
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});
