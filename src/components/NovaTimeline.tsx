"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

/**
 * Nova pillar 3 — the record timeline. One stream where the record's life
 * happens: comments (with @mentions) merged with change history, newest
 * first. Comments are visible to every member; the field-level change
 * stream follows the existing rule that Change History is admin-scoped —
 * the endpoint's 403 simply leaves members with the comments.
 *
 * Generic over (objectType, objectId); mounted per detail surface,
 * Nova-gated by the parent.
 */

type Comment = { id: string; author_email: string | null; body: string; mentions: string[]; created_at: string };
type ChangeRow = {
  id: string; action: "create" | "update" | "delete" | "reopen";
  changes: { field: string; from: unknown; to: unknown; redacted?: boolean }[];
  actor_email: string | null; created_at: string;
};
type Entry =
  | { kind: "comment"; at: string; c: Comment }
  | { kind: "change"; at: string; ch: ChangeRow };

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  if (days < 1) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString("en-IN", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: days > 330 ? "numeric" : undefined });
};

const who = (email: string | null) => (email ? email.split("@")[0] : "someone");

// Tenant/theme-aware accent -- NOT c.accent (a hardcoded hex that ignores the
// tenant color and does not remap in dark mode; the 2026-08-22 Nova audit's
// top finding).
const ACCENT = "var(--modern-accent, var(--accent))";

function summarizeChange(ch: ChangeRow): string {
  if (ch.action === "create") return "created this record";
  if (ch.action === "delete") return "deleted this record";
  if (ch.action === "reopen") return "reopened this record";
  const parts = ch.changes.slice(0, 3).map((x) =>
    x.redacted ? `${x.field} (hidden)` : `${x.field}: ${x.from ?? "—"} → ${x.to ?? "—"}`
  );
  const more = ch.changes.length > 3 ? ` +${ch.changes.length - 3} more` : "";
  return parts.length ? `changed ${parts.join(" · ")}${more}` : "updated this record";
}

export default function NovaTimeline({ objectType, objectId }: { objectType: string; objectId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [mentionables, setMentionables] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const [cRes, hRes] = await Promise.all([
      fetch(`/api/nova/comments?object_type=${objectType}&object_id=${objectId}`).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/change-log?object_type=${objectType}&object_id=${objectId}&limit=40`).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (cRes) { setComments(cRes.comments ?? []); setMentionables(cRes.mentionables ?? []); }
    if (Array.isArray(hRes)) setChanges(hRes);
    setLoaded(true);
  }, [objectType, objectId]);
  useEffect(() => { load(); }, [load]);

  const entries = useMemo<Entry[]>(() => {
    const all: Entry[] = [
      ...comments.map((cm): Entry => ({ kind: "comment", at: cm.created_at, c: cm })),
      ...changes.map((ch): Entry => ({ kind: "change", at: ch.created_at, ch })),
    ];
    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
  }, [comments, changes]);

  // @mention helper: the token being typed at the caret's tail.
  const mentionQuery = useMemo(() => {
    const m = draft.match(/@([\w.+-]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [draft]);
  const mentionMatches = useMemo(
    () => (mentionQuery === null ? [] : mentionables.filter((e) => e.toLowerCase().includes(mentionQuery)).slice(0, 5)),
    [mentionQuery, mentionables]
  );
  useEffect(() => { setMentionOpen(mentionMatches.length > 0); }, [mentionMatches.length]);

  function pickMention(email: string) {
    setDraft((d) => d.replace(/@[\w.+-]*$/, `@${email} `));
    setMentionOpen(false);
    inputRef.current?.focus();
  }

  async function post() {
    if (!draft.trim() || posting) return;
    setPosting(true); setError("");
    try {
      const res = await fetch("/api/nova/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object_type: objectType, object_id: objectId, body: draft.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not post"); return; }
      setComments((prev) => [json, ...prev]);
      setDraft("");
    } catch { setError("Network error — not posted."); }
    finally { setPosting(false); }
  }

  return (
    <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 3.5h11v7h-6l-3 2.8V10.5h-2z" fill="none" stroke={ACCENT} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 650, color: c.ink }}>Timeline</span>
        <span style={{ fontSize: 11, color: c.hint }}>comments and every change, in one stream</span>
      </div>

      {/* Composer */}
      <div style={{ position: "relative" }}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } }}
          rows={2}
          placeholder={`Write a comment — @ to mention a teammate · ${typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "") ? "⌘" : "Ctrl+"}Enter to post`}
          style={{
            width: "100%", boxSizing: "border-box", resize: "vertical",
            padding: "9px 11px", borderRadius: 9, fontSize: 12.5, lineHeight: 1.5,
            border: "1px solid var(--line)", background: "var(--panel2)", color: c.ink, fontFamily: "inherit",
          }}
        />
        {mentionOpen && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 4px)", left: 8, zIndex: 20,
            background: "var(--card-bg)", border: "1px solid var(--line)", borderRadius: 9,
            boxShadow: "0 8px 24px rgba(0,0,0,.25)", overflow: "hidden", minWidth: 220,
          }}>
            {mentionMatches.map((e) => (
              <button key={e} onClick={() => pickMention(e)} style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                border: "none", background: "transparent", cursor: "pointer",
                fontSize: 12, color: c.ink, font: "inherit",
              }}>
                @{e}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          {error && <span style={{ fontSize: 11.5, color: statusInk.bad, flex: 1 }}>{error}</span>}
          <button
            onClick={post}
            disabled={posting || !draft.trim()}
            style={{
              marginLeft: "auto", border: "none", cursor: "pointer", font: "inherit",
              fontSize: 12, fontWeight: 650, color: "#fff", padding: "7px 14px", borderRadius: 8,
              background: ACCENT, opacity: posting || !draft.trim() ? .55 : 1,
            }}
          >
            {posting ? "Posting…" : "Comment"}
          </button>
        </div>
      </div>

      {/* Stream */}
      {!loaded ? (
        <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 2px" }}>
          {[72, 54, 63].map((w, i) => (
            <div key={i} style={{ height: 12, width: `${w}%`, borderRadius: 6, background: "var(--panel2)" }} />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div style={{ fontSize: 12, color: c.hint, padding: "6px 2px" }}>
          Nothing yet — the first comment starts this record&apos;s story.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {entries.map((en, i) => (
            <div key={en.kind === "comment" ? `c-${en.c.id}` : `h-${en.ch.id}`} style={{
              display: "flex", gap: 10, padding: "9px 2px",
              borderTop: i === 0 ? "none" : "1px solid var(--line)",
            }}>
              <span style={{
                width: 24, height: 24, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: 700,
                background: en.kind === "comment" ? `color-mix(in srgb, ${ACCENT} 18%, transparent)` : "var(--panel2)",
                color: en.kind === "comment" ? ACCENT : c.hint,
              }}>
                {en.kind === "comment"
                  ? who(en.c.author_email).slice(0, 2).toUpperCase()
                  : (
                    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M8 4v4.5l3 1.8M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: c.muted }}>
                  <b style={{ color: c.ink, fontWeight: 600 }}>
                    {who(en.kind === "comment" ? en.c.author_email : en.ch.actor_email)}
                  </b>
                  {en.kind === "change" && <> {summarizeChange(en.ch)}</>}
                  <span style={{ color: c.hint }}> · {fmtWhen(en.at)}</span>
                </div>
                {en.kind === "comment" && (
                  <div style={{ fontSize: 12.5, color: c.ink, marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {en.c.body}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
