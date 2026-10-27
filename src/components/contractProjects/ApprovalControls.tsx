"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Textarea } from "@/components/ui/Input";
import type { ProjectApprovalView } from "@/lib/contractProjects/approvalServer";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { reloadAfterSave } from "@/components/tender/refreshAfterSave";
import { day } from "@/lib/contractProjects/format";

/**
 * The approval of the revision being looked at: ask (a draft with lines), decide (an approver), withdraw (the person who asked).
 * A blocker that stops a mistake is printed, not hidden behind an "i". Every action goes to /api/contract-projects/[id]/approval.
 */
export default function ApprovalControls({ projectId, revisionId, revisionStatus: statusFromServer, canEdit, approval: approvalFromServer, closed }: {
  projectId: string;
  revisionId: string | null;
  revisionStatus: string | null;
  canEdit: boolean;
  /** null while migration 0221 (approval_requests) is pending. */
  approval: ProjectApprovalView | null;
  closed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  // What is shown is the approval as last read: the server render gives it, and every action re-reads it at once (the button must not stay
  // "Ask for approval" until a reload) while the page refreshes for its header tiles and status chip.
  const [approval, setApproval] = useState(approvalFromServer);
  const [revisionStatus, setRevisionStatus] = useState(statusFromServer);
  useEffect(() => { setApproval(approvalFromServer); }, [approvalFromServer]);
  useEffect(() => { setRevisionStatus(statusFromServer); }, [statusFromServer]);

  async function reload() {
    await reloadAfterSave<{ approval?: ProjectApprovalView | null; revision?: { status: string } | null }>(
      `/api/contract-projects/${projectId}${revisionId ? `?revision=${revisionId}` : ""}`,
      (v) => { if (v.approval !== undefined) setApproval(v.approval); if (v.revision !== undefined) setRevisionStatus(v.revision?.status ?? null); },
      () => router.refresh(),
    );
  }

  function call(url: string, method: string, body: unknown) {
    setError("");
    startTransition(async () => {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That did not work"); await reload(); return; }
      setRejecting(false); setComment("");
      await reload();
    });
  }

  if (approval === null) {
    return <div role="alert" data-guide="cp.approval.pending_migration" style={{ fontSize: 13, color: "var(--amberink)" }}>Approval needs a database update (migration 0221). Ask your administrator to apply it.</div>;
  }
  const open = approval.pending;
  return (
    <div data-guide="cp.approval" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Approval <InfoTip label="Approval">{PROJECT_TIPS.approval}</InfoTip>
      </div>
      {open ? (
        <>
          <div style={{ fontSize: 13.5, color: c.ink }}>
            Waiting for approval{open.rev_no !== null ? ` · ${open.rev_no === 0 ? "Baseline" : `Revision ${open.rev_no}`}` : ""}
            <div style={{ fontSize: 12, color: c.hint }}>{[open.requested_by_name, day(open.requested_at)].filter((x) => x && x !== "—").join(" · ")}{open.reason ? ` · ${open.reason}` : ""}</div>
          </div>
          {approval.canDecide && !rejecting && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="primary" loading={pending} data-guide="cp.approval.approve" style={{ minHeight: 44 }} onClick={() => call(`/api/contract-projects/${projectId}/approval/${open.id}`, "PATCH", { action: "approve" })}>Approve</Button>
              <Button variant="secondary" disabled={pending} data-guide="cp.approval.reject" style={{ minHeight: 44 }} onClick={() => setRejecting(true)}>Reject</Button>
            </div>
          )}
          {approval.canDecide && rejecting && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why is it rejected?" aria-label="Reason for rejecting" maxLength={1000} />
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="danger" loading={pending} data-guide="cp.approval.reject_confirm" style={{ minHeight: 44 }} onClick={() => call(`/api/contract-projects/${projectId}/approval/${open.id}`, "PATCH", { action: "reject", comment })}>Reject</Button>
                <Button variant="quiet" disabled={pending} style={{ minHeight: 44 }} onClick={() => setRejecting(false)}>Cancel</Button>
              </div>
            </div>
          )}
          {open.mine && (
            <div><Button variant="quiet" loading={pending} data-guide="cp.approval.withdraw" style={{ minHeight: 44 }} onClick={() => call(`/api/contract-projects/${projectId}/approval/${open.id}`, "PATCH", { action: "cancel" })}>Withdraw the request</Button></div>
          )}
          {!approval.canDecide && !open.mine && <div style={{ fontSize: 12, color: c.hint }}>An approver will decide it.</div>}
        </>
      ) : revisionStatus === "draft" && canEdit && !closed ? (
        approval.askBlocked ? (
          <div role="status" data-guide="cp.approval.blocked" style={{ fontSize: 13, color: "var(--amberink)" }}>{approval.askBlocked}</div>
        ) : (
          <div><Button variant="primary" loading={pending} data-guide="cp.approval.ask" style={{ minHeight: 44 }} onClick={() => call(`/api/contract-projects/${projectId}/approval`, "POST", { revision_id: revisionId })}>Ask for approval</Button></div>
        )
      ) : (
        <div style={{ fontSize: 13, color: c.hint }}>{revisionStatus === "approved" ? "This budget is approved and locked." : revisionStatus === "superseded" ? "Replaced by a later revision." : "Nothing is waiting for approval."}</div>
      )}
      {approval.history[0] && !open && (
        <div style={{ fontSize: 12, color: c.hint }}>
          Last: {approval.history[0].status === "approved" ? "approved" : approval.history[0].status === "rejected" ? "rejected" : "withdrawn"}
          {approval.history[0].decided_by_name ? ` by ${approval.history[0].decided_by_name}` : ""}{approval.history[0].comment ? ` · ${approval.history[0].comment}` : ""}
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
    </div>
  );
}
