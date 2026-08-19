"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * Nova pillar 4 — the inbox bell. Everything addressed to you in one
 * place: today that means comments mentioning you (pillar 3), and the
 * shape is ready for more event kinds later.
 *
 * Lives in the Nova top bar next to the identity menu. Polls quietly
 * (60s) rather than holding a socket -- the volume here is a handful of
 * items a day, and a poll can't leak a subscription across tenants.
 */

type Item = {
  id: string; object_type: string; object_id: string; object_label: string;
  target_name: string; author: string; body: string; created_at: string; unread: boolean;
};

const ROUTE_FOR: Record<string, (id: string) => string> = {
  quotes: ROUTES.quotation, accounts: ROUTES.account, contacts: ROUTES.contact,
};

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export default function NovaInbox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/nova/inbox");
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.items ?? []);
      setUnread(json.unread ?? 0);
    } catch { /* stay quiet -- a bell that errors is worse than a bell that waits */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setItems((prev) => prev.map((i) => ids.includes(i.id) ? { ...i, unread: false } : i));
    setUnread((n) => Math.max(0, n - ids.length));
    await fetch("/api/nova/inbox", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_ids: ids }),
    }).catch(() => {});
  }

  async function markAll() {
    setItems((prev) => prev.map((i) => ({ ...i, unread: false })));
    setUnread(0);
    await fetch("/api/nova/inbox", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }

  function openItem(it: Item) {
    setOpen(false);
    if (it.unread) void markRead([it.id]);
    const route = ROUTE_FOR[it.object_type];
    if (route) router.push(route(it.object_id));
  }

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: 10 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Inbox — ${unread} unread` : "Inbox"}
        style={{
          position: "relative", width: 32, height: 32, borderRadius: 8, cursor: "pointer",
          border: "1px solid var(--sb-search-border)", background: "var(--sb-search-bg)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2a3.6 3.6 0 0 0-3.6 3.6c0 2.5-.9 3.4-1.4 4 -.3.3-.1.9.4.9h9.2c.5 0 .7-.6.4-.9 -.5-.6-1.4-1.5-1.4-4A3.6 3.6 0 0 0 8 2Z"
            fill="none" stroke="var(--sb-search-icon)" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M6.6 12.8a1.6 1.6 0 0 0 2.8 0" fill="none" stroke="var(--sb-search-icon)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 4px",
            borderRadius: 999, background: "#e5484d", color: "#fff",
            fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
            fontVariantNumeric: "tabular-nums",
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, width: 330, zIndex: 401,
          background: "var(--sb-panel-bg)", border: "1px solid var(--sb-panel-border)", borderRadius: 12,
          boxShadow: "0 16px 44px rgba(0,0,0,.5)", overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "11px 14px",
            borderBottom: "1px solid var(--sb-panel-border)",
          }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sb-panel-text)" }}>Inbox</span>
            {unread > 0 && (
              <button onClick={markAll} style={{
                marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer",
                fontSize: 11, fontWeight: 650, color: "var(--modern-accent, var(--accent))", font: "inherit",
              }}>
                Mark all read
              </button>
            )}
          </div>

          <div style={{ maxHeight: "58vh", overflowY: "auto" }}>
            {items.length === 0 ? (
              <div style={{ padding: "26px 16px", textAlign: "center", fontSize: 12, color: "var(--sb-panel-text-dim)", lineHeight: 1.6 }}>
                Nothing for you yet.<br />
                <span style={{ fontSize: 11 }}>When a teammate @mentions you on a record, it lands here.</span>
              </div>
            ) : items.map((it) => (
              <button
                key={it.id}
                onClick={() => openItem(it)}
                style={{
                  display: "flex", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
                  padding: "11px 14px", border: "none", borderBottom: "1px solid var(--sb-panel-border)",
                  background: it.unread ? "color-mix(in srgb, var(--modern-accent, var(--accent)) 9%, transparent)" : "transparent",
                  font: "inherit",
                }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                  background: it.unread ? "var(--modern-accent, var(--accent))" : "transparent",
                }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12, color: "var(--sb-panel-text)" }}>
                    <b style={{ fontWeight: 700 }}>{it.author}</b> mentioned you on{" "}
                    <b style={{ fontWeight: 650 }}>{it.target_name}</b>
                    <span style={{ color: "var(--sb-panel-text-dim)" }}> · {it.object_label}</span>
                  </span>
                  <span style={{
                    display: "block", fontSize: 11.5, color: "var(--sb-panel-text-dim)", marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {it.body}
                  </span>
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--sb-panel-text-dim)", marginTop: 3 }}>
                    {fmtWhen(it.created_at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
