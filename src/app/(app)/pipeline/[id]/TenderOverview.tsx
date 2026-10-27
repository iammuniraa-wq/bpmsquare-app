"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SettingsSection from "@/components/settings/SettingsSection";
import BondChip from "@/components/tender/BondChip";
import BondRelease from "@/components/tender/BondRelease";
import OutcomeSection from "@/components/tender/OutcomeSection";
import TenderStatStrip from "@/components/tender/TenderStatStrip";
import { toneTokens } from "@/lib/ui/tone";
import { BOND_STATUS_LABEL, BOND_STEPS, guaranteeRecorded } from "@/lib/tender/bond";
import { TENDER_PORTALS, TENDER_PORTAL_LABEL } from "@/lib/tender/rules";
import { OPPORTUNITY_SOURCES, OPPORTUNITY_SOURCE_LABEL, TEAM_ROLES, TEAM_ROLE_LABEL, type TeamRole } from "@/lib/sales/opportunity";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { ApprovalView } from "@/lib/tender/approval";
import type { OutcomeData } from "@/lib/tender/outcome";
import type { OverdueSummary } from "@/lib/tender/calls";
import type { TenderView } from "@/lib/tender/views";

type Member = { user_id: string; name: string | null; email: string | null };

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

/** A timestamptz as the value of a datetime-local input, in the browser's own zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const money = (amount: number | null, currency: string | null) =>
  amount == null ? "" : `${currency ?? ""} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();

/**
 * The Overview of a tender deal (redesign step 1, docs/design/gcc-tender-deals.md section 21): what the client asked for, the
 * documents, the open work and the bid guarantee, one block each. The blocks are collapsible and remember how they were left; on a
 * phone the first and the open-work block start open, the documents and the guarantee closed. The bid decision and the bid end date
 * live in the header. Saves go to /api/opportunities/[id] (deal fields), .../tender (tender fields) and .../tender/bond (guarantee state).
 */
export default function TenderOverview({
  opportunityId, deal, tender, approval, room, accounts, members, contacts, currentUserId, nowIso, timezone, finished, sourceEmail,
  outcome, overdue, unpricedLines, canEdit, fmt, onError, onNotice, onOpenHistory,
}: {
  opportunityId: string;
  deal: { title: string; description: string; contact_id: string; owner_id: string; source: string; team: { user_id: string; role: string }[]; created_at: string; closed_at: string | null };
  tender: TenderView;
  /** null while migration 0221 is pending. */
  approval: ApprovalView | null;
  /** Set when the Deal Room is on: the open-question count and the way into the room. */
  room?: { openQuestions: number; onOpen: (filter: "all" | "questions") => void } | null;
  accounts: { id: string; name: string }[];
  members: Member[];
  contacts: { id: string; name: string }[];
  currentUserId: string;
  nowIso: string;
  timezone: string;
  /** The bid is in or the tender is closed: the bid end date is a date, not a countdown. */
  finished: boolean;
  /** The source email and its files, drawn by the server (renders nothing when the deal did not come from an email). */
  sourceEmail?: React.ReactNode;
  outcome?: OutcomeData | null;
  overdue?: OverdueSummary | null;
  onOpenHistory?: () => void;
  /** Saved lines still without a price (the lines are already on the page, so this costs no query). */
  unpricedLines: number;
  /** The caller may change the deal (edit access to the Pipeline); the server decides anyway. */
  canEdit: boolean;
  fmt?: (n: number) => string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    tender_no: tender.tender_no ?? "", issuer_name: tender.issuer_name ?? "", issuer_account_id: tender.issuer_account_id ?? "",
    portal: tender.portal ?? "", closing_at: "",
    title: deal.title, description: deal.description, contact_id: deal.contact_id, owner_id: deal.owner_id, source: deal.source, team: deal.team,
    addenda_count: tender.addenda_count ?? 0,
    bid_bond_amount: tender.bid_bond_amount != null ? String(tender.bid_bond_amount) : "", bid_bond_currency: tender.bid_bond_currency ?? "",
    bid_bond_expiry: tender.bid_bond_expiry ?? "",
  });

  // The browser's own zone is only known after mount; reading it during render would make the server and client pages differ.
  useEffect(() => { setForm((f) => ({ ...f, closing_at: toLocalInput(tender.closing_at) })); }, [tender.closing_at]);
  useEffect(() => { setForm((f) => ({ ...f, addenda_count: tender.addenda_count ?? 0 })); }, [tender.addenda_count]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function send(url: string, method: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { onError(j.error ?? "Could not save"); return false; }
    return true;
  }

  function saveAsked() {
    startTransition(async () => {
      onError(""); onNotice("");
      const tenderOk = await send(`/api/opportunities/${opportunityId}/tender`, "PATCH", {
        tender_no: form.tender_no || null, issuer_name: form.issuer_name || null, issuer_account_id: form.issuer_account_id || null, portal: form.portal || null,
        closing_at: form.closing_at ? new Date(form.closing_at).toISOString() : null,
      });
      if (!tenderOk) return;
      const dealOk = await send(`/api/opportunities/${opportunityId}`, "PATCH", {
        title: form.title, description: form.description, contact_id: form.contact_id || null, owner_id: form.owner_id || null, source: form.source, team: form.team,
      });
      if (!dealOk) return;
      onNotice("Saved");
      router.refresh();
    });
  }

  function saveCounter() {
    startTransition(async () => {
      onError(""); onNotice("");
      if (!(await send(`/api/opportunities/${opportunityId}/tender`, "PATCH", { addenda_count: form.addenda_count }))) return;
      onNotice("Change requests saved");
      router.refresh();
    });
  }

  function saveGuarantee() {
    startTransition(async () => {
      onError(""); onNotice("");
      if (!(await send(`/api/opportunities/${opportunityId}/tender`, "PATCH", {
        bid_bond_amount: form.bid_bond_amount === "" ? null : form.bid_bond_amount, bid_bond_currency: form.bid_bond_currency || null, bid_bond_expiry: form.bid_bond_expiry || null,
      }))) return;
      onNotice("Bid guarantee saved");
      router.refresh();
    });
  }

  function setState(status: string) {
    startTransition(async () => {
      onError(""); onNotice("");
      if (!(await send(`/api/opportunities/${opportunityId}/tender/bond`, "POST", { action: "set_status", status }))) return;
      onNotice(`Bid guarantee: ${BOND_STATUS_LABEL[status as keyof typeof BOND_STATUS_LABEL]}`);
      router.refresh();
    });
  }

  function releaseGuarantee() {
    startTransition(async () => {
      onError(""); onNotice("");
      if (!(await send(`/api/opportunities/${opportunityId}/tender/bond`, "POST", { action: "release" }))) return;
      onNotice("Bid guarantee released");
      router.refresh();
    });
  }

  const released = tender.bond_status === "released";
  const recorded = guaranteeRecorded({ bid_bond_amount: tender.bid_bond_amount, bid_bond_expiry: tender.bid_bond_expiry, bond_status: tender.bond_status });
  const shownState = tender.bond_status === "held" ? "issued" : tender.bond_status;
  const canRelease = !released && (tender.bid_bond_amount != null || !!tender.bid_bond_expiry);
  const guaranteeSummary = released ? "Released" : recorded
    ? [BOND_STATUS_LABEL[tender.bond_status], tender.bid_bond_amount != null ? money(tender.bid_bond_amount, tender.bid_bond_currency) : null, tender.bid_bond_expiry ? `valid to ${fmtDate(tender.bid_bond_expiry)}` : null].filter(Boolean).join(" · ")
    : "No guarantee recorded";

  const openQuestions = room?.openQuestions ?? 0;
  const overdueSteps = overdue?.count ?? 0;
  const openTotal = openQuestions + overdueSteps + unpricedLines;
  const asked = [tender.tender_no, tender.issuer_name, tender.portal ? TENDER_PORTAL_LABEL[tender.portal] : null].filter(Boolean).join(" · ") || "Nothing filled in yet";
  const issuerAccount = accounts.find((a) => a.id === form.issuer_account_id) ?? null;
  const memberLabel = (m: Member) => m.name ?? m.email ?? m.user_id.slice(0, 8);

  // A button that needs a look takes the tone's tint; a quiet one stays plain. Tone tokens only.
  const needs = (n: number, tone: "warn" | "bad" = "warn"): React.CSSProperties => {
    if (n <= 0) return { minHeight: 44 };
    const t = toneTokens(tone);
    return { minHeight: 44, background: t.bg, color: t.ink, borderColor: t.edge };
  };

  return (
    <div data-guide="tender.tab" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <TenderStatStrip
        closingAt={tender.closing_at} nowIso={nowIso} timezone={timezone} finished={finished} decision={tender.decision}
        approvalPending={approval?.pending?.decision ?? null}
        bond={{ amount: tender.bid_bond_amount, expiry: tender.bid_bond_expiry, status: tender.bond_status }}
        openQuestions={room ? openQuestions : null} overdueSteps={overdueSteps}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))", gap: 12, alignItems: "start" }}>
        <SettingsSection id="tender.asked" title="What the client asked for" summary={asked} defaultOpen defaultOpenNarrow>
          <div className="fg2">
            <Field label="Title" guide="tender.field.title" style={{ gridColumn: "1 / -1" }}><Input value={form.title} onChange={set("title")} maxLength={200} /></Field>
            <Field label="Tender number" info={TENDER_TIPS.tenderNo} guide="tender.field.tender_no"><Input value={form.tender_no} onChange={set("tender_no")} maxLength={60} /></Field>
            <Field label="Issuer" info={TENDER_TIPS.issuer} guide="tender.field.issuer"><Input value={form.issuer_name} onChange={set("issuer_name")} maxLength={200} /></Field>
            <Field label="Issuer account" guide="tender.field.issuer_account">
              <Select value={form.issuer_account_id} onChange={set("issuer_account_id")}>
                <option value="">— None —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
              {issuerAccount && (
                <Link href={ROUTES.account(issuerAccount.id)} data-guide="tender.field.issuer_account_link" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: c.accent, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                  Open {issuerAccount.name}
                </Link>
              )}
            </Field>
            <Field label="Portal" info={TENDER_TIPS.portal} guide="tender.field.portal">
              <Select value={form.portal} onChange={set("portal")}>
                <option value="">— Not set —</option>
                {TENDER_PORTALS.map((p) => <option key={p} value={p}>{TENDER_PORTAL_LABEL[p]}</option>)}
              </Select>
            </Field>
            <Field label="Bid end date" info={TENDER_TIPS.closing} guide="tender.field.closing"><Input type="datetime-local" value={form.closing_at} onChange={set("closing_at")} /></Field>
            <Field label="Contact" guide="tender.field.contact">
              <Select value={form.contact_id} onChange={set("contact_id")}>
                <option value="">— None —</option>{contacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
              </Select>
            </Field>
            <Field label="Owner" guide="tender.field.owner">
              <Select value={form.owner_id} onChange={set("owner_id")}>
                <option value="">— Unassigned —</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberLabel(m)}</option>)}
              </Select>
            </Field>
            <Field label="Source" info={TENDER_TIPS.source} guide="tender.field.source">
              <Select value={form.source} onChange={set("source")}>
                {OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{OPPORTUNITY_SOURCE_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="Description" guide="tender.field.description" style={{ gridColumn: "1 / -1" }}><Textarea style={{ minHeight: 70 }} value={form.description} onChange={set("description")} /></Field>
          </div>
          <div data-guide="tender.team">
            <div style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Team</div>
            {form.team.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <Select style={{ flex: "1 1 180px", width: "auto" }} aria-label="Team member" value={t.user_id} onChange={(e) => setForm((f) => ({ ...f, team: f.team.map((x, j) => (j === i ? { ...x, user_id: e.target.value } : x)) }))}>
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{memberLabel(m)}</option>)}
                </Select>
                <Select style={{ flex: "0 1 180px", width: "auto" }} aria-label="Team role" value={t.role} onChange={(e) => setForm((f) => ({ ...f, team: f.team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) }))}>
                  {TEAM_ROLES.map((r) => <option key={r} value={r}>{TEAM_ROLE_LABEL[r as TeamRole]}</option>)}
                </Select>
                <Button variant="quiet" iconOnly aria-label="Remove team member" style={{ minWidth: 44, minHeight: 44 }} onClick={() => setForm((f) => ({ ...f, team: f.team.filter((_, j) => j !== i) }))}>×</Button>
              </div>
            ))}
            <Button variant="quiet" size="sm" style={{ minHeight: 44 }} onClick={() => setForm((f) => ({ ...f, team: [...f.team, { user_id: members.find((m) => !f.team.some((t) => t.user_id === m.user_id))?.user_id ?? currentUserId, role: "sales" }] }))}>+ Add someone</Button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Button variant="primary" loading={pending} data-guide="tender.save" style={{ minHeight: 44 }} onClick={saveAsked}>Save</Button>
            <span style={{ fontSize: 11, color: c.hint }}>Created {fmtDate(deal.created_at)}{deal.closed_at ? ` · closed ${fmtDate(deal.closed_at)}` : ""}</span>
          </div>
        </SettingsSection>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <SettingsSection id="tender.documents" title="Documents" info={TENDER_TIPS.documents} summary={`${form.addenda_count} change request${form.addenda_count === 1 ? "" : "s"}`} defaultOpen defaultOpenNarrow={false}>
            <div data-guide="tender.documents" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {sourceEmail}
              <Field label="Change requests" info={TENDER_TIPS.addenda} guide="tender.field.addenda">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Button type="button" variant="secondary" iconOnly aria-label="One fewer change request" disabled={form.addenda_count <= 0} onClick={() => setForm((f) => ({ ...f, addenda_count: Math.max(0, f.addenda_count - 1) }))} style={{ minWidth: 44, minHeight: 44 }}>−</Button>
                  <span style={{ minWidth: 28, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} aria-live="polite">{form.addenda_count}</span>
                  <Button type="button" variant="secondary" iconOnly aria-label="One more change request" onClick={() => setForm((f) => ({ ...f, addenda_count: f.addenda_count + 1 }))} style={{ minWidth: 44, minHeight: 44 }}>+</Button>
                  {form.addenda_count !== (tender.addenda_count ?? 0) && (
                    <Button variant="primary" loading={pending} data-guide="tender.addenda.save" style={{ minHeight: 44 }} onClick={saveCounter}>Save</Button>
                  )}
                </div>
              </Field>
            </div>
          </SettingsSection>

          <SettingsSection id="tender.open_work" title="Open work" info={TENDER_TIPS.openWork} summary={openTotal === 0 ? "Nothing open" : `${openTotal} open`} defaultOpen defaultOpenNarrow>
            <div data-guide="tender.open_work" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {room && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Button size="sm" variant="secondary" data-guide="tender.open_questions" style={needs(openQuestions)} onClick={() => room.onOpen("questions")}>
                    {openQuestions} open question{openQuestions === 1 ? "" : "s"}
                  </Button>
                  <InfoTip label="Open questions">{TENDER_TIPS.roomQuestionsLink}</InfoTip>
                </span>
              )}
              {overdue && overdueSteps > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Button size="sm" variant="secondary" data-guide="tender.overdue_steps" title={overdue.first ?? undefined} style={needs(overdueSteps, "bad")} onClick={onOpenHistory}>
                    {overdueSteps} overdue next step{overdueSteps === 1 ? "" : "s"}
                  </Button>
                  <InfoTip label="Overdue next steps">{TENDER_TIPS.callOverdue}</InfoTip>
                </span>
              )}
              <span data-guide="tender.unpriced" style={{ border: "1px solid var(--line)", ...needs(unpricedLines), display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                {unpricedLines} line{unpricedLines === 1 ? "" : "s"} without a price
              </span>
              {openTotal === 0 && <span style={{ fontSize: 12.5, color: c.hint }}>Nothing is waiting for you.</span>}
            </div>
          </SettingsSection>

          <SettingsSection id="tender.guarantee" title="Bid guarantee" info={TENDER_TIPS.bond} summary={guaranteeSummary} defaultOpen defaultOpenNarrow={false}>
            <div className="fg2">
              <Field label="State" info={TENDER_TIPS.bondState} guide="tender.field.bond_state">
                {released || !canEdit ? (
                  <div style={{ minHeight: 44, display: "flex", alignItems: "center", fontWeight: 600 }}>{BOND_STATUS_LABEL[tender.bond_status]}</div>
                ) : (
                  <Select value={shownState} disabled={pending} aria-label="Bid guarantee state" onChange={(e) => setState(e.target.value)}>
                    {BOND_STEPS.map((s) => <option key={s} value={s}>{BOND_STATUS_LABEL[s]}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Amount" guide="tender.field.bond_amount"><Input type="number" min="0" step="0.01" inputMode="decimal" value={form.bid_bond_amount} onChange={set("bid_bond_amount")} /></Field>
              <Field label="Currency" guide="tender.field.bond_currency"><Input value={form.bid_bond_currency} onChange={set("bid_bond_currency")} maxLength={3} placeholder="SAR" style={{ textTransform: "uppercase" }} /></Field>
              <Field label="Valid until" guide="tender.field.bond_expiry"><Input type="date" value={form.bid_bond_expiry} onChange={set("bid_bond_expiry")} /></Field>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Button variant="primary" loading={pending} data-guide="tender.bond.save" style={{ minHeight: 44 }} onClick={saveGuarantee}>Save</Button>
              {canRelease && canEdit && <BondRelease loading={pending} onConfirm={releaseGuarantee} />}
              <BondChip amount={tender.bid_bond_amount} expiry={tender.bid_bond_expiry} status={tender.bond_status} nowIso={nowIso} timezone={timezone} />
              {released && tender.bond_released_at && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{[tender.bond_released_by_name, fmtDate(tender.bond_released_at)].filter(Boolean).join(" · ")}</span>
              )}
            </div>
          </SettingsSection>
        </div>
      </div>

      {outcome && <OutcomeSection opportunityId={opportunityId} data={outcome} fmt={fmt ?? ((n) => String(n))} onError={onError} onNotice={onNotice} onChanged={() => router.refresh()} />}
    </div>
  );
}
