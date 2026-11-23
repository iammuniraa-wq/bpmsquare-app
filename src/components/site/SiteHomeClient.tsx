"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { ROUTES } from "@/lib/constants";
import { loadBootstrap, fmtMoney, lastProject, rememberProject, type SiteBootstrap } from "@/lib/site/clientHelpers";
import { EXPENSE_STATUS_LABEL, RECEIPT_STATUS_LABEL, type ExpenseStatus, type ReceiptStatus } from "@/lib/site/types";
import { SITE_TIPS } from "@/lib/site/tips";
import { Banner, SiteFrame, WaitingToUpload, sectionCard, MONO } from "./siteUi";

type RecentExpense = { id: string; ref: string | null; status: ExpenseStatus; amount: number; currency: string; vendor_text: string | null; category_name: string | null; expense_date: string };
type RecentReceipt = { id: string; ref: string | null; status: ReceiptStatus; delivery_note_ref: string | null; outcome: string; lines: number; received_at: string };

const expenseTone = (s: ExpenseStatus) => (s === "approved" ? "green" : s === "rejected" ? "red" : s === "cancelled" ? "blue" : "amber") as "green" | "red" | "blue" | "amber";

/** The phone home of the site person: two big actions, what is waiting to upload, and the last few of their own entries. */
export default function SiteHomeClient() {
  const [boot, setBoot] = useState<SiteBootstrap | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string>("");
  const [expenses, setExpenses] = useState<RecentExpense[]>([]);
  const [receipts, setReceipts] = useState<RecentReceipt[]>([]);

  const loadRecent = useCallback(async (b: SiteBootstrap) => {
    try {
      if (b.modules.expenses) {
        const r = await fetch("/api/site-expenses?mine=1");
        if (r.ok) setExpenses(((await r.json()).rows as RecentExpense[]).slice(0, 5));
      }
      if (b.modules.receipts) {
        const r = await fetch("/api/site-receipts");
        if (r.ok) setReceipts(((await r.json()).rows as RecentReceipt[]).slice(0, 5));
      }
    } catch { /* offline: the recent list is a nicety */ }
  }, []);

  useEffect(() => {
    void loadBootstrap().then(({ data, stale: s, error: e }) => {
      if (!data) { setError(e ?? "Nothing to show."); return; }
      setBoot(data); setStale(s);
      const keep = lastProject();
      setProject(data.projects.find((p) => p.id === keep)?.id ?? data.projects[0]?.id ?? "");
      if (!s) void loadRecent(data);
    });
  }, [loadRecent]);

  if (error) return <SiteFrame><Banner tone="bad">{error}</Banner></SiteFrame>;
  if (!boot) return <SiteFrame><div style={{ color: c.hint, fontSize: 13 }}>Loading…</div></SiteFrame>;

  const q = project ? `?project=${project}` : "";
  const big: React.CSSProperties = { ...sectionCard, minHeight: 84, textDecoration: "none", justifyContent: "center", gap: 2 };
  const current = boot.projects.find((p) => p.id === project);

  return (
    <SiteFrame>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h1 style={{ fontSize: 20, margin: 0, color: c.ink }}>Site</h1>
        <InfoTip label="Site">{SITE_TIPS.home}</InfoTip>
      </div>
      {stale && <Banner tone="warn">No signal. Showing what this phone saved on its last open. You can still capture; it uploads later.</Banner>}
      {boot.projects.length === 0 ? (
        <Banner tone="info">There is no project open for site entry. Ask the project manager to make a contract project active.</Banner>
      ) : (
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: c.hint }}>
          Project
          <select className="bpm-input" value={project} onChange={(e) => { setProject(e.target.value); rememberProject(e.target.value); }} aria-label="Project">
            {boot.projects.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
          </select>
        </label>
      )}

      {boot.modules.receipts && (
        <Link href={`${ROUTES.siteReceiptNew}${q}`} style={big} data-guide="site.home.receive">
          <span style={{ fontSize: 17, fontWeight: 700, color: c.ink }}>Receive delivery</span>
          <span style={{ fontSize: 12.5, color: c.hint }}>{current && current.deliveries.length > 0 ? `${current.deliveries.length} expected` : "Count what arrived"}</span>
        </Link>
      )}
      {boot.modules.expenses && (
        <Link href={`${ROUTES.siteExpenseNew}${q}`} style={big} data-guide="site.home.expense">
          <span style={{ fontSize: 17, fontWeight: 700, color: c.ink }}>Add expense</span>
          <span style={{ fontSize: 12.5, color: c.hint }}>Photo first, three taps</span>
        </Link>
      )}

      <WaitingToUpload onChange={() => void loadRecent(boot)} />

      {(expenses.length > 0 || receipts.length > 0) && (
        <section style={sectionCard} aria-label="Recent">
          <strong style={{ fontSize: 13, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>Recent</strong>
          {receipts.map((r) => (
            <Link key={r.id} href={ROUTES.siteReceipt(r.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 44, textDecoration: "none", color: c.ink, fontSize: 13.5 }}>
              <span><span style={{ fontFamily: MONO, fontSize: 11.5, color: c.hint }}>{r.ref}</span> {r.delivery_note_ref ?? "Delivery"} <span style={{ color: c.hint }}>· {r.lines} item{r.lines === 1 ? "" : "s"}</span></span>
              <StatusPill label={r.status === "cancelled" ? RECEIPT_STATUS_LABEL.cancelled : r.outcome === "complete" ? "Complete" : r.outcome === "partial" ? "Partial" : "Rejected"} tone={r.status === "cancelled" ? "blue" : r.outcome === "complete" ? "green" : r.outcome === "partial" ? "amber" : "red"} />
            </Link>
          ))}
          {expenses.map((e) => (
            <Link key={e.id} href={ROUTES.siteExpense(e.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 44, textDecoration: "none", color: c.ink, fontSize: 13.5 }}>
              <span><span style={{ fontFamily: MONO, fontSize: 11.5, color: c.hint }}>{e.ref}</span> {e.vendor_text ?? e.category_name ?? "Expense"} <span style={{ color: c.hint }}>· {fmtMoney(e.amount, e.currency)}</span></span>
              <StatusPill label={EXPENSE_STATUS_LABEL[e.status]} tone={expenseTone(e.status)} />
            </Link>
          ))}
        </section>
      )}
    </SiteFrame>
  );
}
