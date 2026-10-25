import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import type { ErpDocument, OrderDetail } from "@/lib/salesOrders/client";
import { CHECK_KINDS, CHECK_LABEL, TRANSFER_WORD, checksByKind, type ErpTransferView } from "@/lib/salesOrders/erpChecks";
import { checkChip, fmtDate, fmtDateTime, statusLabel, statusTone, type Tone } from "./logic";
import { fmtMoney } from "./money";
import { ORDER_TIPS } from "./tips";
import s from "./salesOrders.module.css";

/** One word-colour per document spine; the ERP's own wording is what the chip says. */
const DOC_TONE: Record<string, Tone> = { paid: "green", delivered: "green", open: "amber", closed: "blue", cancelled: "red" };

const CHIP_CLASS = { ok: s.tagOk, warn: s.tagMaster, bad: s.tagBad, none: s.tagNone } as const;
const NEEDS_UPDATE = "Needs a database update";

function Docs({ title, docs, currency, empty, delivery }: { title: string; docs: ErpDocument[]; currency: string; empty: string; delivery?: boolean }) {
  return (
    <div data-guide={delivery ? "sales_order.erp_deliveries" : "sales_order.erp_invoices"}>
      <div className={s.partyLabel} style={{ marginBottom: 6 }}>{title}</div>
      {docs.length === 0 ? (
        <p className="bpm-t-help" style={{ margin: 0 }}>{empty}</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Number</th><th scope="col">Date</th>{!delivery && <th scope="col">Due</th>}<th scope="col" className={s.num}>Amount</th><th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.href ? <a href={d.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--so-accent, var(--accent))", fontWeight: 600 }}>{d.number ?? d.id}</a> : (d.number ?? "—")}</td>
                  <td>{fmtDate(d.date)}</td>
                  {!delivery && <td>{fmtDate(d.due)}</td>}
                  <td className={s.num}>{d.amount !== null ? fmtMoney(d.amount, d.currency || currency) : "—"}</td>
                  <td>{d.status ? <StatusPill label={d.status} tone={DOC_TONE[d.spine ?? ""] ?? "blue"} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What a transfer row says in its last column: the ERP number when it went through, else the step that failed and the reason. */
const transferNote = (t: ErpTransferView): string =>
  t.result === "failed" ? [t.step ? `Step: ${t.step}` : null, t.message].filter(Boolean).join(". ") : [t.erp_number, t.result === "already_sent" ? null : t.message].filter(Boolean).join(" · ") || "—";

const resultTone = (r: ErpTransferView["result"]): Tone => (r === "failed" ? "red" : r === "sent" ? "green" : "blue");

function TransferLog({ transfers, canRetry, onRetry, retrying }: { transfers: ErpTransferView[]; canRetry: boolean; onRetry?: () => void; retrying?: boolean }) {
  const latestFailed = transfers[0]?.result === "failed" ? transfers[0].id : null;
  const retry = (t: ErpTransferView) => (canRetry && onRetry && t.id === latestFailed
    ? <Button size="sm" variant="secondary" loading={retrying} onClick={onRetry} data-guide="sales_order.transfer_retry">Retry</Button>
    : null);
  return (
    <div data-guide="sales_order.transfer_log">
      <div className={s.tableOnly}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr><th scope="col">Time</th><th scope="col">By</th><th scope="col">Result</th><th scope="col">ERP number, or what failed</th><th scope="col"><span className={s.sr}>Retry</span></th></tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} data-result={t.result}>
                  <td>{fmtDateTime(t.attempted_at)}</td>
                  <td>{t.by ?? "—"}</td>
                  <td><StatusPill label={TRANSFER_WORD[t.result]} tone={resultTone(t.result)} /></td>
                  <td style={{ overflowWrap: "anywhere" }}>{transferNote(t)}</td>
                  <td>{retry(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className={s.cards}>
        {transfers.map((t) => (
          <div key={t.id} className={s.card} data-result={t.result}>
            <div className={s.cardTitle}><StatusPill label={TRANSFER_WORD[t.result]} tone={resultTone(t.result)} /></div>
            <dl className={s.cardGrid}>
              <dt>Time</dt><dd>{fmtDateTime(t.attempted_at)}</dd>
              <dt>By</dt><dd>{t.by ?? "—"}</dd>
              <dt>{t.result === "failed" ? "Failed" : "ERP number"}</dt><dd>{transferNote(t)}</dd>
            </dl>
            {retry(t) && <div style={{ marginTop: 8 }}>{retry(t)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The ERP tab: the ERP number and status with when they were last read, a Refresh, then Check with ERP (credit, price and
 * stock, each with its time and one-line reason) with the separate Send to ERP, the invoices and deliveries the ERP reported
 * (read-only) and the transfer log. Everything about the connection itself lives on the Integration middleware page; this tab
 * only links to it. The screen only draws: the confirm step before sending is the parent's panel.
 */
export default function ErpTab({ detail, currency, externalLine, middlewareHref, onRefresh, refreshing, onCheck, checking, onSend, sending }: {
  detail: OrderDetail;
  currency: string;
  /** The server-rendered ERP id line (ExternalRecordSlot), or nothing. */
  externalLine: React.ReactNode;
  /** Where an admin sets the ERP up; null hides the link (not an admin, or the middleware is off). */
  middlewareHref: string | null;
  /** Ask the ERP again about this order; absent when the order is not in an ERP. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Check with ERP; absent hides the button (no permission). */
  onCheck?: () => void;
  checking?: boolean;
  /** Opens the confirm step for Send to ERP (also what Retry does). */
  onSend?: () => void;
  sending?: boolean;
}) {
  const { order } = detail;
  const deliveries = detail.erpDocuments.filter((d) => d.kind === "delivery");
  const invoices = detail.erpDocuments.filter((d) => d.kind === "invoice");
  const inErp = detail.erpLinked || order.origin === "erp";
  const number = detail.erpLink?.number ?? (order.origin === "erp" ? order.ref : null);
  const read = detail.erpLink?.checkedAt ?? detail.erpLink?.syncedAt ?? null;

  const by = checksByKind(detail.erpChecks);
  const canAct = detail.erpAvailable && order.origin === "bpmsquare" && order.status !== "cancelled" && !detail.erpLinked;
  const showChecks = canAct || detail.erpChecks.length > 0;
  const pending = detail.erpChecksPending;
  const blocker = canAct && !pending ? detail.erpSendBlocker : null;

  return (
    <div className={s.overview} data-guide="sales_order.erp">
      <Card padding={16}>
        <div className="bpm-label-row" style={{ marginBottom: 8 }}>
          <span className="bpm-t-section">ERP</span>
          <InfoTip label="ERP">{ORDER_TIPS.erpId}</InfoTip>
        </div>
        <div className={s.erpId}>
          {externalLine}
          {!inErp && <span className="bpm-t-help">Not in an ERP</span>}
        </div>
        {inErp && (
          <div className={s.facts} style={{ marginTop: 12 }}>
            <div className={s.fact} data-guide="sales_order.erp_number">
              <div className={s.factLabel}>ERP number</div>
              <div className={s.factValue}>{number ?? "—"}</div>
            </div>
            <div className={s.fact} data-guide="sales_order.erp_status">
              <div className={s.factLabel}>ERP status</div>
              <div className={s.factValue}>{order.status_label ? <StatusPill label={statusLabel(order)} tone={statusTone(order)} /> : "—"}</div>
            </div>
            <div className={s.fact} data-guide="sales_order.erp_synced">
              <div className={s.factLabel}>Last read</div>
              <div className={s.factSub}>{read ? fmtDateTime(read) : "Not yet"}</div>
              {onRefresh && <Button size="sm" loading={refreshing} onClick={onRefresh} data-guide="sales_order.erp_refresh">Refresh</Button>}
            </div>
          </div>
        )}
      </Card>

      {showChecks && (
        <Card padding={16}>
          <div className={s.cardHead}>
            <span className="bpm-label-row">
              <span className="bpm-t-section">Check with ERP</span>
              <InfoTip label="Check with ERP">{ORDER_TIPS.check}</InfoTip>
            </span>
            {canAct && (onCheck || onSend) && (
              <span className={s.cardActions}>
                {onCheck && (
                  <Button size="sm" variant="secondary" loading={checking} disabled={pending} title={pending ? NEEDS_UPDATE : undefined} onClick={onCheck} data-guide="sales_order.erp_check">
                    {pending ? NEEDS_UPDATE : "Check with ERP"}
                  </Button>
                )}
                {onSend && (
                  <span className="bpm-label-row">
                    <Button size="sm" variant="primary" loading={sending} disabled={pending || blocker !== null} title={pending ? NEEDS_UPDATE : blocker ?? undefined} onClick={onSend} data-guide="sales_order.erp_send">
                      {pending ? NEEDS_UPDATE : "Send to ERP"}
                    </Button>
                    <InfoTip label="Send to ERP">{ORDER_TIPS.send}</InfoTip>
                  </span>
                )}
              </span>
            )}
          </div>

          <div data-guide="sales_order.erp_checks">
            {CHECK_KINDS.map((k) => {
              const c = by[k];
              const chip = checkChip(c);
              return (
                <div key={k} className={s.checkRow} data-guide={`sales_order.check_${k}`} data-status={c ? (c.stale ? "stale" : c.status) : "none"}>
                  <div className={s.checkName}>{CHECK_LABEL[k]}</div>
                  <span><span className={`${s.tag} ${CHIP_CLASS[chip.tone]}`}>{chip.word}</span></span>
                  <div>
                    <div className={s.checkText}>{c ? c.message ?? "" : "Not checked yet."}</div>
                    {c && (
                      <div className={s.checkTime}>
                        {fmtDateTime(c.checked_at)}
                        {c.stale && <span className="bpm-label-row" style={{ display: "inline-flex", marginLeft: 6 }}><InfoTip label="Out of date">{ORDER_TIPS.stale}</InfoTip></span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {pending && <p role="status" className="bpm-t-help" style={{ margin: "10px 0 0", color: "var(--err-ink)" }} data-guide="sales_order.erp_pending">{NEEDS_UPDATE}. An admin has to run the database update for orders and the ERP.</p>}
          {blocker && <p role="status" className="bpm-t-help" style={{ margin: "10px 0 0" }} data-guide="sales_order.erp_blocker">{blocker}</p>}
        </Card>
      )}

      <Card padding={16}>
        <div className="bpm-label-row" style={{ marginBottom: 8 }}>
          <span className="bpm-t-section">Invoices and deliveries</span>
          <InfoTip label="Invoices and deliveries">{ORDER_TIPS.deliveries}</InfoTip>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Docs title="Invoices" docs={invoices} currency={currency} empty="Invoices from Dynamics 365 appear here. Nothing yet." />
          <Docs title="Deliveries" docs={deliveries} currency={currency} delivery empty="Deliveries come from F&O or SAP, which are not connected." />
        </div>
      </Card>

      <Card padding={16}>
        <div className="bpm-label-row" style={{ marginBottom: 8 }}>
          <span className="bpm-t-section">Transfer log</span>
          <InfoTip label="Transfer log">{ORDER_TIPS.transfer}</InfoTip>
        </div>
        {detail.erpTransfers.length > 0 ? (
          <TransferLog transfers={detail.erpTransfers} canRetry={canAct && !pending && blocker === null} onRetry={onSend} retrying={sending} />
        ) : (
          <EmptyState
            title="Nothing sent yet"
            text="Checks and transfers to your ERP will be logged here."
            action={middlewareHref ? <Button href={middlewareHref} data-guide="sales_order.erp_setup">Set up your ERP</Button> : undefined}
          />
        )}
      </Card>
    </div>
  );
}
