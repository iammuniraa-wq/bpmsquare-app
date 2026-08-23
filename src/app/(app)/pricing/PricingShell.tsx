"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { c, pillar } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";

const TABS = [
  { href: ROUTES.pricingToday, label: "Today's rates" },
  { href: ROUTES.pricingSetup, label: "Pricing setup" },
  { href: ROUTES.pricingHistory, label: "History" },
  { href: ROUTES.pricingAdvanced, label: "Advanced" },
] as const;

type VersionRow = { version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; notes: string | null };

export default function PricingShell({ canEdit, children }: { canEdit: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [draft, setDraft] = useState<VersionRow | null | undefined>(undefined);
  const [busy, setBusy] = useState<"publish" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/pricing-engine/versions?area=default");
      if (!res.ok) { setDraft(null); return; }
      const data = await res.json();
      const versions = Array.isArray(data?.versions) ? (data.versions as VersionRow[]) : [];
      setDraft(versions.find((v) => v.status === "DRAFT") ?? null);
    } catch {
      setDraft(null);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, pathname]);

  async function goLive() {
    if (!draft) return;
    setBusy("publish");
    setError(null);
    try {
      const res = await fetch(`/api/settings/pricing-engine/versions/${draft.version}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", area: "default" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data?.report) ? data.report.join("; ") : data?.error;
        setError(detail || "Couldn't go live.");
        return;
      }
      await reload();
      router.push(ROUTES.pricingToday);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (!draft) return;
    if (!window.confirm("Discard your unsaved pricing changes? This can't be undone.")) return;
    setBusy("discard");
    setError(null);
    try {
      const res = await fetch(`/api/settings/pricing-engine/versions/${draft.version}?area=default`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "Couldn't discard changes."); return; }
      await reload();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${c.line}`, flex: "1 1 auto" }}>
          {TABS.map((t) => {
            const active = pathname === t.href || pathname?.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                style={{
                  padding: "9px 16px", fontSize: 13, fontWeight: active ? 700 : 500,
                  color: active ? c.accent : c.muted, textDecoration: "none",
                  borderBottom: active ? `2px solid ${c.accent}` : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>

      {draft && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
            padding: "10px 14px", marginBottom: 16, borderRadius: 8,
            background: pillar.amber.bg, border: `1px solid ${pillar.amber.base}40`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: pillar.amber.fg }}>
            <span>●</span>
            <span>You have unsaved pricing changes</span>
          </div>
          {canEdit && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={discard}
                disabled={busy !== null}
                style={{
                  padding: "6px 12px", fontSize: 12.5, fontWeight: 600, borderRadius: 6,
                  border: `1px solid ${c.line}`, background: c.panel, color: c.muted,
                  cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                }}
              >
                {busy === "discard" ? "Discarding…" : "Discard"}
              </button>
              <button
                onClick={goLive}
                disabled={busy !== null}
                style={{
                  padding: "6px 14px", fontSize: 12.5, fontWeight: 700, borderRadius: 6,
                  border: "none", background: c.accent, color: "#fff",
                  cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                }}
              >
                {busy === "publish" ? "Going live…" : "Go live"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ padding: "8px 12px", marginBottom: 16, borderRadius: 6, background: pillar.red.bg, color: pillar.red.fg, fontSize: 12.5 }}>
          {error}
        </div>
      )}

      {children}
    </>
  );
}
