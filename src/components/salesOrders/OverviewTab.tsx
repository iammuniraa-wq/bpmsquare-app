import Link from "next/link";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { ROUTES } from "@/lib/constants";
import type { Attachment, OrderDetail } from "@/lib/salesOrders/client";
import { attention, attentionText, bannerText, customerPoFact, expectedDelivery, fmtDate, partyBlocks, tagText, type PartyBlock } from "./logic";
import { fmtMoney } from "./money";
import { ORDER_TIPS } from "./tips";
import s from "./salesOrders.module.css";

function Party({ label, block, href }: { label: string; block: PartyBlock; href?: string }) {
  return (
    <div>
      <div className={s.partyLabel}>{label}</div>
      <div className={s.partyName}>{href ? <Link href={href} style={{ color: "inherit", textDecoration: "none" }}>{block.name}</Link> : block.name}</div>
      {block.lines.map((l) => <div key={l} className={s.partyLine}>{l}</div>)}
    </div>
  );
}

/**
 * Overview is lean on purpose (owner, 2026-10-23): Sold to and Bill to (one block when they are the same), Ship to, and
 * three facts. No credit or price chips, no fulfilment bars. The only other thing that can appear is one banner, and
 * only when a line is short or will arrive after the date asked.
 */
export default function OverviewTab({ detail, attachments, currency, onSeeAvailability, onSeeErp }: {
  detail: OrderDetail;
  attachments: Attachment[] | null;
  currency: string;
  onSeeAvailability: () => void;
  /** Opens the ERP tab; used by the banner when the only trouble is a failed check. */
  onSeeErp?: () => void;
}) {
  const { order, lines } = detail;
  const parties = partyBlocks(detail);
  const banner = bannerText(lines, detail.erpChecks);
  const lineIssue = attentionText(attention(lines)) !== null;
  const expected = expectedDelivery(order, lines);
  const po = customerPoFact(order, attachments);

  return (
    <div className={s.overview} data-guide="sales_order.overview">
      {banner && (
        <div className={s.banner} role="status" data-guide="sales_order.attention">
          <span>{banner}</span>
          <button type="button" className={s.bannerLink} onClick={lineIssue || !onSeeErp ? onSeeAvailability : onSeeErp} data-guide="sales_order.attention_link">{lineIssue || !onSeeErp ? "See availability" : "See the ERP checks"}</button>
        </div>
      )}

      {detail.customerNote && (
        <div className={s.banner} role="status" data-guide="sales_order.customer_note"><span>{detail.customerNote}</span></div>
      )}

      <Card padding={16}>
        <div className={s.parties}>
          <Party label={parties.merged ? "Sold to and bill to" : "Sold to"} block={parties.soldTo} href={detail.account ? ROUTES.account(detail.account.id) : undefined} />
          {parties.billTo && <Party label="Bill to" block={parties.billTo} />}
          {parties.shipTo ? <Party label="Ship to" block={parties.shipTo} /> : null}
        </div>
      </Card>

      <div className={s.facts}>
        <Card padding={14}>
          <div className={s.fact} data-guide="sales_order.fact_total">
            <div className={s.factLabel}>Total incl. VAT<InfoTip label="Total incl. VAT">{ORDER_TIPS.total}</InfoTip></div>
            <div className={s.factValue}>{fmtMoney(order.total, currency)}</div>
          </div>
        </Card>
        <Card padding={14}>
          <div className={s.fact} data-guide="sales_order.fact_expected">
            <div className={s.factLabel}>Expected delivery<InfoTip label="Expected delivery">{ORDER_TIPS.expected}</InfoTip></div>
            <div className={s.factValue}>{expected.date ? fmtDate(expected.date) : "Not confirmed yet"}</div>
            {expected.date && expected.tag.kind !== "none" && (
              <div className={s.factSub}>
                <span className={`${s.tag} ${expected.tag.kind === "erp" ? s.tagErp : s.tagMaster}`}>{tagText(expected.tag)}</span>
              </div>
            )}
          </div>
        </Card>
        <Card padding={14}>
          <div className={s.fact} data-guide="sales_order.fact_po">
            <div className={s.factLabel}>Customer PO<InfoTip label="Customer PO">{ORDER_TIPS.customerPo}</InfoTip></div>
            <div className={s.factValue}>{po.number ?? "—"}</div>
            {po.files !== null && <div className={s.factSub}>{po.files === 0 ? "No files" : `${po.files} ${po.files === 1 ? "file" : "files"}`}</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
