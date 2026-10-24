import StatusPill from "@/components/ui/StatusPill";
import InfoTip from "@/components/ui/InfoTip";
import type { SalesOrder, SalesOrderType } from "@/lib/salesOrders/types";
import { lockInfo, statusLabel, statusTone } from "./logic";
import s from "./salesOrders.module.css";

/**
 * Beside the order id: the status, the order type, and (only while the order cannot be changed) a lock chip whose "i"
 * gives the reason. `reason` is the server's own wording when it sent one, so the chip, the greyed-out controls and a
 * rejected edit all say the same thing.
 */
export default function OrderChips({ order, type, erpLinked, reason }: {
  order: Pick<SalesOrder, "status" | "status_label" | "spine" | "origin">;
  type: Pick<SalesOrderType, "name"> | null;
  erpLinked: boolean;
  reason?: string | null;
}) {
  const lock = lockInfo(order, erpLinked);
  const why = reason ?? lock.reason;
  return (
    <span className={s.chips}>
      <StatusPill label={statusLabel(order)} tone={statusTone(order)} />
      {type && <span className={s.chip} data-guide="sales_order.type">{type.name}</span>}
      {lock.chip && why && (
        <span className="bpm-label-row" data-guide="sales_order.lock">
          <span className={`${s.chip} ${s.chipLock}`}>{lock.chip}</span>
          <InfoTip label={lock.chip}>{why}</InfoTip>
        </span>
      )}
    </span>
  );
}
