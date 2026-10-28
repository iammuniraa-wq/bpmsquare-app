import Link from "next/link";
import type { TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { tenderLinks } from "@/lib/tenderDesk/links";
import { buyoutRow, millions } from "./format";
import { lookVars } from "./look";
import s from "./tenderBlocks.module.css";

const PILL = { awarded: s.pillAwarded, "quotes in": s.pillQuotes, waiting: s.pillWaiting } as const;
const PILL_LABEL = { awarded: "Awarded", "quotes in": "Quotes in", waiting: "Waiting" } as const;
const DIFF = { under: s.diffUnder, over: s.diffOver, none: s.diffNone } as const;

/** Buy-out against budget: a row per package (budget bar, awarded fill, best-quote marker, status and gap); every row and the title open the Buy-out tab. */
export default function BuyoutBars({ data, look }: { data: TenderDeskData; look: TenderDeskStyle }) {
  const buyout = data.buyout;
  if (!buyout) return <div className={s.blk} style={lookVars(look)} data-look={look}><p className={s.quiet}>No buy-out packages yet.</p></div>;
  const href = tenderLinks.buyout(buyout);
  const maxBudget = buyout.packages.reduce((m, p) => Math.max(m, p.budget), 0);
  return (
    <div className={s.blk} style={lookVars(look)} data-look={look} data-guide="tender.dash.buyout">
      <div className={s.buyTitle}>
        <span className={s.buyName}>{buyout.projectName}</span>
        <Link href={href} className={s.nextLink}>Open buy-out</Link>
      </div>
      {buyout.packages.length === 0 ? <p className={s.quiet}>No buy-out packages yet.</p> : (
        <ul className={s.list}>
          {buyout.packages.map((p) => {
            const row = buyoutRow(p, maxBudget);
            return (
              <li key={p.name}>
                <Link
                  href={href}
                  className={`${s.rowLink} ${s.pkg}`}
                  data-guide="tender.dash.package"
                  aria-label={`${p.name}: ${PILL_LABEL[p.status]}, budget ${millions(p.budget, 2)} ${data.currency}, ${row.diff.text}`}
                >
                  <span className={s.pkgName}>{p.name}</span>
                  <span className={s.pkgTrack} style={{ width: `${row.trackPct}%`, display: "block" }} aria-hidden="true">
                    <span className={`${s.pkgFill} ${s.fill}`} style={{ width: `${row.committedPct}%`, display: "block" }} />
                    {row.quotePct !== null && <span className={`${s.pkgMarker} ${row.diff.kind === "over" ? s.markerOver : s.markerUnder}`} style={{ left: `${row.quotePct}%`, display: "block" }} />}
                  </span>
                  <span className={s.pkgEnd}>
                    <span className={`${s.pill} ${PILL[p.status]}`}>{PILL_LABEL[p.status]}</span>
                    <span className={DIFF[row.diff.kind]}>{row.diff.text}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
