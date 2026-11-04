import localFont from "next/font/local";

// The product's base face, served from the repo (Inter, latin, variable, SIL OFL)
// so a build never depends on Google answering. The google loader failed builds
// intermittently when Google changed how it answers the Inter stylesheet.
// Weights match the type scale in globals.css: 400 body, 500 labels,
// 600 subheadings, 700 headings.
export const inter = localFont({
  src: [{ path: "./fonts/inter-latin-variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
});
