import { dashLook } from "@/lib/theme";

// The "Control room" dashboard look as a stylesheet. It darkens the shell behind the content panel, the panel itself and every neutral token
// inside it, but only while the dashboard that asked for it is on the page: the style element and the marker element are rendered by
// DashLookScope and leave the page with it, so no other screen can inherit any of this.
//
// Two selectors for the same rules, in separate blocks so a browser without :has() still applies the second:
//   - `:has([data-dash-look="control"])` works in the server-rendered HTML, so the first paint is already dark (no white flash);
//   - `[data-dash-look="control"]` on the shell is set by DashLookScope's effect, for browsers that lack :has().
// `[data-theme]` is repeated so these win over the Spectacular theme's own rules for the sheet, the shell, the page header and the AI brief
// (longer selectors, some `!important`) without a stylesheet-order dependency.

export const DASH_LOOK_ATTR = "data-dash-look";
const ROOT = "[data-theme][data-theme][data-theme]";
const SELECTORS = [`${ROOT}:has([${DASH_LOOK_ATTR}="control"])`, `${ROOT}[${DASH_LOOK_ATTR}="control"]`] as const;

type Vars = typeof dashLook.vars;
const decl = (keys: readonly (keyof Vars)[]) => keys.map((k) => `${k}:${dashLook.vars[k]};`).join("");

export function dashLookCss(): string {
  const vars = Object.entries(dashLook.vars).map(([k, v]) => `${k}:${v};`).join("");
  const header = decl(["--ink", "--muted", "--hint", "--line", "--page-head-cta"]);
  return SELECTORS.map((scope) => [
    `${scope}{--app-bg:${dashLook.shell} !important;color-scheme:dark;}`,
    `${scope} .bpm-main{${vars}color-scheme:dark;background-image:none !important;}`,
    `${scope}[data-spectacular="true"] .bpm-main{background:${dashLook.sheet} !important;}`,
    `${scope} .bpm-main .nextgen-brief{background:var(--card-bg) !important;border-color:var(--line) !important;box-shadow:none !important;}`,
    // The Spectacular themes restate the page header's ink on the header itself (white on a band, or dark on the white sheet) and force its
    // unpainted links to their accent with !important; on the dark page both have to follow the dark neutrals.
    `${scope} .bpm-main .bpm-page-header{${header}color:var(--ink);}`,
    `${scope} .bpm-main .bpm-page-header a:not([style*="background"]),${scope} .bpm-main .bpm-page-header button:not([style*="background"]),${scope} .bpm-main .bpm-page-header button[style*="background: transparent"]{color:var(--page-head-cta) !important;}`,
    `${scope} .bpm-main .bpm-page-header button[style*="background: transparent"]{border-color:var(--line) !important;}`,
  ].join("\n")).join("\n");
}
