"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import EmptyState from "@/components/ui/EmptyState";
import { Textarea } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { ACCEPT_ATTR } from "@/lib/drawings/files";
import { STATUS_LABEL } from "@/lib/drawings/types";
import { summaryText } from "@/lib/drawings/compare";
import { DRAWING_TIPS } from "@/lib/drawings/tips";
import { attachFile, call } from "./api";
import { STATUS_TONE, fmtBytes, fmtDate, type RevisionView } from "./view";
import s from "./Drawings.module.css";

// The Revisions tab: a rail of every revision (A, B, C with state, who and when), then one card per revision with the actions it allows.
// The server decides what each person may do (canRelease, canReturn, canEdit) and decides again when a button is pressed.

export default function RevisionsPanel({ drawingId, revisions, canEdit, hasOpen }: { drawingId: string; revisions: RevisionView[]; canEdit: boolean; hasOpen: boolean }) {
  const router = useRouter();
  const feel = useFeel();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [returning, setReturning] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileFor, setFileFor] = useState<string | null>(null);
  const ordered = [...revisions].sort((a, b) => b.rev_no - a.rev_no);

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string; problems?: string[] }>, done?: string) {
    setBusy(key); setError(""); setProblems([]);
    const r = await fn();
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Something went wrong"); setProblems(r.problems ?? []); return; }
    if (done) feel.toast({ text: done, tone: "success" });
    router.refresh();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    const rev = fileFor;
    e.target.value = "";
    if (!f || !rev) return;
    await run(`file:${rev}`, () => attachFile(drawingId, rev, f), "File attached");
  }

  async function release(r: RevisionView) {
    const ok = await feel.confirm({ title: `Release revision ${r.rev_label}?`, body: "It becomes the revision that feeds the bill of quantities, estimates and the handover, and the revision released before it is superseded. This cannot be undone.", confirmLabel: "Release" });
    if (!ok) return;
    await run(`release:${r.id}`, () => call(`/api/drawings/${drawingId}/revisions/${r.id}/release`, "POST", {}), `Revision ${r.rev_label} released`);
  }

  async function remove(r: RevisionView) {
    const ok = await feel.confirm({ title: `Delete draft revision ${r.rev_label}?`, body: "Its file and elements are removed. A draft that was never submitted is the only kind that can be deleted.", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    await run(`del:${r.id}`, () => call(`/api/drawings/${drawingId}/revisions/${r.id}`, "DELETE"), "Draft deleted");
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <input ref={fileRef} type="file" accept={ACCEPT_ATTR} hidden onChange={onFile} data-guide="drawings.file_input" />
      {error && (
        <div role="alert" className={s.alert}>
          <strong>{error}</strong>
          {problems.length > 1 && <ul>{problems.slice(1).map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}

      <Card title="Revisions" info={DRAWING_TIPS.rail} padding={14}
        action={canEdit ? (
          <span title={hasOpen ? "Release or delete the open revision first" : undefined}>
            <Button size="sm" disabled={hasOpen || busy !== null} loading={busy === "new"} data-guide="drawings.new_revision"
              onClick={() => run("new", () => call(`/api/drawings/${drawingId}/revisions`, "POST", {}), "Revision started")}>New revision</Button>
          </span>
        ) : undefined}>
        {ordered.length === 0 ? <EmptyState title="No revisions yet" text="Start the first revision, attach its file, then submit it." /> : (
          <ol className={s.rail} aria-label="Revisions, newest first" data-guide="drawings.rail">
            {[...ordered].reverse().map((r) => (
              <li key={r.id} className={s.railItem} data-status={r.status}>
                <span className={s.railLabel}>{r.rev_label}</span>
                <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
                <span className={s.railWho}>{r.status === "released" ? `${r.released_by_name ?? ""} ${fmtDate(r.released_at)}` : r.status === "in_review" ? `${r.submitted_by_name ?? ""} ${fmtDate(r.submitted_at)}` : fmtDate(r.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {ordered.map((r) => (
        <Card key={r.id} padding={14} tone={r.status === "released" ? "good" : r.status === "in_review" ? "warn" : undefined}>
          <div className={s.revHead}>
            <div>
              <span className={s.revTitle}>Revision {r.rev_label}</span>{" "}
              <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
              <InfoTip label={STATUS_LABEL[r.status]}>{DRAWING_TIPS[r.status === "in_review" ? "inReview" : r.status]}</InfoTip>
            </div>
            <div className={s.actions}>
              {r.file_path && <Button size="sm" variant="quiet" href={`/api/drawings/${drawingId}/revisions/${r.id}/file`} data-guide="drawings.download">Download</Button>}
              {r.status === "draft" && r.canEdit && <Button size="sm" loading={busy === `file:${r.id}`} onClick={() => { setFileFor(r.id); fileRef.current?.click(); }} data-guide="drawings.attach">{r.file_path ? "Replace file" : "Attach file"}</Button>}
              {r.status === "draft" && r.canEdit && <Button size="sm" variant="primary" loading={busy === `submit:${r.id}`} onClick={() => run(`submit:${r.id}`, () => call(`/api/drawings/${drawingId}/revisions/${r.id}/submit`, "POST", {}), "Submitted for review")} data-guide="drawings.submit">Submit for review</Button>}
              {r.status === "draft" && r.canEdit && !r.submitted_at && ordered.length > 1 && <Button size="sm" variant="quiet" onClick={() => remove(r)}>Delete draft</Button>}
              {r.status === "in_review" && r.canRelease && <Button size="sm" variant="primary" loading={busy === `release:${r.id}`} onClick={() => release(r)} data-guide="drawings.release">Release</Button>}
              {r.status === "in_review" && r.canReturn && <Button size="sm" onClick={() => { setReturning(returning === r.id ? null : r.id); setReason(""); }} data-guide="drawings.return">Return to draft</Button>}
            </div>
          </div>

          <dl className={s.facts}>
            <div><dt>File</dt><dd>{r.file_name ? `${r.file_name} (${fmtBytes(r.file_size)})` : <span className={s.quiet}>none yet</span>}</dd></div>
            {r.file_sha256 && <div><dt>Fingerprint <InfoTip label="Fingerprint">{DRAWING_TIPS.fingerprint}</InfoTip></dt><dd className={s.mono}>{r.file_sha256.slice(0, 12)}</dd></div>}
            <div><dt>Elements</dt><dd>{r.elementCount > 0 ? `${r.elementCount} loaded` : <span className={s.quiet}>none</span>}</dd></div>
            {r.submitted_at && <div><dt>Submitted</dt><dd>{r.submitted_by_name ?? ""} {fmtDate(r.submitted_at)}</dd></div>}
            {r.released_at && <div><dt>Released</dt><dd>{r.released_by_name ?? ""} {fmtDate(r.released_at)}{r.effective_from ? `, effective ${fmtDate(r.effective_from)}` : ""}</dd></div>}
            {(r.change_summary?.added || r.change_summary?.removed || r.change_summary?.changed) ? <div><dt>Against the release</dt><dd>{summaryText(r.change_summary)}</dd></div> : null}
          </dl>
          {r.notes && <p className={s.note}>{r.notes}</p>}
          {r.status === "draft" && r.return_reason && <p className={s.returned} role="status">Returned: {r.return_reason}</p>}
          {r.status === "released" && <p className={s.quiet} style={{ margin: "8px 0 0", fontSize: 12 }}>A released revision is a record. <InfoTip label="Released revision">{DRAWING_TIPS.immutable}</InfoTip></p>}

          {returning === r.id && (
            <div className={s.returnBox}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What needs to change" aria-label="Reason for returning" rows={3} />
              <div className={s.actions}>
                <Button size="sm" variant="primary" disabled={!reason.trim()} loading={busy === `return:${r.id}`}
                  onClick={() => run(`return:${r.id}`, async () => { const x = await call(`/api/drawings/${drawingId}/revisions/${r.id}/return`, "POST", { reason }); if (x.ok) setReturning(null); return x; }, "Returned to draft")}>Return</Button>
                <Button size="sm" variant="quiet" onClick={() => setReturning(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
