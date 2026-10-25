"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { useCurrency } from "@/lib/tenant-context";
import { formatMoney } from "@/lib/currency";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES, LOSS_REASONS, LOSS_REASON_LABEL, type OpportunityStageDef } from "@/lib/constants";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import { daysBetween, weightedValue, isClosedStage, outcomeForStage, OPPORTUNITY_SOURCES, OPPORTUNITY_SOURCE_LABEL, TEAM_ROLES, TEAM_ROLE_LABEL, type TeamRole } from "@/lib/sales/opportunity";
import type { LinkedQuote } from "@/lib/sales/opportunityServer";
import { documentTotal } from "@/lib/sales/lineTotals";
import { useUnsavedChangesGuard } from "@/lib/unsavedChanges";
import DocumentLinesEditor, { newLine, lineAmount, type Line, type StandardQuoteProduct } from "@/components/sales/DocumentLinesEditor";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import Tabs from "@/components/ui/Tabs";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import MoreMenu from "@/components/ui/MoreMenu";
import StatusPill from "@/components/ui/StatusPill";
import { Input, Select, Textarea } from "@/components/ui/Input";
import RecordFacts from "@/components/page/RecordFacts";
import ClosingChip from "@/components/tender/ClosingChip";
import { TENDER_DECISION_LABEL, tenderIsLive } from "@/lib/tender/rules";
import type { TenderView } from "@/lib/tender/views";
import type { ApprovalView } from "@/lib/tender/approval";
import TenderTab from "./TenderTab";
import DealRoom from "@/components/tender/DealRoom";

// The deal page (§4.5): the record-page look (header with one primary step and
// the "..." menu, facts, tabs) built client-side, because the Lines editor and
// the header form keep unsaved state across tab switches -- so the tabs here
// are state, not ?tab=. Tabs: Overview · Lines · Quotes · Related · Activity.

type Member = { user_id: string; name: string | null; email: string | null };
type Tab = "overview" | "tender" | "room" | "lines" | "quotes" | "related" | "activity";

/** A tender deal's extras (GCC tender deals): its tender block and what the countdown needs. Absent for every other deal. */
export type TenderTabData = {
  view: TenderView;
  /** The Deal Room, when the workspace has the deal_room flag: its unread and open-question counts. null = no room on this workspace. */
  room: { pending: boolean; unread: number; openQuestions: number; isAdmin: boolean } | null; /** null while migration 0221 is pending. */ approval: ApprovalView | null; accounts: { id: string; name: string }[]; nowIso: string; timezone: string;
};

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function toEditorLines(rows: OpportunityLine[]): Line[] {
  return rows.map((l) => ({
    id: l.id, description: l.description, uom: l.uom ?? "Nos", qty: String(l.qty), rate: String(l.rate), discount_pct: String(l.discount_pct),
    product_id: l.product_id ?? "", pricing_document_id: l.pricing_document_id ?? "", rfq_line_id: (l as { rfq_line_id?: string | null }).rfq_line_id ?? "",
    group_id: l.group_id ?? "", group_label: l.group_label ?? "", group_type: l.group_type === "alternative" ? "alternative" : "",
    break_of: l.break_of ?? "", break_qty: l.break_qty != null ? String(l.break_qty) : "",
    is_selected: l.is_selected !== false, show_on_pdf: l.show_on_pdf !== false,
  }));
}

export default function OpportunityDetailClient({ opp, accountName, contacts, initialLines, quotes, stages, members, products, pricingEnabled, standardQuotesEnabled, todayKey, currentUserId, related, activity, externalLine, tender, sourceEmail }: {
  opp: Opportunity & { stage_since: string };
  accountName: string;
  contacts: { id: string; name: string }[];
  initialLines: OpportunityLine[];
  quotes: LinkedQuote[];
  stages: OpportunityStageDef[];
  members: Member[];
  products: StandardQuoteProduct[];
  pricingEnabled: boolean;
  standardQuotesEnabled: boolean;
  todayKey: string;
  currentUserId: string;
  /** The deal's RFQ card, when the RFQ module is on. */
  related?: React.ReactNode;
  /** Read-only link line to the connected system's record (ExternalRecordSlot), drawn under the facts. */
  externalLine?: React.ReactNode;
  /** The Activity tab (Nova timeline + change history). */
  activity: React.ReactNode;
  /** Set only for a tender deal: adds the Tender tab and the closing / decision facts. */
  tender?: TenderTabData | null;
  /** "From email" for a tender made from an Inbox message (renders nothing otherwise). */
  sourceEmail?: React.ReactNode;
}) {
  const cur = useCurrency();
  const inr = (n: number) => formatMoney(Math.round(n), cur, {});
  const router = useRouter();
  const { confirm } = useFeel();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>(tender ? "tender" : initialLines.length === 0 && quotes.length === 0 ? "overview" : "lines");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [roomFilter, setRoomFilter] = useState<"all" | "questions">("all");
  const [roomOpen, setRoomOpen] = useState(tender?.room?.openQuestions ?? 0);
  const [roomUnread, setRoomUnread] = useState(tender?.room?.unread ?? 0);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Header fields, saved together.
  const [form, setForm] = useState({
    title: opp.title, description: opp.description ?? "", contact_id: opp.contact_id ?? "", expected_close: opp.expected_close ?? "",
    owner_id: opp.owner_id ?? "", source: opp.source ?? "direct", competitor: opp.competitor ?? "",
    probability_override: opp.probability_override != null ? String(opp.probability_override) : "", probability_override_reason: opp.probability_override_reason ?? "",
    team: (opp.team ?? []) as { user_id: string; role: string }[],
  });
  const [closing, setClosing] = useState<{ stage: string; outcome: "won" | "lost" | "dropped"; loss_reason: string; loss_note: string } | null>(null);

  // Lines tab: the shared editor, saved as one PUT.
  const [lines, setLines] = useState<Line[]>(initialLines.length > 0 ? toEditorLines(initialLines) : [newLine()]);
  const [savedLinesKey, setSavedLinesKey] = useState(JSON.stringify(lines));
  const linesDirty = JSON.stringify(lines) !== savedLinesKey;
  useUnsavedChangesGuard(linesDirty, { body: "The deal's lines have unsaved edits. If you leave now they will be lost." });
  const linesTotal = documentTotal(lines.map((l) => ({ id: l.id, amount: lineAmount(l), group_id: l.group_id || null, group_type: l.group_type || null, break_of: l.break_of || null, is_selected: l.is_selected })));
  const lineCount = lines.filter((l) => l.description.trim() && !l.break_of).length;

  const stageDefNow = stages.find((s) => s.value === opp.stage);
  const closed = isClosedStage(stages, opp.stage) || opp.outcome !== "open";
  const memberName = (id: string | null) => { const m = members.find((x) => x.user_id === id); return m?.name ?? m?.email ?? "—"; };

  async function patch(body: Record<string, unknown>, okMessage?: string) {
    setError(""); setNotice("");
    const res = await fetch(`/api/opportunities/${opp.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not save"); return false; }
    if (okMessage) setNotice(okMessage);
    router.refresh();
    return true;
  }

  function saveHeader() {
    startTransition(async () => {
      await patch({
        title: form.title, description: form.description, contact_id: form.contact_id || null, expected_close: form.expected_close || null,
        owner_id: form.owner_id || null, source: form.source, competitor: form.competitor,
        probability_override: form.probability_override === "" ? null : Number(form.probability_override),
        probability_override_reason: form.probability_override_reason, team: form.team,
      }, "Saved");
    });
  }

  function changeStage(stage: string) {
    if (stage === opp.stage) return;
    if (isClosedStage(stages, stage)) {
      const implied = outcomeForStage(stages, stage);
      setClosing({ stage, outcome: implied === "open" ? "won" : implied, loss_reason: "price", loss_note: "" });
      return;
    }
    startTransition(async () => { await patch({ stage, outcome: "open" }); });
  }

  function saveLines() {
    const clean = lines.filter((l) => l.description.trim());
    startTransition(async () => {
      setError(""); setNotice("");
      const res = await fetch(`/api/opportunities/${opp.id}/lines`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: clean.map((l) => ({
          local_id: l.id, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct,
          product_id: l.product_id || null, pricing_document_id: l.pricing_document_id || null, rfq_line_id: l.rfq_line_id || null,
          group_id: l.group_id || null, group_label: l.group_label || null, group_type: l.group_type || null,
          break_of: l.break_of || null, break_qty: l.break_qty ? parseFloat(l.break_qty) || null : null,
          is_selected: l.is_selected, show_on_pdf: l.show_on_pdf,
        })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save the lines"); return; }
      const next = toEditorLines((j.lines ?? []) as OpportunityLine[]);
      setLines(next.length ? next : [newLine()]);
      setSavedLinesKey(JSON.stringify(next.length ? next : [newLine()]));
      setNotice(`Lines saved · deal amount ${inr(j.amount ?? 0)}`);
      router.refresh();
    });
  }

  function convert() {
    startTransition(async () => {
      if (linesDirty && !(await confirm({ title: "Save the lines first?", body: "The quote is created from the SAVED lines. Unsaved edits here won't be on it.", confirmLabel: "Convert anyway" }))) return;
      setError(""); setNotice("");
      const res = await fetch(`/api/opportunities/${opp.id}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "standard_quote" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not create the quote"); return; }
      router.push(ROUTES.standardQuote(j.id));
    });
  }

  async function remove() {
    if (!(await confirm({ title: `Delete ${opp.ref ?? "this deal"}?`, body: "Linked quotes stay; only the deal goes.", tone: "danger" }))) return;
    startTransition(async () => {
      const res = await fetch(`/api/opportunities/${opp.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.pipeline);
      else setError("Could not delete");
    });
  }

  const markWon = () => setClosing({ stage: stages.find((s) => s.is_closed && (s.outcome ?? "won") === "won")?.value ?? opp.stage, outcome: "won", loss_reason: "price", loss_note: "" });
  const markLost = () => setClosing({ stage: stages.find((s) => s.is_closed && s.outcome === "lost")?.value ?? opp.stage, outcome: "lost", loss_reason: "price", loss_note: "" });
  const reopen = () => startTransition(async () => { await patch({ stage: stages.find((s) => !s.is_closed)?.value ?? opp.stage, outcome: "open" }, "Reopened"); });

  const canConvert = !closed && standardQuotesEnabled;
  // One primary step: convert to a quote when that module is on, else close
  // the deal as won; a closed deal has none (Reopen is in the menu).
  const primary = canConvert
    ? <Button variant="primary" onClick={convert} loading={pending}>Convert to Standard Quote</Button>
    : !closed
      ? <Button variant="primary" onClick={markWon}>Mark won</Button>
      : null;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    ...(tender ? [{ id: "tender" as Tab, label: "Tender" }] : []),
    ...(tender?.room ? [{ id: "room" as Tab, label: "Room", count: tab === "room" ? 0 : roomUnread }] : []),
    { id: "lines", label: linesDirty ? "Lines •" : "Lines", count: lineCount },
    { id: "quotes", label: "Quotes", count: quotes.length },
    ...(related ? [{ id: "related" as Tab, label: "Related" }] : []),
    { id: "activity", label: "Activity" },
  ];

  const outcomeLabel = closed ? `${opp.outcome}${opp.loss_reason ? ` (${LOSS_REASON_LABEL[opp.loss_reason]})` : ""}` : null;

  // Tender deal: the closing date and the bid decision take the place of probability and owner in the header strip
  // (the owner is on the Overview tab). The countdown stops once the bid is in or the tender is closed.
  const tenderLive = tender ? tenderIsLive(opp, tender.view) : false;
  const tenderFacts = tender
    ? [
        { label: "Closing", value: <ClosingChip closingAt={tender.view.closing_at} nowIso={tender.nowIso} timezone={tender.timezone} closed={!tenderLive} /> },
        {
          label: "Decision",
          value: tender.view.decision
            ? <>{TENDER_DECISION_LABEL[tender.view.decision]}<div style={{ fontSize: 11, fontWeight: 400, color: c.hint }}>{[tender.view.decided_by_name, fmtDate(tender.view.decided_at)].filter((x) => x && x !== "—").join(" · ")}</div></>
            : tender.approval?.pending
              ? <>Awaiting approval<div style={{ fontSize: 11, fontWeight: 400, color: c.hint }}>{TENDER_DECISION_LABEL[tender.approval.pending.decision]} proposed</div></>
              : <span style={{ color: c.hint, fontWeight: 400 }}>Not decided</span>,
        },
      ]
    : null;

  return (
    <div>
      <TabTitle title={opp.title} />
      <div style={{ marginBottom: 8 }}>
        <Link href={tender ? `${ROUTES.pipeline}?tab=tenders` : ROUTES.pipeline} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>← Pipeline</Link>
      </div>
      <PageHeader
        title={opp.title}
        subtitle={[opp.ref, accountName, opp.expected_close ? `close by ${fmtDate(opp.expected_close)}` : null].filter(Boolean).join(" · ")}
        badge={
          <>
            <StatusPill label={stageDefNow?.label ?? opp.stage} tone="blue" />
            {outcomeLabel && <StatusPill label={outcomeLabel} tone={opp.outcome === "won" ? "green" : "red"} />}
          </>
        }
        action={
          <>
            {primary}
            <MoreMenu
              items={[
                { label: "Mark won", onSelect: markWon, hidden: closed || !canConvert },
                { label: "Mark lost", onSelect: markLost, hidden: closed },
                { label: "Reopen", onSelect: reopen, hidden: !closed },
                { label: "Delete", danger: true, onSelect: () => { void remove(); } },
              ]}
            />
          </>
        }
      />

      <RecordFacts
        facts={[
          { label: "Amount", value: <>{inr(Number(opp.amount || 0))}<div style={{ fontSize: 11, fontWeight: 400, color: c.hint }}>{quotes.length > 0 ? "latest quote" : "lines total"}</div></> },
          {
            label: "Stage",
            value: (
              <Select value={opp.stage} onChange={(e) => changeStage(e.target.value)} disabled={pending} aria-label="Stage" style={{ borderColor: stageDefNow?.color ?? undefined }}>
                {stages.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            ),
          },
          ...(tenderFacts ?? [
            { label: "Probability", value: <>{opp.probability ?? 0}%<div style={{ fontSize: 11, fontWeight: 400, color: c.hint }}>weighted {inr(weightedValue(Number(opp.amount || 0), opp.probability ?? 0))}</div></> },
            { label: "Owner", value: <>{memberName(opp.owner_id)}<div style={{ fontSize: 11, fontWeight: 400, color: c.hint }}>{daysBetween(opp.stage_since, todayKey)}d in {stageDefNow?.label ?? opp.stage}</div></> },
          ]),
        ]}
      />

      {externalLine}

      {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)", marginBottom: 10 }}>{error}</div>}
      {notice && <div role="status" style={{ background: "var(--tealbg)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--tealink)", marginBottom: 10 }}>{notice}</div>}

      <div style={{ marginBottom: 14 }}>
        <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as Tab)} />
      </div>

      {tab === "tender" && tender && (
        <TenderTab
          opportunityId={opp.id} stage={opp.stage} tender={tender.view} approval={tender.approval} accounts={tender.accounts} nowIso={tender.nowIso} timezone={tender.timezone}
          finished={!tenderLive} onError={setError} onNotice={setNotice}
          room={tender.room && !tender.room.pending ? { openQuestions: roomOpen, onOpen: (f) => { setRoomFilter(f); setTab("room"); } } : null}
        />
      )}
      {tab === "room" && tender?.room && (
        tender.room.pending ? (
          <div role="alert" data-guide="room.pending_migration" style={{ fontSize: 13, color: "var(--amberink)" }}>The Deal Room needs a database update (migration 0222). Ask your administrator to apply it.</div>
        ) : narrow ? (
          <Card padding={18}>
            <div data-guide="room.open_full" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, color: c.muted }}>{roomOpen} open question{roomOpen === 1 ? "" : "s"}{roomUnread > 0 ? ` · ${roomUnread} unread` : ""}</div>
              <Button href={`${ROUTES.pipelineDetail(opp.id)}/room`} variant="primary" style={{ minHeight: 44 }}>Open the room</Button>
            </div>
          </Card>
        ) : (
          <DealRoom
            opportunityId={opp.id} currentUserId={currentUserId} isAdmin={tender.room.isAdmin} todayKey={todayKey} initialFilter={roomFilter}
            onSeen={() => setRoomUnread(0)} onOpenQuestions={setRoomOpen}
          />
        )
      )}
      {tab === "tender" && tender && sourceEmail}

      {tab === "overview" && (
        <Card padding={18}>
          <div className="fg2">
            <Field label="Title" style={{ gridColumn: "1 / -1" }}><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Contact">
              <Select value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">— None —</option>{contacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
              </Select>
            </Field>
            <Field label="Expected close"><Input type="date" value={form.expected_close} onChange={(e) => setForm({ ...form, expected_close: e.target.value })} /></Field>
            <Field label="Owner">
              <Select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
                <option value="">— Unassigned —</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
              </Select>
            </Field>
            <Field label="Source">
              <Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{OPPORTUNITY_SOURCE_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="Competitor"><Input value={form.competitor} onChange={(e) => setForm({ ...form, competitor: e.target.value })} /></Field>
            <Field label="Probability override %"><Input type="number" min="0" max="100" value={form.probability_override} onChange={(e) => setForm({ ...form, probability_override: e.target.value })} placeholder={`${stageDefNow?.probability_hint ?? 0} from the stage`} /></Field>
            <Field label="Why the override" style={{ gridColumn: "1 / -1" }}><Input value={form.probability_override_reason} onChange={(e) => setForm({ ...form, probability_override_reason: e.target.value })} placeholder="Only needed when you override" /></Field>
            <Field label="Description" style={{ gridColumn: "1 / -1" }}><Textarea style={{ minHeight: 70 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Team</div>
            {form.team.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <Select style={{ flex: "1 1 180px", width: "auto" }} aria-label="Team member" value={t.user_id} onChange={(e) => setForm({ ...form, team: form.team.map((x, j) => (j === i ? { ...x, user_id: e.target.value } : x)) })}>
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
                </Select>
                <Select style={{ flex: "0 1 180px", width: "auto" }} aria-label="Team role" value={t.role} onChange={(e) => setForm({ ...form, team: form.team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })}>
                  {TEAM_ROLES.map((r) => <option key={r} value={r}>{TEAM_ROLE_LABEL[r as TeamRole]}</option>)}
                </Select>
                <Button variant="quiet" iconOnly aria-label="Remove team member" onClick={() => setForm({ ...form, team: form.team.filter((_, j) => j !== i) })}>×</Button>
              </div>
            ))}
            <Button variant="quiet" size="sm" onClick={() => setForm({ ...form, team: [...form.team, { user_id: members.find((m) => !form.team.some((t) => t.user_id === m.user_id))?.user_id ?? currentUserId, role: "sales" }] })}>+ Add someone</Button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="primary" onClick={saveHeader} loading={pending}>{pending ? "Saving…" : "Save"}</Button>
            <span style={{ fontSize: 11, color: c.hint }}>Created {fmtDate(opp.created_at)}{opp.closed_at ? ` · closed ${fmtDate(opp.closed_at)}` : ""}</span>
          </div>
        </Card>
      )}

      {tab === "lines" && (
        <Card padding={16}>
          <DocumentLinesEditor
            lines={lines} onChange={setLines} products={products} pricingEnabled={pricingEnabled}
            accountId={opp.account_id} accountName={accountName} documentType="opportunity" documentId={opp.id} documentRef={opp.ref ?? undefined} onError={setError}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, borderTop: `1px solid ${c.line}`, paddingTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: c.muted }}>Lines total <b style={{ color: c.ink }}>{inr(linesTotal)}</b>{quotes.length > 0 ? " · the deal amount follows its latest quote" : ""}</span>
            <span style={{ marginLeft: "auto" }} />
            {linesDirty && <span style={{ fontSize: 11.5, color: "var(--amberink)" }}>Unsaved changes</span>}
            {canConvert && <Button variant="secondary" onClick={convert} disabled={pending}>Convert to Standard Quote</Button>}
            <Button variant="primary" onClick={saveLines} disabled={!linesDirty} loading={pending}>{pending ? "Saving…" : "Save lines"}</Button>
          </div>
        </Card>
      )}

      {tab === "quotes" && (
        <Card padding={16}>
          {quotes.length === 0 ? (
            <div style={{ fontSize: 12.5, color: c.hint, padding: "8px 0" }}>No quote yet. Convert the deal to a Standard Quote, or link one from the quote&apos;s own page.</div>
          ) : (
            <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden" }}>
              {quotes.map((q, i) => (
                <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 13, flexWrap: "wrap" }}>
                  <Link href={q.object === "standard_quote" ? ROUTES.standardQuote(q.id) : ROUTES.quotation(q.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>{q.ref}</Link>
                  <span style={{ fontSize: 11.5, color: c.hint }}>{q.object === "standard_quote" ? "Standard Quote" : "Quotation"} · {fmtDate(q.created_at)}{i === 0 ? " · latest" : ""}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "capitalize" }}>{q.status}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{inr(q.subtotal)}</span>
                </div>
              ))}
            </div>
          )}
          {canConvert && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Button variant="primary" onClick={convert} loading={pending}>Convert to Standard Quote</Button>
              <span style={{ fontSize: 11.5, color: c.hint }}>Copies the saved lines and re-prices product lines on today&apos;s date.</span>
            </div>
          )}
        </Card>
      )}

      {tab === "related" && related}
      {tab === "activity" && activity}

      {closing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setClosing(null)}>
          <div style={{ width: 380, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
            <Card padding={18}>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.ink, marginBottom: 10 }}>Close this deal as…</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {(["won", "lost", "dropped"] as const).map((o) => (
                  <Button key={o} variant={closing.outcome === o ? "primary" : "secondary"} size="sm" style={{ flex: 1, textTransform: "capitalize" }}
                    onClick={() => setClosing({ ...closing, outcome: o, stage: stages.find((s) => s.is_closed && (s.outcome ?? "won") === (o === "dropped" ? "lost" : o))?.value ?? closing.stage })}>{o}</Button>
                ))}
              </div>
              {closing.outcome !== "won" && (
                <>
                  <Select value={closing.loss_reason} onChange={(e) => setClosing({ ...closing, loss_reason: e.target.value })} aria-label="Loss reason" style={{ marginBottom: 8 }}>
                    {LOSS_REASONS.map((r) => <option key={r} value={r}>{LOSS_REASON_LABEL[r]}</option>)}
                  </Select>
                  <Input value={closing.loss_note} onChange={(e) => setClosing({ ...closing, loss_note: e.target.value })} placeholder="What happened (optional)" style={{ marginBottom: 8 }} />
                </>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button variant="secondary" onClick={() => setClosing(null)}>Cancel</Button>
                <Button variant="primary" loading={pending} onClick={() => { const cl = closing; setClosing(null); startTransition(async () => { await patch({ stage: cl.stage, outcome: cl.outcome, ...(cl.outcome !== "won" ? { loss_reason: cl.loss_reason, loss_note: cl.loss_note || null } : {}) }); }); }}>Confirm</Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
