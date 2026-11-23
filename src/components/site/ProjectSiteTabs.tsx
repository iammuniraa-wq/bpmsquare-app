import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import StatusPill from "@/components/ui/StatusPill";
import InfoTip from "@/components/ui/InfoTip";
import EmptyState from "@/components/ui/EmptyState";
import { ROUTES } from "@/lib/constants";
import { anyProject, loadCategories, openSiteRequest } from "@/lib/site/server";
import { isDeciderOn, listExpenses, loadViewerScope, seesBudget } from "@/lib/site/expensesServer";
import { listReceipts, loadReceivedValues } from "@/lib/site/receiptsServer";
import { projectExpenseSummary } from "@/lib/site/standing";
import { canDecideExpense, projectAmount } from "@/lib/site/expenseRules";
import { EXPENSE_FLAG_LABEL, EXPENSE_STATUS_LABEL, RECEIPT_OUTCOME_LABEL, type ExpenseStatus, type ReceiptOutcome } from "@/lib/site/types";
import { fmtMoney } from "@/lib/site/clientHelpers";
import { SITE_TIPS } from "@/lib/site/tips";
import ExpenseActions from "./ExpenseActions";
import SiteEntrySwitch from "./SiteEntrySwitch";
import RegisterButtons from "./RegisterButtons";

// The Expenses and Receipts tabs of a contract project. Server components: the page asks for them only when the workspace owns the module. The money
// (recorded, posted, received value) is drawn only for the people who manage the project's money; anyone else sees the list without figures.

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const tone = (s: ExpenseStatus) => (s === "approved" ? "green" : s === "rejected" ? "red" : s === "cancelled" ? "blue" : "amber") as "green" | "red" | "blue" | "amber";
const oTone = (o: ReceiptOutcome) => (o === "complete" ? "green" : o === "partial" ? "amber" : "red") as "green" | "amber" | "red";

function Tile({ label, value, info, ink }: { label: string; value: string; info: string; ink?: string }) {
  return (
    <div style={{ ...cardStyle, padding: "10px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 4 }}>{label}<InfoTip label={label}>{info}</InfoTip></div>
      <div style={{ fontSize: 18, fontWeight: 700, color: ink ?? c.ink, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

export async function ProjectSiteExpenses({ projectId }: { projectId: string }) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return null;
  const req = gate.req;
  const project = await anyProject(req.admin, req.tenantId, projectId);
  if (!project) return null;
  const scope = await loadViewerScope(req);
  const { rows, pending } = await listExpenses(req, scope, { projectId, limit: 60 });
  if (pending) return <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }}>Site expenses need a database update (migration 0258). Ask your administrator to apply it.</div>;
  const budgetOk = seesBudget(scope, projectId);
  const [summary, cats] = await Promise.all([budgetOk ? projectExpenseSummary(req.admin, req.tenantId, project) : Promise.resolve(null), loadCategories(req.admin, req.tenantId)]);
  const limitOf = new Map(cats.rows.map((x) => [x.id, x.limit_amount]));
  const waiting = rows.filter((e) => e.status === "submitted").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-guide="cp.site.expenses">
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          <Tile label="Waiting" value={fmtMoney(summary.totals.waiting, project.currency)} info={SITE_TIPS.waitingExposure} ink="var(--amberink)" />
          <Tile label="Recorded" value={fmtMoney(summary.totals.recorded, project.currency)} info={SITE_TIPS.recorded} ink="var(--blueink)" />
          <Tile label="Posted by the ERP" value={fmtMoney(summary.totals.posted, project.currency)} info={SITE_TIPS.postedByErp} ink="var(--greenink)" />
        </div>
      )}
      {summary && summary.totals.unconverted > 0 && <div style={{ fontSize: 12.5, color: "var(--amberink)" }}>{summary.totals.unconverted} expense{summary.totals.unconverted === 1 ? " is" : "s are"} in another currency and not counted until the amount in {project.currency} is entered on approval.</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: 14, color: c.ink }}>Expenses</strong>
        <span style={{ fontSize: 12.5, color: c.hint }}>{waiting} waiting</span>
        <Link href={`${ROUTES.siteExpenses}`} className="bpm-btn bpm-btn-secondary bpm-btn-sm" style={{ marginLeft: "auto" }}>Open all</Link>
        {scope.isCost && <RegisterButtons projectId={projectId} ids={rows.filter((e) => e.status === "approved" && e.erp_state !== "sent" && e.erp_state !== "posted").map((e) => e.id)} />}
      </div>
      {isDeciderOn(scope, projectId) && <SiteEntrySwitch projectId={projectId} initial={project.site_entry} />}

      {rows.length === 0 ? (
        <div style={cardStyle}><EmptyState title="No expenses on this project yet" text="A person on site adds one from a phone: photo, category, Submit." /></div>
      ) : (
        <div style={{ ...cardStyle, padding: 0 }}>
          {rows.map((e) => {
            const decide = canDecideExpense({
              actorId: req.userId, actorIsAdmin: scope.isAdmin, submitterId: e.submitted_by, managerId: project.manager_id, costApprovers: scope.costApprovers, allowSelfApproval: scope.allowSelfApproval,
              amountInProject: projectAmount(e, project.currency), categoryLimit: e.category_id ? limitOf.get(e.category_id) ?? null : null, config: req.config,
            });
            return (
              <div key={e.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", padding: "10px 14px", borderTop: `1px solid ${c.line}` }}>
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <Link href={ROUTES.siteExpense(e.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{e.vendor_text ?? e.category_name ?? "Expense"}</Link>
                  <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}><span style={{ fontFamily: MONO }}>{e.ref}</span> · {e.submitted_by_name ?? "—"} · {e.category_name ?? "—"} · {e.expense_date}</div>
                  {e.flags.length > 0 && <div style={{ fontSize: 11.5, color: "var(--amberink)", marginTop: 2 }}>{e.flags.map((f) => EXPENSE_FLAG_LABEL[f]).join(" · ")}</div>}
                </div>
                <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 13.5, color: c.ink, whiteSpace: "nowrap" }}>{fmtMoney(e.amount, e.currency)}</div>
                <StatusPill label={EXPENSE_STATUS_LABEL[e.status]} tone={tone(e.status)} />
                {e.status === "submitted" && decide.ok && (
                  <ExpenseActions compact id={e.id} status={e.status} canDecide canCancel={false} projectCurrency={project.currency} currency={e.currency} hasLine={!!e.line_key} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {summary && summary.byLine.length > 0 && (
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
            <thead>
              <tr>{["Cost line", "Allocated", "Recorded", "Waiting"].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "9px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: c.hint, background: c.panel2 }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {summary.byLine.map((l) => (
                <tr key={l.line_key ?? "none"} style={{ borderTop: `1px solid ${c.line}` }}>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{l.label}</td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: c.muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.allocated === null ? "—" : fmtMoney(l.allocated)}</td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: "var(--blueink)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(l.recorded)}</td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: "var(--amberink)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(l.waiting)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export async function ProjectSiteReceipts({ projectId }: { projectId: string }) {
  const gate = await openSiteRequest("site_receipts");
  if (!gate.ok) return null;
  const req = gate.req;
  const project = await anyProject(req.admin, req.tenantId, projectId);
  if (!project) return null;
  const scope = await loadViewerScope(req);
  const { rows, pending } = await listReceipts(req, { projectId, limit: 60 });
  if (pending) return <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }}>Site receipts need a database update (migration 0259). Ask your administrator to apply it.</div>;
  const values = seesBudget(scope, projectId) ? await loadReceivedValues(req.admin, req.tenantId, projectId).catch(() => []) : [];
  const problem = rows.filter((r) => r.status === "confirmed" && r.outcome !== "complete").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-guide="cp.site.receipts">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: 14, color: c.ink }}>Receipts</strong>
        <span style={{ fontSize: 12.5, color: c.hint }}>{rows.length} recorded · {problem} with a problem</span>
        <Link href={ROUTES.siteReceipts} className="bpm-btn bpm-btn-secondary bpm-btn-sm" style={{ marginLeft: "auto" }}>Open all</Link>
      </div>

      {values.length > 0 && (
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: c.ink, display: "flex", alignItems: "center", gap: 6 }}>Received on site, by buy-out package <InfoTip label="Received on site">{SITE_TIPS.receivedValue}</InfoTip></div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
            <thead>
              <tr>{["Package", "Committed", "Received on site", "Still to receive"].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "9px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: c.hint, background: c.panel2 }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {values.map((v) => (
                <tr key={v.package_id} style={{ borderTop: `1px solid ${c.line}` }}>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: c.ink }}>{v.ref ? `${v.ref} · ` : ""}{v.name}{v.supplier_name ? <span style={{ color: c.hint }}> · {v.supplier_name}</span> : null}</td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: c.muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(v.committed, v.currency)}</td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: "var(--greenink)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(v.received_value, v.currency)}</td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: v.still_to_receive < 0 ? "var(--redink)" : c.muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(v.still_to_receive, v.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 ? (
        <div style={cardStyle}><EmptyState title="No deliveries received yet" text="A person on site confirms a delivery from a phone: pick it, count it, confirm." /></div>
      ) : (
        <div style={{ ...cardStyle, padding: 0 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", padding: "10px 14px", borderTop: `1px solid ${c.line}` }}>
              <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                <Link href={ROUTES.siteReceipt(r.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{r.delivery_note_ref ?? "Delivery"}</Link>
                <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}><span style={{ fontFamily: MONO }}>{r.ref}</span> · {r.received_by_name ?? "—"} · {new Date(r.received_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</div>
              </div>
              <div style={{ fontSize: 12.5, color: c.muted, fontVariantNumeric: "tabular-nums" }}>{r.lines} item{r.lines === 1 ? "" : "s"} · {r.accepted} accepted{r.rejected ? ` · ${r.rejected} rejected` : ""}</div>
              {r.status === "cancelled" ? <StatusPill label="Cancelled" tone="blue" /> : <StatusPill label={RECEIPT_OUTCOME_LABEL[r.outcome]} tone={oTone(r.outcome)} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
