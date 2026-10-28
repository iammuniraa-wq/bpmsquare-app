import type { CSSProperties } from "react";
import { tenderDesk as td } from "@/lib/theme";
import type { TenderDeskStyle } from "@/lib/tenderDesk/types";

// The colours the tender blocks draw with, as custom properties on each block's root (so no component and no stylesheet holds a colour
// literal). The two dashboard looks differ in only a few of them: the Bold look is the app's own light surface, the Control room look is the
// dark surface from src/components/tenderDesk/dashLook.ts, and the neutrals (ink, muted, line, card) follow that surface by themselves.

const bold = td.bold;
const ctl = td.control;

export function lookVars(look: TenderDeskStyle): CSSProperties {
  const control = look === "control";
  return {
    "--td-tile-ink": td.tile.ink,
    "--td-tile-ink-soft": td.tile.inkSoft,
    "--td-tile-glow": td.tile.glow,
    "--td-tile-shadow": td.tile.shadow,
    "--td-g1": td.tile.pipeline,
    "--td-g2": td.tile.weighted,
    "--td-g3": td.tile.closing,
    "--td-g4": td.tile.win,
    "--td-g5": td.tile.buyout,
    "--td-chip-red": td.chip.red,
    "--td-chip-amber": td.chip.amber,
    "--td-chip-green": td.chip.green,
    "--td-chip-slate": td.chip.slate,
    "--td-chip-ink": td.chip.ink,
    "--td-won": td.won,
    "--td-lost": td.lost,
    "--td-under": bold.under,
    "--td-over": bold.over,
    "--td-buyout-fill": bold.buyoutFill,
    // Look-dependent.
    "--td-dot-red": control ? ctl.rose : td.chip.red,
    "--td-dot-amber": control ? ctl.amber : td.chip.amber,
    "--td-dot-green": control ? ctl.teal : td.chip.green,
    "--td-dot-ring": control ? ctl.base : "var(--card-bg)",
    "--td-trend": control ? ctl.violetSoft : bold.clients[0],
    "--td-trend-fill": control ? ctl.violet : bold.clients[0],
    "--td-btn": control ? ctl.violetSoft : bold.clients[0],
    "--td-btn-ink": control ? ctl.buttonInk : td.tile.ink,
    "--td-sev-high": control ? ctl.rose : td.chip.red,
    "--td-sev-medium": control ? ctl.amber : td.chip.amber,
    "--td-sev-low": control ? ctl.violet : bold.clients[0],
  } as CSSProperties;
}

/** The five client colours of the donut and the "Others" slice. */
export function clientPalette(look: TenderDeskStyle): { colours: readonly string[]; others: string } {
  return look === "control"
    ? { colours: [ctl.violet, ctl.teal, ctl.amber, ctl.rose, ctl.blue], others: ctl.others }
    : { colours: bold.clients, others: bold.others };
}
