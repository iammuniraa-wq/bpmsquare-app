import Link from "next/link";
import type { TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { compact, dayChip, dayTone, daysText } from "./format";
import { lookVars } from "./look";
import s from "./tenderBlocks.module.css";

const CHIP = { red: s.chipRed, amber: s.chipAmber, green: s.chipGreen } as const;

/** Bids closing soonest: a row per bid with a day chip that says the days in words; a row opens the tender. */
export default function ClosingList({ data, look }: { data: TenderDeskData; look: TenderDeskStyle }) {
  return (
    <div className={s.blk} style={lookVars(look)} data-look={look}>
      {data.closing.length === 0 ? <p className={s.quiet}>No bid is waiting for its end date.</p> : (
        <ul className={s.list}>
          {data.closing.map((c) => {
            const chip = dayChip(c.daysLeft);
            return (
              <li key={c.id}>
                <Link href={c.href} className={`${s.rowLink} ${s.close}`} data-guide="tender.dash.closing" aria-label={`${c.title}, closes in ${daysText(c.daysLeft)}, ${compact(c.value)} ${data.currency}`}>
                  <span className={`${s.chip} ${CHIP[dayTone(c.daysLeft)]}`}>{chip.big}<small>{chip.small}</small></span>
                  <span>
                    <span className={s.closeTitle}>{c.title}</span>
                    <span className={s.closeSub}>{[c.ref, c.client].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={s.closeVal}>{compact(c.value)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
