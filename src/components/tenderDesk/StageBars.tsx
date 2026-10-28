import Link from "next/link";
import type { TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { tenderLinks } from "@/lib/tenderDesk/links";
import { ROUTES } from "@/lib/constants";
import { barPercent, millions, plural, stagesAria } from "./format";
import { lookVars } from "./look";
import s from "./tenderBlocks.module.css";

/** Pipeline by stage: one linked bar per open stage, in the stage's own colour; a bar opens the Tenders tab on that stage. */
export default function StageBars({ data, look }: { data: TenderDeskData; look: TenderDeskStyle }) {
  const max = data.stages.reduce((m, st) => Math.max(m, st.value), 0);
  return (
    <div className={s.blk} style={lookVars(look)} data-look={look} data-guide="tender.dash.stages">
      {data.stages.length === 0 || data.kpis.openCount === 0 ? (
        <>
          <p className={s.quiet}>{data.kpis.openCount === 0 ? "No open tenders yet." : "No open stages."}</p>
          {data.kpis.openCount === 0 && <Link href={ROUTES.pipelineNewTender} className={s.nextLink}>+ New tender</Link>}
        </>
      ) : (
        <ul className={s.list} aria-label={stagesAria(data.stages, data.currency)}>
          {data.stages.map((st) => (
            <li key={st.stage}>
              <Link
                href={tenderLinks.stage(st.stage)}
                className={`${s.rowLink} ${s.stage}`}
                aria-label={`${st.label}: ${millions(st.value)} ${data.currency}, ${plural(st.count, "tender")}`}
                data-guide="tender.dash.stage"
              >
                <span className={s.stageName}>{st.label}</span>
                <span className={s.track} aria-hidden="true"><span className={`${s.trackFill} ${s.fill}`} style={{ display: "block", width: `${barPercent(st.value, max)}%`, background: st.color }} /></span>
                <span className={s.stageNum}><b>{millions(st.value)}</b> ({st.count})</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
