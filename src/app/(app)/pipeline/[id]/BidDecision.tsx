"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import StatusPill from "@/components/ui/StatusPill";
import { Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { APPROVAL_STATUS_LABEL, PROPOSAL_STAGES, type ApprovalEntry, type ApprovalView } from "@/lib/tender/approval";
import { TENDER_DECISION_LABEL, type TenderDecision } from "@/lib/tender/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { TenderView } from "@/lib/tender/views";

const fmtStamp = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const tone = (d: TenderDecision) => (d === "go" ? "green" : "red") as "green" | "red";

function Entry({ e }: { e: ApprovalEntry }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, color: c.muted }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StatusPill label={TENDER_DECISION_LABEL[e.decision]} tone={tone(e.decision)} />
        <span style={{ fontWeight: 600, color: c.ink }}>{APPROVAL_STATUS_LABEL[e.status]}</span>
        <span>{[e.status === "pending" ? e.requested_by_name : e.decided_by_name ?? e.requested_by_name, fmtStamp(e.decided_at ?? e.requested_at)].filter(Boolean).join(" · ")}</span>
      </div>
      {e.reason && <div style={{ color: c.ink }}>{e.reason}</div>}
      {e.comment && <div>Comment: {e.comment}</div>}
    </div>
  );
}

/**
 * The bid / no-bid decision of a tender, as an approval: a team member proposes go or no-go with a reason, an approver
 * approves or rejects with a comment. The server enforces the rest (who may decide, and that the stage cannot move on
 * without the approval); this component only mirrors it. Decisions saved before approval existed stay readable.
 */
export default function BidDecision({ opportunityId, stage, tender, approval, onError, onNotice }: {
  opportunityId: string;
  stage: string;
  tender: TenderView;
  approval: ApprovalView | null;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<TenderDecision | null>(null);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");

  function call(url: string, method: string, body: Record<string, unknown>, ok: string, after?: () => void) {
    startTransition(async () => {
      onError(""); onNotice("");
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not save"); return; }
      onNotice(ok);
      after?.();
      router.refresh();
    });
  }

  if (!approval) {
    return <div role="alert" data-guide="tender.approval.pending_migration" style={{ fontSize: 13, color: "var(--amberink)" }}>Bid approval needs a database update (migration 0221). Ask your administrator to apply it.</div>;
  }

  const base = `/api/opportunities/${opportunityId}/tender/approval`;
  const inDecisionStage = PROPOSAL_STAGES.includes(stage);
  const standing = approval.standing;
  const next = standing && inDecisionStage
    ? standing.decision === "go" ? { stage: "estimating", label: "Move to Estimating" } : { stage: "no_bid", label: "Move to No-bid" }
    : null;

  return (
    <div data-guide="tender.decision" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {standing && (
        <div data-guide="tender.decision.standing" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>Approved</div>
          <Entry e={standing} />
          {next && (
            <div>
              <Button variant="primary" loading={pending} data-guide="tender.decision.advance"
                onClick={() => call(`/api/opportunities/${opportunityId}`, "PATCH", { stage: next.stage }, `Moved: ${next.label.replace("Move to ", "")}`)}>
                {next.label}
              </Button>
            </div>
          )}
        </div>
      )}

      {!standing && approval.recordedBefore && tender.decision && (
        <div data-guide="tender.decision.legacy" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: c.muted }}>
          <StatusPill label={TENDER_DECISION_LABEL[tender.decision]} tone={tone(tender.decision)} />
          <span>Recorded before approval was required</span>
          <InfoTip label="Recorded before approval">{TENDER_TIPS.recordedBefore}</InfoTip>
          <span>{[tender.decided_by_name, fmtStamp(tender.decided_at)].filter(Boolean).join(" · ")}</span>
        </div>
      )}

      {approval.pending && (
        <div data-guide="tender.decision.pending" style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>Waiting for approval</div>
          <Entry e={approval.pending} />
          {approval.canDecide && (
            <>
              <Field label="Comment" guide="tender.decision.comment"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} style={{ minHeight: 60 }} /></Field>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button variant="primary" loading={pending} data-guide="tender.decision.approve" style={{ minHeight: 44 }}
                  onClick={() => call(`${base}/${approval.pending!.id}`, "PATCH", { action: "approve", comment }, "Approved", () => setComment(""))}>Approve</Button>
                <Button variant="secondary" loading={pending} disabled={!comment.trim()} data-guide="tender.decision.reject" style={{ minHeight: 44 }}
                  onClick={() => call(`${base}/${approval.pending!.id}`, "PATCH", { action: "reject", comment }, "Rejected. The tender is back in Bid/No-bid", () => setComment(""))}>Reject</Button>
              </div>
              {!comment.trim() && <div style={{ fontSize: 12, color: c.hint }}>A rejection needs a comment.</div>}
            </>
          )}
          {approval.pending.mine && (
            <div>
              <Button variant="quiet" loading={pending} data-guide="tender.decision.withdraw"
                onClick={() => call(`${base}/${approval.pending!.id}`, "PATCH", { action: "cancel" }, "Proposal withdrawn")}>Withdraw proposal</Button>
            </div>
          )}
          {!approval.canDecide && !approval.pending.mine && <div style={{ fontSize: 12, color: c.hint }}>An approver will decide.</div>}
        </div>
      )}

      {!approval.pending && !approval.proposalBlocked && (
        <div data-guide="tender.decision.propose" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>Propose a decision</div>
          <div role="group" aria-label="Decision" style={{ display: "flex", gap: 8 }}>
            {(["go", "no_go"] as const).map((d) => (
              <Button key={d} type="button" variant={choice === d ? "primary" : "secondary"} aria-pressed={choice === d}
                data-guide={d === "go" ? "tender.decision.go" : "tender.decision.no_go"} style={{ flex: 1, minHeight: 44 }} onClick={() => setChoice(d)}>
                {TENDER_DECISION_LABEL[d]}
              </Button>
            ))}
          </div>
          <Field label="Reason (required)" guide="tender.decision.reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} style={{ minHeight: 70 }} /></Field>
          <div>
            <Button variant="primary" loading={pending} disabled={!choice || !reason.trim()} data-guide="tender.decision.save"
              onClick={() => call(base, "POST", { decision: choice, reason }, "Sent for approval", () => { setChoice(null); setReason(""); })}>Ask for approval</Button>
          </div>
        </div>
      )}

      {!approval.pending && approval.proposalBlocked && !standing && (
        <div role="status" data-guide="tender.decision.blocked" style={{ fontSize: 12.5, color: c.muted }}>{approval.proposalBlocked}</div>
      )}

      {approval.history.length > 0 && (
        <details data-guide="tender.decision.history">
          <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: c.muted, minHeight: 32 }}>History ({approval.history.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
            {approval.history.map((e) => <Entry key={e.id} e={e} />)}
          </div>
        </details>
      )}
    </div>
  );
}
