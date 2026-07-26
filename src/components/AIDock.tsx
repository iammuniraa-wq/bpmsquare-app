"use client";

import { useState } from "react";
import { c } from "@/lib/theme";

type Msg = { from: "bot" | "me"; text: string };

const STARTER: Msg = {
  from: "bot",
  text: "This is a preview of where your AI assistant will live — ask it something and it'll reply once it's wired up to your real data.",
};

/** Reserved AI-agent surface for the "modern" theme direction -- a
 * persistent bottom-right launcher that expands into a chat panel.
 * Currently a UI shell (canned acknowledgement, no live backend) so the
 * surface is real and demoable without over-claiming AI functionality
 * that doesn't exist yet -- wire a real assistant behind sendMessage()
 * when ready. */
export default function AIDock() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([STARTER]);
  const [draft, setDraft] = useState("");

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [
      ...prev,
      { from: "me", text },
      { from: "bot", text: "Noted — real answers are coming once this is connected to your account, quote, and case data." },
    ]);
    setDraft("");
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        style={{
          position: "fixed", right: 22, bottom: 22, zIndex: 300,
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

      {open && (
        <div style={{
          position: "fixed", right: 22, bottom: 86, zIndex: 300,
          width: 320, maxHeight: 440, display: "flex", flexDirection: "column",
          background: "var(--card-bg, #fff)", border: "1px solid var(--line)",
          borderRadius: "var(--card-radius, 10px)", boxShadow: "0 24px 60px rgba(10,15,25,.28)",
          overflow: "hidden",
        }}>
          <div style={{ padding: "12px 16px", background: "var(--accentbg)", color: c.accent, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            ✦ BPMSquare Assistant
            <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 700, color: "var(--modern-gold, #8a5a12)", background: "var(--modern-gold-bg, #fdf1de)", border: "1px solid #f0d9ae", borderRadius: 5, padding: "2px 6px", letterSpacing: 0.4 }}>PREVIEW</span>
          </div>
          <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5, flex: 1, overflowY: "auto" }}>
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
                }}
              >
                {m.text}
              </div>
            ))}
          </div>
          <div style={{ margin: "0 16px 14px", display: "flex", gap: 8, flexShrink: 0 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
              placeholder="Ask about accounts, quotes, cases…"
              style={{ flex: 1, border: "1px solid var(--line)", borderRadius: "var(--card-radius, 10px)", padding: "9px 12px", fontSize: 12.5, fontFamily: "inherit", outline: "none" }}
            />
            <button
              onClick={sendMessage}
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
