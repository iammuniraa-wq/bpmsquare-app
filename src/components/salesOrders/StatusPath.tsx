import InfoTip from "@/components/ui/InfoTip";
import { ORDER_TIPS } from "./tips";
import { orderPath, subStatus } from "./logic";
import type { SalesOrder } from "@/lib/salesOrders/types";
import type { ErpDocument } from "@/lib/salesOrders/client";
import s from "./salesOrders.module.css";

/**
 * The path across the very top of the order (above the id, on every tab): Draft, Confirmed, Delivered, Invoiced, Paid
 * as one segmented bar. Later steps stay grey with a hint until the ERP reports them; delivery and billing sub-status
 * sit just under it, right-aligned. One row on a phone.
 */
export default function StatusPath({ order, docs }: { order: Pick<SalesOrder, "status" | "confirmed_at">; docs: ErpDocument[] }) {
  const model = orderPath(order, docs);
  const sub = subStatus(docs);
  return (
    <div className={s.pathBlock} data-guide="sales_order.path">
      <div className={s.pathRow}>
        <ol className={`${s.path} ${model.cancelled ? s.pathCancelled : ""}`} aria-label="Order path">
          {model.steps.map((step) => (
            <li
              key={step.key}
              className={s.step}
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
              title={step.hint ?? undefined}
            >
              <span className={s.seg} aria-hidden="true" />
              <span className={s.stepLabel}>
                {step.label}
                <span className={s.sr}>{step.state === "done" ? " (reached)" : step.state === "current" ? " (current)" : step.hint ? ` (${step.hint})` : " (not reached)"}</span>
              </span>
            </li>
          ))}
        </ol>
        <InfoTip label="Order path">{ORDER_TIPS.path}</InfoTip>
      </div>
      {(sub.delivery || sub.billing) && (
        <div className={s.subStatus} data-guide="sales_order.substatus">
          {sub.delivery && <span>{sub.delivery}</span>}
          {sub.billing && <span>{sub.billing}</span>}
        </div>
      )}
    </div>
  );
}
