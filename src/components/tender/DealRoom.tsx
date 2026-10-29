"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import Pill from "@/components/Pill";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import {
  ROOM, linkify, mentionLabels, mergeMessages, nextPollDelay, pollSince, seenLabel, splitMentions,
  type RoomMessageView, type RoomPayload,
} from "@/lib/tender/room";
import { TENDER_TIPS } from "@/lib/tender/tips";

// The internal Deal Room (docs/design/gcc-tender-deals.md sections 4 and 10): one room per tender deal, for the workspace's own
// people. Four sub-tabs in one column: Discussion (the thread and the composer), Team (who is in the room), Decisions (pinned
// one-liners) and Documents (the files shared in the room). Messages are plain text with links (never HTML); files go through
// short-lived signed links. Questions are no longer started from here (owner decision 2026-10-29); an old question row still
// shows, as a message with a Question pill. It polls every 10 seconds while the tab is visible and backs off when hidden or
// after a failure. All rules (who may post, what is removed, what is unread) are the server's; this component only draws them.

const fmtStamp = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const PENDING_TEXT = "The Deal Room needs a database update (migration 0222). Ask your administrator to apply it.";
const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.dxf,.dwg,.png,.jpg,.jpeg";
export const ROOM_TABS = ["discussion", "team", "decisions", "documents"] as const;

const css = `
.dr-msg a{color:var(--tenant-accent);word-break:break-all}
.dr-msg{scroll-margin-top:80px}
`;

export default function DealRoom({ opportunityId, currentUserId, isAdmin, onSeen, headerExtra, initialState }: {
  opportunityId: string;
  currentUserId: string;
  isAdmin: boolean;
  /** Called when the room has been read (the unread badge can clear). */
  onSeen?: () => void;
  /** Extra controls in the room's header (the Log a call button). */
  headerExtra?: React.ReactNode;
  /** A room already loaded (the render tests draw the tabs from it); the live screen leaves it out and loads itself. */
  initialState?: { payload: RoomPayload; messages: RoomMessageView[] };
}) {
  const { confirm } = useFeel();
  const base = `/api/deal-rooms/${opportunityId}`;
  const [payload, setPayload] = useState<RoomPayload | null>(initialState?.payload ?? null);
  const [messages, setMessages] = useState<RoomMessageView[]>(initialState?.messages ?? []);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [pendingMigration, setPendingMigration] = useState(false);
  const [loading, setLoading] = useState(!initialState);
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useUrlTab(ROOM_TABS, "room");
  const cursor = useRef<string | null>(null);

  const [text, setText] = useState("");
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
      const fields = { body: text, kind: "message", parent_id: replyTo?.id ?? undefined };
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
      setText(""); setFiles([]); setReplyTo(null);
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

  async function remove(m: RoomMessageView) {
    if (!(await confirm({ title: "Remove this message?", body: "It stays in the history as removed; its text is no longer shown.", confirmLabel: "Remove", tone: "danger" }))) return;
    setError("");
    const res = await fetch(`${base}/messages/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove" }) });
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

  if (pendingMigration) return <div role="alert" data-guide="room.pending_migration" style={{ fontSize: 13, color: "var(--amberink)" }}>{PENDING_TEXT}</div>;
  if (loading) return <div style={{ color: c.hint, fontSize: 13 }}>Opening the room…</div>;
  if (!payload) return <div role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{error || "Could not open the room"}</div>;

  const live = messages.filter((m) => !m.removed);
  const decisions = live.filter((m) => m.kind === "decision");
  const allFiles = live.flatMap((m) => m.files.map((f) => ({ ...f, by: m.author_name, at: m.created_at })));
  const thread = messages.filter((m) => m.kind !== "decision");
  const roots = thread.filter((m) => !m.parent_id);
  const repliesOf = (id: string) => thread.filter((m) => m.parent_id === id);
  const nowDate = new Date();
  const tabs = [
    { id: "discussion", label: "Discussion" },
    { id: "team", label: "Team" },
    { id: "decisions", label: "Decisions", count: decisions.length },
    { id: "documents", label: "Documents", count: allFiles.length },
  ];

  const renderBody = (body: string) =>
    linkify(body).map((seg, i) =>
      seg.type === "link"
        ? <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer">{seg.label}</a>
        : <Fragment key={i}>{splitMentions(seg.value, labelList).map((p, j) => (p.type === "mention" ? <strong key={j}>{p.value}</strong> : <Fragment key={j}>{p.value}</Fragment>))}</Fragment>,
    );

  const renderMessage = (m: RoomMessageView, child = false) => {
    const mine = m.author_id === currentUserId;
    return (
      <div key={m.id} id={`msg-${m.id}`} className="dr-msg" data-guide="room.message" style={{ marginLeft: child ? 22 : 0, padding: "9px 12px", borderRadius: 8, background: mine ? "var(--panel2)" : "transparent", border: `1px solid ${c.line}` }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 12, color: c.hint }}>
          <span style={{ fontWeight: 700, color: c.ink }}>{m.author_name}</span><span>{fmtStamp(m.created_at)}</span>
          {m.kind === "question" && <Pill label="Question" tone="amber" />}
        </div>
        {m.removed ? (
          <div style={{ fontStyle: "italic", color: c.hint, fontSize: 13, marginTop: 4 }}>Message removed</div>
        ) : (
          <>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13.5, color: c.ink, marginTop: 4 }}>{renderBody(m.body ?? "")}</div>
            {m.files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {m.files.map((f) => <a key={f.id} href={`${base}/files/${f.id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: c.accent }}>{f.name} ({sizeLabel(f.size)})</a>)}
              </div>
            )}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {!child && <Button size="sm" variant="quiet" data-guide="room.reply" style={{ minHeight: 44 }} onClick={() => setReplyTo(m)}>Reply</Button>}
              {(mine || isAdmin) && <Button size="sm" variant="quiet" data-guide="room.remove" style={{ minHeight: 44 }} onClick={() => remove(m)}>Remove</Button>}
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>Team room</span>
        <InfoTip label="Deal Room">{TENDER_TIPS.room}</InfoTip>
        {headerExtra}
      </div>
      <div data-guide="room.subtabs" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}><Tabs tabs={tabs} value={sub} onChange={setSub} label="Room sections" /></div>
        <InfoTip label="Room sections">{TENDER_TIPS.roomTabs}</InfoTip>
      </div>

      {sub === "discussion" && (
        <div role="tabpanel" data-guide="room.discussion">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-live="polite">
            {more && <div><Button size="sm" variant="quiet" style={{ minHeight: 44 }} onClick={olderPage}>Show earlier messages</Button></div>}
            {roots.length === 0 && <div style={{ fontSize: 13, color: c.hint, padding: "14px 4px" }}>No messages yet. Start the discussion below.</div>}
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
                <Button size="sm" variant="quiet" style={{ minHeight: 44 }} onClick={() => setReplyTo(null)}>Cancel</Button>
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
              <Button variant="primary" loading={busy} disabled={!text.trim()} data-guide="room.send" style={{ marginLeft: "auto", minHeight: 44 }} onClick={send}>Send</Button>
            </div>
            {files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} style={{ fontSize: 12, border: `1px solid ${c.line}`, borderRadius: 999, padding: "2px 10px", display: "inline-flex", gap: 6, alignItems: "center" }}>
                    {f.name} ({sizeLabel(f.size)})
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", color: c.muted, minWidth: 44, minHeight: 44 }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {sub === "team" && (
        <div role="tabpanel" data-guide="room.members" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: c.ink }}>
            Members <InfoTip label="Members">{TENDER_TIPS.roomMembers}</InfoTip>
          </div>
          {payload.members.map((m) => (
            <div key={m.user_id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, minHeight: 44, alignItems: "center", borderBottom: `1px solid ${c.line}` }}>
              <span style={{ color: c.ink, overflowWrap: "anywhere" }}>{m.name}{m.is_you ? " (you)" : ""}</span>
              <span style={{ color: c.hint, whiteSpace: "nowrap" }}>{m.is_you ? "Here now" : seenLabel(m.last_seen_at, nowDate)}</span>
            </div>
          ))}
          {payload.candidates.length > 0 && (
            <div data-guide="room.add_member" style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <Select aria-label="Add a colleague" value={addUser} onChange={(e) => setAddUser(e.target.value)} style={{ minHeight: 44, flex: "1 1 200px", width: "auto" }}>
                <option value="">Add by name…</option>
                {payload.candidates.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </Select>
              <Button variant="secondary" disabled={!addUser} onClick={addMember} style={{ minHeight: 44 }}>Add</Button>
            </div>
          )}
        </div>
      )}

      {sub === "decisions" && (
        <div role="tabpanel" data-guide="room.decisions" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: c.ink }}>
            Decisions <InfoTip label="Decisions">{TENDER_TIPS.roomDecision}</InfoTip>
          </div>
          {decisions.length === 0 && <div style={{ fontSize: 13, color: c.hint }}>None pinned yet.</div>}
          {decisions.map((d) => (
            <div key={d.id} id={`msg-${d.id}`} style={{ fontSize: 13, color: c.ink, borderLeft: `3px solid ${c.accent}`, paddingLeft: 8 }}>
              <div style={{ overflowWrap: "anywhere" }}>{d.body}</div>
              <div style={{ color: c.hint, marginTop: 2, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                {d.author_name} · {fmtStamp(d.created_at)}
                {(d.author_id === currentUserId || isAdmin) && <Button size="sm" variant="quiet" style={{ minHeight: 44 }} onClick={() => remove(d)}>Remove</Button>}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-guide="room.decision_input">
            <Input aria-label="New decision" value={decision} onChange={(e) => setDecision(e.target.value)} maxLength={ROOM.decisionMax} placeholder="Agreed to…" style={{ minHeight: 44, flex: "1 1 220px", width: "auto" }} />
            <Button variant="secondary" disabled={!decision.trim() || busy} onClick={postDecision} style={{ minHeight: 44 }}>Pin</Button>
          </div>
        </div>
      )}

      {sub === "documents" && (
        <div role="tabpanel" data-guide="room.files" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: c.ink }}>
            Files <InfoTip label="Files">{TENDER_TIPS.roomFiles}</InfoTip>
          </div>
          {allFiles.length === 0 && <div style={{ fontSize: 13, color: c.hint }}>No files yet. Attach one to a message in Discussion.</div>}
          {allFiles.map((f) => (
            <a key={f.id} href={`${base}/files/${f.id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: c.accent, overflowWrap: "anywhere", minHeight: 44, display: "flex", alignItems: "center" }}>
              <span>{f.name} <span style={{ color: c.hint }}>({sizeLabel(f.size)} · {f.by})</span></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
