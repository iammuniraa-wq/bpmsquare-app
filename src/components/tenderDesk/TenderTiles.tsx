import Link from "next/link";
import InfoTip from "@/components/ui/InfoTip";
import type { TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { tenderLinks } from "@/lib/tenderDesk/links";
import { millions, percentOf, plural, tileMoney, winRateLabel } from "./format";
import { lookVars } from "./look";
import s from "./tenderBlocks.module.css";

export const TILE_KINDS = ["pipeline", "weighted", "closing", "win", "buyout"] as const;
export type TileKind = (typeof TILE_KINDS)[number];

export type TileFigures = {
  label: string;
  /** The explanation behind the "i", when the figure needs one. */
  info?: string;
  value: string;
  unit: string;
  note: string;
  /** Where the whole tile goes. */
  href: string;
  /** What a screen reader hears: the label with its figures. */
  aria: string;
  tone: "g1" | "g2" | "g3" | "g4" | "g5";
};

const BASE: Record<TileKind, Pick<TileFigures, "label" | "info" | "tone">> = {
  pipeline: { label: "Open pipeline", tone: "g1" },
  weighted: { label: "Weighted by chance", info: "Each open tender's value times its chance of winning, added up.", tone: "g2" },
  closing: { label: "Closing in 14 days", info: "Open tenders whose bid end date is today or within the next 14 days.", tone: "g3" },
  win: { label: "Win rate, 12 months", info: "Won out of won plus lost over the last 12 months. Dropped tenders do not count.", tone: "g4" },
  buyout: { label: "Buy-out committed", tone: "g5" },
};

/** "92.6M SAR", "5 bids", "55%", "4,200 SAR": a figure and its unit as one phrase. */
export function joinFigure(value: string, unit: string): string {
  if (!unit) return value;
  return /^[MK]\s/.test(unit) ? `${value}${unit}` : /^[\s%]/.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

/** The figures of one tile, from the desk data (null: the data could not be read). The same words and numbers the dashboard has always shown for them. */
export function tileFigures(kind: TileKind, data: TenderDeskData | null): TileFigures {
  const base = BASE[kind];
  const href = kind === "closing" ? tenderLinks.closing(14) : kind === "win" ? tenderLinks.outcome("won") : kind === "buyout" ? tenderLinks.buyout(data?.buyout) : tenderLinks.tab;
  const done = (value: string, unit: string, note: string): TileFigures => ({
    ...base, value, unit, note, href, aria: `${base.label}: ${joinFigure(value, unit)}, ${note}`,
  });
  if (!data || data.pending) return done("—", "", data ? "Not set up yet" : "Not available right now");

  const { kpis, currency } = data;
  switch (kind) {
    case "pipeline": {
      const m = tileMoney(kpis.openValue, currency);
      return done(m.value, m.unit, plural(kpis.openCount, "open tender"));
    }
    case "weighted": {
      const m = tileMoney(kpis.weightedValue, currency);
      const share = percentOf(kpis.weightedValue, kpis.openValue);
      return done(m.value, m.unit, share === null ? "No open value yet" : `${share}% of the open value`);
    }
    case "closing":
      return done(String(kpis.closingSoonCount), kpis.closingSoonCount === 1 ? " bid" : " bids", kpis.closingSoonCount === 0 ? "Nothing due soon" : `${millions(kpis.closingSoonValue)} ${currency} still to finish`);
    case "win":
      return done(winRateLabel(kpis.winRate).replace("%", ""), kpis.winRate === null ? "" : "%", kpis.winRate === null ? "Nothing decided yet" : `${kpis.won12} won, ${kpis.lost12} lost`);
    case "buyout": {
      const m = tileMoney(kpis.buyoutCommitted, currency);
      const share = percentOf(kpis.buyoutCommitted, kpis.buyoutBudget);
      return done(m.value, m.unit, share === null ? "No buy-out packages yet" : `${share}% of the package budget`);
    }
  }
}

/**
 * One saturated KPI tile. The whole tile is a link (a cover link above the figures, so the "i" next to the label stays a separate control),
 * it lifts on hover and on keyboard focus, and its aria label states the figure.
 */
export default function TenderTile({ kind, data, look }: { kind: TileKind; data: TenderDeskData | null; look: TenderDeskStyle }) {
  const f = tileFigures(kind, data);
  return (
    <div style={lookVars(look)} data-look={look}>
      <div className={`${s.tile} ${s[f.tone]}`} data-guide={`tender.dash.tile.${kind}`}>
        <Link href={f.href} className={s.cover} aria-label={f.aria} />
        <div className={s.tileLabel}>
          <span>{f.label}</span>
          {f.info && <InfoTip label={f.label}>{f.info}</InfoTip>}
        </div>
        <div className={s.tileValue}>{f.value}{f.unit && <small>{f.unit}</small>}</div>
        <div className={s.tileNote}>{f.note}</div>
      </div>
    </div>
  );
}
