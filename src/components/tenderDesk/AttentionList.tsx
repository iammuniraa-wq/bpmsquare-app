import Link from "next/link";
import type { TenderDeskAttention, TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { lookVars } from "./look";
import s from "./tenderBlocks.module.css";

const SEVERITY = { high: s.sevHigh, medium: s.sevMedium, low: s.sevLow } as const;
const SEVERITY_WORD = { high: "Urgent", medium: "Soon", low: "When you can" } as const;

function Row({ item }: { item: TenderDeskAttention }) {
  return (
    <li>
      <Link href={item.href} className={`${s.rowLink} ${s.at}`} data-guide="tender.dash.attention" aria-label={`${SEVERITY_WORD[item.severity]}. ${item.action}: ${item.title}. ${item.sub}`}>
        <span className={`${s.atBar} ${SEVERITY[item.severity]}`} aria-hidden="true" />
        <span>
          <span className={s.atTitle}><span className={s.srOnly}>{SEVERITY_WORD[item.severity]}: </span>{item.title}</span>
          <span className={s.atSub}>{item.sub}</span>
        </span>
        <span className={s.btn} aria-hidden="true">{item.action}</span>
      </Link>
    </li>
  );
}

/** Needs you today: things only a person can move, most urgent first. A row opens the record; its button names the action. */
export default function AttentionList({ data, look }: { data: TenderDeskData; look: TenderDeskStyle }) {
  return (
    <div className={s.blk} style={lookVars(look)} data-look={look}>
      {data.attention.length === 0 ? <p className={s.quiet}>Nothing needs you today.</p> : (
        <ul className={s.list}>
          {data.attention.map((a, i) => <Row key={`${a.kind}-${i}`} item={a} />)}
        </ul>
      )}
    </div>
  );
}
