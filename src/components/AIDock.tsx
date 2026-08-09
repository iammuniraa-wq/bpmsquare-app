"use client";

import { useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";

type Msg = { from: "bot" | "me"; text: string };

// Per-user, per-browser preference -- separate from the tenant-level
// ai_assistant feature flag (Shell only mounts this component when that's
// on). A tenant can offer the assistant while an individual user still
// hides the launcher for themselves, same pattern as bms_nextgen_dark etc.
const ENABLED_KEY = "bms_ai_dock_enabled";

/**
 * Read-only data assistant -- a persistent bottom-right launcher that
 * expands into a chat panel. Answers questions about the tenant's own data
 * and nothing else: it cannot create, update or delete, which is enforced
 * server-side (src/lib/ai/assistant.ts), not just stated here. The empty
 * state lists exactly what it can do, scoped to the caller's Business
 * Roles, so nobody has to guess what to type.
 */
export default function AIDock() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [capabilities, setCapabilities] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(ENABLED_KEY) !== "0");
    } catch { /* ignore */ }
  }, []);

  function toggleEnabled() {
    setEnabled((v) => {
      const next = !v;
      try { localStorage.setItem(ENABLED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      if (!next) setOpen(false);
      return next;
    });
  }

  // Fetched on first open rather than on mount -- this dock renders on every
  // page, and most sessions never open it.
  useEffect(() => {
    if (!open || capabilities !== null) return;
    fetch("/api/ai/ask")
      .then((r) => (r.ok ? r.json() : { capabilities: [] }))
      .then((j) => setCapabilities(j.capabilities ?? []))
      .catch(() => setCapabilities([]));
  }, [open, capabilities]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setMessages((prev) => [...prev, { from: "me", text }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const json = await res.json().catch(() => ({}));
      setMessages((prev) => [
        ...prev,
        { from: "bot", text: res.ok ? json.answer : (json.error ?? "Something went wrong.") },
      ]);
    } catch {
      setMessages((prev) => [...prev, { from: "bot", text: "Could not reach the server." }]);
    } finally {
      setBusy(false);
    }
  }

  function sendMessage() { ask(draft); }

  return (
    <>
      <button
        onClick={toggleEnabled}
        aria-label={enabled ? "Turn off AI assistant" : "Turn on AI assistant"}
        title={enabled ? "Turn off AI assistant" : "Turn on AI assistant"}
        style={{
          position: "fixed", right: 22, bottom: 22, zIndex: 301,
          width: 40, height: 22, borderRadius: 11, cursor: "pointer",
          border: "1px solid var(--line)",
          background: enabled ? "var(--tenant-accent, #1e3a6e)" : "var(--panel2)",
          padding: 2, display: "flex", justifyContent: enabled ? "flex-end" : "flex-start",
          boxShadow: "0 4px 12px rgba(0,0,0,.18)",
        }}
      >
        <span style={{
          width: 16, height: 16, borderRadius: "50%",
          background: enabled ? "#fff" : "var(--muted)",
        }} />
      </button>

      {enabled && (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close assistant" : "Open assistant"}
          style={{
            position: "fixed", right: 22, bottom: 60, zIndex: 300,
            width: 52, height: 52, borderRadius: "50%", border: "none", cursor: "pointer",
            background: "var(--tenant-accent, #1e3a6e)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 10px 26px rgba(0,0,0,.25)",
          }}
        >
          {!open && (
            <span style={{
              position: "absolute", inset: -4, borderRadius: "50%",
              border: "2px solid var(--tenant-accent, #1e3a6e)", opacity: 0.35,
              animation: "vvcrm-pulse-ring 2.2s ease-out infinite",
            }} />
          )}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 L14.2 8.8 L21 11 L14.2 13.2 L12 20 L9.8 13.2 L3 11 L9.8 8.8 Z" />
          </svg>
        </button>
      )}

      {enabled && open && (
        <div style={{
          position: "fixed", right: 22, bottom: 124, zIndex: 300,
          width: 320, maxHeight: 440, display: "flex", flexDirection: "column",
          background: "var(--card-bg, #fff)", border: "1px solid var(--line)",
          borderRadius: "var(--card-radius, 10px)", boxShadow: "0 24px 60px rgba(10,15,25,.28)",
          overflow: "hidden",
        }}>
          <div style={{ padding: "12px 16px", background: "var(--accentbg)", color: c.accent, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            ✦ BPMSquare Assistant
            <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 700, color: c.muted, background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 5, padding: "2px 6px", letterSpacing: 0.4 }}>READ-ONLY</span>
          </div>
          <div ref={scrollRef} style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5, flex: 1, overflowY: "auto" }}>
            {messages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                <div style={{ color: c.muted, lineHeight: 1.5 }}>
                  I can answer questions about your data. I can&apos;t create, change or delete anything.
                </div>
                {capabilities === null && <div style={{ color: c.hint }}>Loading…</div>}
                {capabilities?.length === 0 && (
                  <div style={{ color: c.hint }}>There&apos;s no data I can report on for your account yet.</div>
                )}
                {capabilities && capabilities.length > 0 && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>
                      Try asking
                    </div>
                    {capabilities.map((cap) => (
                      <button
                        key={cap}
                        onClick={() => ask(cap)}
                        style={{
                          textAlign: "left", background: "var(--panel2)", border: "1px solid var(--line)",
                          borderRadius: "var(--card-radius, 10px)", padding: "8px 11px", fontSize: 12,
                          color: c.ink, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.4,
                        }}
                      >
                        {cap}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.from === "me" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  background: m.from === "me" ? "var(--tenant-accent, #1e3a6e)" : "var(--panel2)",
                  color: m.from === "me" ? "#fff" : c.ink,
                  borderRadius: "var(--card-radius, 10px)",
                  padding: "9px 12px",
                  lineHeight: 1.45,
                  // Answers are multi-line for list intents (recent quotes,
                  // recent cases) -- without this they collapse to one line.
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.text}
              </div>
            ))}
            {busy && <div style={{ alignSelf: "flex-start", color: c.hint }}>Looking that up…</div>}
          </div>
          <div style={{ margin: "0 16px 14px", display: "flex", gap: 8, flexShrink: 0 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
              placeholder="Ask about your data…"
              disabled={busy}
              style={{ flex: 1, border: "1px solid var(--line)", borderRadius: "var(--card-radius, 10px)", padding: "9px 12px", fontSize: 12.5, fontFamily: "inherit", outline: "none" }}
            />
            <button
              onClick={sendMessage}
              disabled={busy}
              style={{ background: "var(--tenant-accent, #1e3a6e)", color: "#fff", border: "none", borderRadius: "var(--card-radius, 10px)", padding: "9px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              →
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes vvcrm-pulse-ring {
          0% { transform: scale(.92); opacity: .5; }
          100% { transform: scale(1.35); opacity: 0; }
        }
      `}</style>
    </>
  );
}
