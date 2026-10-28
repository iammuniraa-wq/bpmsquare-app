import type { ReactNode } from "react";
import type { AnalyticsMetricId } from "@/lib/constants";
import type { TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { tenderLinks } from "@/lib/tenderDesk/links";
import { TENDER_BLOCK_TIPS } from "@/lib/tenderDesk/tips";
import AttentionList from "./AttentionList";
import BuyoutBars from "./BuyoutBars";
import ClientDonut from "./ClientDonut";
import ClosingList from "./ClosingList";
import DeadlineTimeline from "./DeadlineTimeline";
import StageBars from "./StageBars";
import TenderTile, { type TileKind } from "./TenderTiles";
import TrendArea from "./TrendArea";
import WonLost from "./WonLost";
import s from "./tenderBlocks.module.css";

/** What the dashboard draws for one tender block: a saturated tile that is its own card, or a titled card (the dashboard's AnalyticsCard) with a body. */
export type TenderBlockSpec =
  | { kind: "tile"; node: ReactNode }
  | { kind: "card"; title: string; href?: string; info?: string; body: ReactNode };

const TILE_FOR: Partial<Record<AnalyticsMetricId, TileKind>> = {
  tender_open_pipeline: "pipeline",
  tender_weighted: "weighted",
  tender_closing_soon: "closing",
  tender_win_rate: "win",
  tender_buyout_committed: "buyout",
};

/** A calm line in place of a block whose data is missing: the tables are not set up yet, or the read failed. Both keep the dashboard standing. */
function Unavailable({ data }: { data: TenderDeskData | null }) {
  return (
    <p className={s.quiet} role="status" data-guide="tender.dash.unavailable">
      {data ? "Tender data is not set up yet. Ask your administrator to finish setting up tenders for this workspace." : "Tender data could not be read just now. Reload the page to try again."}
    </p>
  );
}

/** The tender block `id` for the given data and look; null for an id that is not a tender block. */
export function tenderBlockSpec(id: AnalyticsMetricId, data: TenderDeskData | null, look: TenderDeskStyle): TenderBlockSpec | null {
  const tile = TILE_FOR[id];
  if (tile) return { kind: "tile", node: <TenderTile kind={tile} data={data} look={look} /> };

  const ready = data && !data.pending ? data : null;
  const card = (title: string, body: (d: TenderDeskData) => ReactNode, extra: { href?: string; info?: string } = {}): TenderBlockSpec => ({
    kind: "card", title, ...extra, body: ready ? body(ready) : <Unavailable data={data} />,
  });

  switch (id) {
    case "tender_by_stage": return card("Pipeline by stage", (d) => <StageBars data={d} look={look} />, { href: tenderLinks.tab, info: TENDER_BLOCK_TIPS.byStage });
    case "tender_closing_list": return card("Bids closing soonest", (d) => <ClosingList data={d} look={look} />, { href: tenderLinks.tab, info: TENDER_BLOCK_TIPS.closing });
    case "tender_won_lost": return card("Won and lost by month", (d) => <WonLost data={d} look={look} />, { href: tenderLinks.tab, info: TENDER_BLOCK_TIPS.wonLost });
    case "tender_by_client": return card("Open value by client", (d) => <ClientDonut data={d} look={look} />, { href: tenderLinks.tab, info: TENDER_BLOCK_TIPS.clients });
    case "tender_attention": return card("Needs you today", (d) => <AttentionList data={d} look={look} />, { info: TENDER_BLOCK_TIPS.attention });
    case "tender_trend": return card("Open pipeline, last 12 weeks", (d) => <TrendArea data={d} look={look} />, { href: tenderLinks.tab, info: TENDER_BLOCK_TIPS.trend });
    case "tender_deadlines": return card("Bid deadlines, next 28 days", (d) => <DeadlineTimeline data={d} look={look} />, { href: tenderLinks.closing(28), info: TENDER_BLOCK_TIPS.deadlines });
    case "tender_buyout": return card("Buy-out against budget", (d) => <BuyoutBars data={d} look={look} />, { href: tenderLinks.buyout(ready?.buyout), info: TENDER_BLOCK_TIPS.buyout });
    default: return null;
  }
}
