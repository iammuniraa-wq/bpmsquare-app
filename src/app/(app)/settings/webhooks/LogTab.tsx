"use client";

import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import s from "./webhooks.module.css";
import { listDeliveries, type DeliveryItem } from "./api";
import { ProblemNotice, useLoad } from "../middleware/ui";
import { MONITOR_HREF, deliveryLine } from "./logic";
import { WEBHOOK_TIPS } from "./tips";

/** Delivery log: the last 20 calls, newest first; details and Restart live in the Monitor. */
export default function LogTab({ webhookId, monitorLink }: { webhookId: string; monitorLink: boolean }) {
  const log = useLoad(() => listDeliveries(webhookId), [webhookId]);
  return (
    <section className={s.block} aria-label="Delivery log">
      <div className={s.rowBetween}>
        <span className="bpm-label-row"><h3 className="bpm-t-label">Last 20 calls</h3><InfoTip label="Delivery log">{WEBHOOK_TIPS.log}</InfoTip></span>
        {monitorLink && <Button size="sm" href={MONITOR_HREF}>Open in Monitor</Button>}
      </div>
      {log.error != null && !log.data && <ProblemNotice error={log.error} onRetry={() => void log.reload()} />}
      {!log.data && log.error == null && <p className={s.greyLine} role="status">Loading…</p>}
      {log.data && <LogList items={log.data.slice(0, 20)} />}
    </section>
  );
}

export function LogList({ items, now }: { items: readonly DeliveryItem[]; now?: Date }) {
  if (items.length === 0) return <p className={s.greyLine}>No calls yet. Send a test from the Test tab.</p>;
  return (
    <ul className={s.logList}>
      {items.map((d) => {
        const l = deliveryLine(d, now);
        return (
          <li key={d.id} className={s.logItem}>
            <span className={s.logHead}>{l.when}</span>
            <span className={l.ok ? s.logOk : s.logBad}>{l.status}{l.duration ? ` · ${l.duration}` : ""}</span>
            {l.headline && <span className={s.logSub}>{l.headline}</span>}
          </li>
        );
      })}
    </ul>
  );
}
