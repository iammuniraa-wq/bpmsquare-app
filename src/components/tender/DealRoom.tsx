"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SettingsSection from "@/components/settings/SettingsSection";
import { useFeel } from "@/components/FeelProvider";
import {
  ROOM, linkify, mentionLabels, mergeMessages, nextPollDelay, pollSince, questionState, seenLabel, splitMentions,
  type RoomMessageView, type RoomPayload,
} from "@/lib/tender/room";
import { TENDER_TIPS } from "@/lib/tender/tips";

// The internal Deal Room (docs/design/gcc-tender-deals.md sections 4 and 10): one room per tender deal, for the workspace's own
// people. Messages are plain text with links (never HTML), a message can be a question (owner, due date, open / answered), a
// decision is a pinned one-liner, files go through short-lived signed links. It polls every 10 seconds while the tab is
// visible and backs off when hidden or after a failure. All rules (who may post, what is removed, what is unread) are the
// server's; this component only draws them.

const fmtStamp = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const fmtDay = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "");
const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const PENDING_TEXT = "The Deal Room needs a database update (migration 0222). Ask your administrator to apply it.";
const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.dxf,.dwg,.png,.jpg,.jpeg";

const css = `
.dr-grid{display:grid;gap:14px;grid-template-columns:240px minmax(0,1fr) 260px;grid-template-areas:"left centre right";align-items:start}
.dr-left{grid-area:left;display:flex;flex-direction:column;gap:12px}.dr-centre{grid-area:centre;min-width:0}.dr-right{grid-area:right;display:flex;flex-direction:column;gap:12px}
@media (max-width:900px){.dr-grid{grid-template-columns:minmax(0,1fr);grid-template-areas:"centre" "left" "right"}}
.dr-msg a{color:var(--tenant-accent,#378ADD);word-break:break-all}
.dr-msg{scroll-margin-top:80px}
`;

export default function DealRoom({ opportunityId, currentUserId, isAdmin, todayKey, initialFilter = "all", onSeen, onOpenQuestions, headerExtra }: {
  opportunityId: string;
  currentUserId: string;
  isAdmin: boolean;
  todayKey: string;
  initialFilter?: "all" | "questions";
  /** Called when the room has been read (the unread badge can clear). */
  onSeen?: () => void;
  /** Called with the number of open questions whenever it changes (the Tender tab shows it). */
  onOpenQuestions?: (count: number) => void;
  /** Extra controls in the room's header (the Log a call button). */
  headerExtra?: React.ReactNode;
}) {
  const { confirm } = useFeel();
  const base = `/api/deal-rooms/${opportunityId}`;
  const [payload, setPayload] = useState<RoomPayload | null>(null);
  const [messages, setMessages] = useState<RoomMessageView[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [pendingMigration, setPendingMigration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "questions">(initialFilter);
  const cursor = useRef<string | null>(null);

  const [text, setText] = useState("");
  const [asQuestion, setAsQuestion] = useState(false);
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [replyTo, setReplyTo] = useState<RoomMessageView | null>(null);
  const [decision, setDecision] = useState("");
  const [addUser, setAddUser] = useState("");

  const labels = useMemo(() => (payload ? mentionLabels(payload.members.map((m) => ({ user_id: m.user_id, name: m.name, email: m.email }))) : new Map<string, string>()), [payload]);
  const labelList = useMemo(() => [...labels.values()], [labels]);

  const readNow = useCallback(() => { fetch(`${base}/read`, { method: "POST" }).then(() => onSeen?.()).catch(() => {}); }, [base, onSeen]);

  const refreshHeader = useCallback(async () => {
    const res = await fetch(base);
    if (res.ok) setPayload(await res.json());
  }, [base]);

  // First load: open the room if nobody has yet (it adds the owner and team), then the latest page of messages.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let res = await fetch(base);
        if (res.status === 503) { if (alive) { setPendingMigration(true); setLoading(false); } return; }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not open the room");
        let head = (await res.json()) as RoomPayload;
        if (!head.room) {
          res = await fetch(base, { method: "POST" });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not open the room");
          head = (await res.json()) as RoomPayload;
        }
        const m = await fetch(`${base}/messages`);
        if (!m.ok) throw new Error("Could not load the messages");
        const body = (await m.json()) as { messages: RoomMessageView[]; more: boolean; server_now: string };
        if (!alive) return;
        setPayload(head); setMessages(body.messages); setMore(body.more); cursor.current = body.server_now; setLoading(false);
        readNow();
      } catch (e) {
        if (alive) { setError((e as Error).message); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [base, readNow]);

  // Poll: 10 s while the tab is visible, 60 s when hidden (no request at all until it is visible again), doubling after a failure.
  const ready = !!payload?.room;
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let ticks = 0;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      if (!hidden) {
        try {
          const since = pollSince(cursor.current);
          const res = await fetch(since ? `${base}/messages?since=${encodeURIComponent(since)}` : `${base}/messages`);
          if (!res.ok) throw new Error("poll failed");
          const j = (await res.json()) as { messages: RoomMessageView[]; server_now: string };
          cursor.current = j.server_now;
          failures = 0;
          if (j.messages.length > 0) {
            setMessages((prev) => mergeMessages(prev, j.messages));
            if (j.messages.some((m) => m.author_id !== currentUserId)) readNow();
          }
          if (++ticks % 6 === 0) void refreshHeader();
        } catch {
          failures++;
        }
      }
      if (!stopped) timer = setTimeout(tick, nextPollDelay({ hidden, failures }));
    };
    timer = setTimeout(tick, ROOM.pollMs);
    const onVisible = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [ready, base, currentUserId, readNow, refreshHeader]);

  async function send() {
    setError("");
    if (!text.trim()) return;
    setBusy(true);
    try {
      const fields = { body: text, kind: asQuestion ? "question" : "message", parent_id: replyTo?.id ?? undefined, owner_id: asQuestion && owner ? owner : undefined, due: asQuestion && due ? due : undefined };
      let res: Response;
      if (files.length > 0) {
        const form = new FormData();
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, String(v));
        for (const f of files) form.append("files", f);
        res = await fetch(`${base}/messages`, { method: "POST", body: form });
      } else {
        res = await fetch(`${base}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not post"); return; }
      setMessages((prev) => mergeMessages(prev, [j.message]));
      setText(""); setAsQuestion(false); setOwner(""); setDue(""); setFiles([]); setReplyTo(null);
      void refreshHeader();
    } finally { setBusy(false); }
  }

  async function postDecision() {
    if (!decision.trim()) return;
    setBusy(true); setError("");
    const res = await fetch(`${base}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: decision, kind: "decision" }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? "Could not pin the decision"); return; }
    setMessages((prev) => mergeMessages(prev, [j.message]));
    setDecision("");
  }

  async function act(m: RoomMessageView, action: "answer" | "reopen" | "remove") {
    if (action === "remove" && !(await confirm({ title: "Remove this message?", body: "It stays in the history as removed; its text is no longer shown.", confirmLabel: "Remove", tone: "danger" }))) return;
    setError("");
    const res = await fetch(`${base}/messages/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not change it"); return; }
    setMessages((prev) => mergeMessages(prev, [j.message]));
    void refreshHeader();
  }

  async function olderPage() {
    const first = messages[0];
    if (!first) return;
    const res = await fetch(`${base}/messages?before=${encodeURIComponent(first.created_at)}`);
    if (!res.ok) return;
    const j = (await res.json()) as { messages: RoomMessageView[]; more: boolean };
    setMessages((prev) => mergeMessages(prev, j.messages));
    setMore(j.more);
  }

  async function addMember() {
    if (!addUser) return;
    const res = await fetch(`${base}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: addUser }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not add them"); return; }
    setPayload(j); setAddUser("");
  }

  const insertMention = (userId: string) => {
    const label = labels.get(userId);
    if (label) setText((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}@${label} `);
  };

  const openCount = messages.filter((m) => !m.removed && m.kind === "question" && m.question?.status === "open").length;
  useEffect(() => { if (ready) onOpenQuestions?.(openCount); }, [ready, openCount, onOpenQuestions]);

  if (pendingMigration) return <div role="alert" data-guide="room.pending_migration" style={{ fontSize: 13, color: "var(--amberink)" }}>{PENDING_TEXT}</div>;
  if (loading) return <div style={{ color: c.hint, fontSize: 13 }}>Opening the room…</div>;
  if (!payload) return <div role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{error || "Could not open the room"}</div>;

  const live = messages.filter((m) => !m.removed);
  const decisions = live.filter((m) => m.kind === "decision");
  const questions = live.filter((m) => m.kind === "question");
  const openQs = questions.filter((q) => q.question?.status === "open");
  const answeredQs = questions.filter((q) => q.question?.status === "answered");
  const allFiles = live.flatMap((m) => m.files.map((f) => ({ ...f, by: m.author_name, at: m.created_at })));
  const thread = messages.filter((m) => m.kind !== "decision");
  const roots = thread.filter((m) => !m.parent_id && (filter === "all" || (m.kind === "question" && m.question?.status === "open")));
  const repliesOf = (id: string) => thread.filter((m) => m.parent_id === id);
  const nowDate = new Date();

  const renderBody = (body: string) =>
    linkify(body).map((seg, i) =>
      seg.type === "link"
        ? <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer">{seg.label}</a>
        : <Fragment key={i}>{splitMentions(seg.value, labelList).map((p, j) => (p.type === "mention" ? <strong key={j}>{p.value}</strong> : <Fragment key={j}>{p.value}</Fragment>))}</Fragment>,
    );

  const renderMessage = (m: RoomMessageView, child = false) => {
    const mine = m.author_id === currentUserId;
    const q = m.question;
    const canQuestion = !!q && (mine || q.owner_id === currentUserId || isAdmin);
    const state = q ? questionState({ question_status: q.status, question_due: q.due }, todayKey) : null;
    return (
      <div key={m.id} id={`msg-${m.id}`} className="dr-msg" data-guide="room.message" style={{ marginLeft: child ? 22 : 0, padding: "9px 12px", borderRadius: 8, background: mine ? "var(--panel2)" : "transparent", border: `1px solid ${c.line}` }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 12, color: c.hint }}>
          <span style={{ fontWeight: 700, color: c.ink }}>{m.author_name}</span><span>{fmtStamp(m.created_at)}</span>
          {q && <span style={{ fontWeight: 600, color: state === "overdue" ? "var(--redink)" : state === "answered" ? "var(--greenink)" : "var(--amberink)" }}>
            {state === "answered" ? "Answered" : state === "overdue" ? "Open · overdue" : "Open question"}
          </span>}
        </div>
        {m.removed ? (
          <div style={{ fontStyle: "italic", color: c.hint, fontSize: 13, marginTop: 4 }}>Message removed</div>
        ) : (
          <>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13.5, color: c.ink, marginTop: 4 }}>{renderBody(m.body ?? "")}</div>
            {q && (q.owner_name || q.due) && <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>{[q.owner_name ? `Owner: ${q.owner_name}` : null, q.due ? `Due ${fmtDay(q.due)}` : null].filter(Boolean).join(" · ")}</div>}
            {m.files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {m.files.map((f) => <a key={f.id} href={`${base}/files/${f.id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: c.accent }}>{f.name} ({sizeLabel(f.size)})</a>)}
              </div>
            )}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {!child && <Button size="sm" variant="quiet" data-guide="room.reply" onClick={() => setReplyTo(m)}>Reply</Button>}
              {canQuestion && q.status === "open" && <Button size="sm" variant="quiet" data-guide="room.answer" onClick={() => act(m, "answer")}>Mark answered</Button>}
              {canQuestion && q.status === "answered" && <Button size="sm" variant="quiet" onClick={() => act(m, "reopen")}>Reopen</Button>}
              {(mine || isAdmin) && <Button size="sm" variant="quiet" data-guide="room.remove" onClick={() => act(m, "remove")}>Remove</Button>}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div data-guide="room.tab">
      <style>{css}</style>
      {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)", marginBottom: 10 }}>{error}</div>}
      <div className="dr-grid">
        <div className="dr-centre">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>Team room</span>
            <InfoTip label="Deal Room">{TENDER_TIPS.room}</InfoTip>
            {headerExtra}
            <div role="group" aria-label="Show" style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Button size="sm" variant={filter === "all" ? "primary" : "secondary"} aria-pressed={filter === "all"} data-guide="room.filter_all" onClick={() => setFilter("all")}>All</Button>
              <Button size="sm" variant={filter === "questions" ? "primary" : "secondary"} aria-pressed={filter === "questions"} data-guide="room.filter_questions" onClick={() => setFilter("questions")}>Open questions ({openQs.length})</Button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-live="polite">
            {more && <div><Button size="sm" variant="quiet" onClick={olderPage}>Show earlier messages</Button></div>}
            {roots.length === 0 && <div style={{ fontSize: 13, color: c.hint, padding: "14px 4px" }}>{filter === "questions" ? "No open questions." : "No messages yet. Start the discussion below."}</div>}
            {roots.map((m) => (
              <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {renderMessage(m)}
                {repliesOf(m.id).map((r) => renderMessage(r, true))}
              </div>
            ))}
          </div>

          <div data-guide="room.composer" style={{ marginTop: 14, border: `1px solid ${c.line}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10, position: "sticky", bottom: 8, background: "var(--card-bg)" }}>
            {replyTo && (
              <div style={{ fontSize: 12, color: c.muted, display: "flex", alignItems: "center", gap: 8 }}>
                Replying to {replyTo.author_name}
                <Button size="sm" variant="quiet" onClick={() => setReplyTo(null)}>Cancel</Button>
              </div>
            )}
            <Textarea aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} maxLength={ROOM.bodyMax} placeholder="Write to your team. @ mentions a member." style={{ minHeight: 70 }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Select aria-label="Mention" data-guide="room.mention" value="" onChange={(e) => { if (e.target.value) insertMention(e.target.value); }} style={{ width: "auto", minHeight: 44 }}>
                <option value="">@ Mention…</option>
                {payload.members.filter((m) => !m.is_you).map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
              </Select>
              <label data-guide="room.attach" style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, fontSize: 13, color: c.accent, cursor: "pointer" }}>
                Attach
                <input type="file" multiple accept={ACCEPT} style={{ display: "none" }} onChange={(e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])].slice(0, ROOM.maxFiles)); e.target.value = ""; }} />
              </label>
              <InfoTip label="Attach files">{TENDER_TIPS.roomFiles}</InfoTip>
              <label data-guide="room.question_toggle" style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, fontSize: 13, color: c.ink, cursor: "pointer" }}>
                <input type="checkbox" checked={asQuestion} onChange={(e) => setAsQuestion(e.target.checked)} style={{ width: 18, height: 18 }} /> Question
              </label>
              <InfoTip label="Question">{TENDER_TIPS.roomQuestion}</InfoTip>
              <Button variant="primary" loading={busy} disabled={!text.trim()} data-guide="room.send" style={{ marginLeft: "auto", minHeight: 44 }} onClick={send}>Send</Button>
            </div>
            {asQuestion && (
              <div className="fg2">
                <Field label="Owner" guide="room.question_owner">
                  <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">— Not set —</option>
                    {payload.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
                  </Select>
                </Field>
                <Field label="Due" guide="room.question_due"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
              </div>
            )}
            {files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} style={{ fontSize: 12, border: `1px solid ${c.line}`, borderRadius: 999, padding: "2px 10px", display: "inline-flex", gap: 6, alignItems: "center" }}>
                    {f.name} ({sizeLabel(f.size)})
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", color: c.muted, minWidth: 24, minHeight: 24 }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="dr-left">
          <SettingsSection id="room.questions" title="Open questions" info={TENDER_TIPS.roomQuestion} summary={`${openQs.length} open · ${answeredQs.length} answered`} defaultOpen>
            <div data-guide="room.questions" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {openQs.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>Nothing open.</div>}
              {openQs.map((q) => {
                const state = questionState({ question_status: q.question!.status, question_due: q.question!.due }, todayKey);
                return (
                  <button key={q.id} type="button" onClick={() => document.getElementById(`msg-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                    style={{ textAlign: "left", background: "none", border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", minHeight: 44, color: c.ink, fontSize: 12.5 }}>
                    <div style={{ overflowWrap: "anywhere" }}>{(q.body ?? "").slice(0, 90)}</div>
                    <div style={{ color: state === "overdue" ? "var(--redink)" : c.hint, marginTop: 2 }}>{[q.question!.owner_name, q.question!.due ? `${state === "overdue" ? "Overdue · " : "Due "}${fmtDay(q.question!.due)}` : null].filter(Boolean).join(" · ") || "No owner or due date"}</div>
                  </button>
                );
              })}
            </div>
          </SettingsSection>
          <SettingsSection id="room.members" title="Members" info={TENDER_TIPS.roomMembers} summary={`${payload.members.length} following`}>
            <div data-guide="room.members" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {payload.members.map((m) => (
                <div key={m.user_id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, minHeight: 28 }}>
                  <span style={{ color: c.ink, overflowWrap: "anywhere" }}>{m.name}{m.is_you ? " (you)" : ""}</span>
                  <span style={{ color: c.hint, whiteSpace: "nowrap" }}>{m.is_you ? "Here now" : seenLabel(m.last_seen_at, nowDate)}</span>
                </div>
              ))}
              {payload.candidates.length > 0 && (
                <div data-guide="room.add_member" style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <Select aria-label="Add a colleague" value={addUser} onChange={(e) => setAddUser(e.target.value)} style={{ minHeight: 44 }}>
                    <option value="">Add by name…</option>
                    {payload.candidates.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                  </Select>
                  <Button variant="secondary" disabled={!addUser} onClick={addMember} style={{ minHeight: 44 }}>Add</Button>
                </div>
              )}
            </div>
          </SettingsSection>
        </div>

        <div className="dr-right">
          <SettingsSection id="room.decisions" title="Decisions" info={TENDER_TIPS.roomDecision} summary={`${decisions.length} pinned`} defaultOpen>
            <div data-guide="room.decisions" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {decisions.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>None pinned yet.</div>}
              {decisions.map((d) => (
                <div key={d.id} id={`msg-${d.id}`} style={{ fontSize: 12.5, color: c.ink, borderLeft: `3px solid ${c.accent}`, paddingLeft: 8 }}>
                  <div style={{ overflowWrap: "anywhere" }}>{d.body}</div>
                  <div style={{ color: c.hint, marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
                    {d.author_name} · {fmtStamp(d.created_at)}
                    {(d.author_id === currentUserId || isAdmin) && <Button size="sm" variant="quiet" onClick={() => act(d, "remove")}>Remove</Button>}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6 }} data-guide="room.decision_input">
                <Input aria-label="New decision" value={decision} onChange={(e) => setDecision(e.target.value)} maxLength={ROOM.decisionMax} placeholder="Agreed to…" />
                <Button variant="secondary" disabled={!decision.trim() || busy} onClick={postDecision} style={{ minHeight: 44 }}>Pin</Button>
              </div>
            </div>
          </SettingsSection>
          <SettingsSection id="room.files" title="Files" info={TENDER_TIPS.roomFiles} summary={`${allFiles.length} shared`}>
            <div data-guide="room.files" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {allFiles.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>No files yet.</div>}
              {allFiles.map((f) => (
                <a key={f.id} href={`${base}/files/${f.id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: c.accent, overflowWrap: "anywhere", minHeight: 28 }}>
                  {f.name} <span style={{ color: c.hint }}>({sizeLabel(f.size)} · {f.by})</span>
                </a>
              ))}
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
