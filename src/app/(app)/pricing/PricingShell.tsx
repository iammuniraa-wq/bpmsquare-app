"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { c, pillar } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import { useFeel } from "@/components/FeelProvider";
import { humanizeArea, slugifyAreaLabel } from "@/lib/pricing/wizard";
import { PricingRefreshProvider, usePricingRefresh } from "./PricingRefreshContext";

const TABS = [
  { href: ROUTES.pricingToday, label: "Today's rates" },
  { href: ROUTES.pricingSetup, label: "Pricing setup" },
  { href: ROUTES.pricingHistory, label: "History" },
  { href: ROUTES.pricingAdvanced, label: "Advanced" },
] as const;

type VersionRow = { version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; notes: string | null };
type AreaRow = { area: string; hasPublished: boolean; hasDraft: boolean };

export default function PricingShell({ canEdit, children }: { canEdit: boolean; children: React.ReactNode }) {
  return (
    <PricingRefreshProvider>
      <PricingShellInner canEdit={canEdit}>{children}</PricingShellInner>
    </PricingRefreshProvider>
  );
}

function PricingShellInner({ canEdit, children }: { canEdit: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm } = useFeel();
  const { bump } = usePricingRefresh();
  const area = searchParams.get("area") || "default";
  const [draft, setDraft] = useState<VersionRow | null | undefined>(undefined);
  const [areas, setAreas] = useState<AreaRow[]>([{ area: "default", hasPublished: false, hasDraft: false }]);
  const [busy, setBusy] = useState<"publish" | "discard" | "newArea" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadAreas = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/pricing-engine/areas");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.areas) && data.areas.length > 0) setAreas(data.areas as AreaRow[]);
    } catch { /* keep whatever we already have */ }
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/settings/pricing-engine/versions?area=${encodeURIComponent(area)}`);
      if (!res.ok) { setDraft(null); return; }
      const data = await res.json();
      const versions = Array.isArray(data?.versions) ? (data.versions as VersionRow[]) : [];
      setDraft(versions.find((v) => v.status === "DRAFT") ?? null);
    } catch {
      setDraft(null);
    }
  }, [area]);

  useEffect(() => { reload(); }, [reload, pathname]);
  useEffect(() => { reloadAreas(); }, [reloadAreas]);

  // Preserve the current tab (today/setup/history/advanced) while switching
  // which Price Book it operates on -- ?area= travels with every tab link,
  // never just reset to "default" by navigating.
  function hrefFor(base: string, forArea: string): string {
    return forArea === "default" ? base : `${base}?area=${encodeURIComponent(forArea)}`;
  }

  function switchArea(next: string) {
    router.push(hrefFor(pathname, next));
  }

  async function newPriceBook() {
    const label = window.prompt("Name this Price Book (e.g. \"Service parts\", \"Custom equipment\"):");
    if (!label?.trim()) return;
    const slug = slugifyAreaLabel(label);
    if (!slug) { setError("That name didn't leave anything usable — try letters or numbers."); return; }
    if (areas.some((a) => a.area === slug)) {
      // Already exists -- just switch to it rather than silently adding a
      // version onto an area the tenant didn't mean to touch.
      switchArea(slug);
      return;
    }
    setBusy("newArea");
    setError(null);
    try {
      const res = await fetch("/api/settings/pricing-engine/versions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "Couldn't create that Price Book."); return; }
      await reloadAreas();
      router.push(hrefFor(ROUTES.pricingSetup, slug));
    } finally {
      setBusy(null);
    }
  }

  async function goLive() {
    if (!draft) return;
    setBusy("publish");
    setError(null);
    try {
      const res = await fetch(`/api/settings/pricing-engine/versions/${draft.version}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", area }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data?.report) ? data.report.join("; ") : data?.error;
        setError(detail || "Couldn't go live.");
        return;
      }
      await reload();
      await reloadAreas();
      bump();
      router.push(hrefFor(ROUTES.pricingToday, area));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (!draft) return;
    const ok = await confirm({
      title: "Discard your unsaved pricing changes?",
      body: "This can't be undone.",
      tone: "danger",
    });
    if (!ok) return;
    setBusy("discard");
    setError(null);
    try {
      const res = await fetch(`/api/settings/pricing-engine/versions/${draft.version}?area=${encodeURIComponent(area)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "Couldn't discard changes."); return; }
      await reload();
      bump();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const currentAreaKnown = useMemo(() => areas.some((a) => a.area === area), [areas, area]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${c.line}`, flex: "1 1 auto" }}>
          {TABS.map((t) => {
            const active = pathname === t.href || pathname?.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={hrefFor(t.href, area)}
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

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <select
            value={currentAreaKnown ? area : "default"}
            onChange={(e) => switchArea(e.target.value)}
            title="Price Book — pricing method in use"
            style={{
              padding: "6px 10px", borderRadius: 7, fontSize: 12.5, fontWeight: 600,
              border: `1px solid ${c.line}`, background: "var(--panel)", color: c.ink, cursor: "pointer",
            }}
          >
            {areas.map((a) => (
              <option key={a.area} value={a.area}>
                {humanizeArea(a.area)}{a.hasPublished ? "" : a.hasDraft ? " (draft)" : " (empty)"}
              </option>
            ))}
          </select>
          {canEdit && (
            <button
              onClick={newPriceBook}
              disabled={busy !== null}
              title="Create a second Price Book to run alongside this one"
              style={{
                padding: "6px 10px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: busy ? "default" : "pointer",
                border: `1px dashed ${c.line}`, background: "transparent", color: c.muted, opacity: busy ? 0.6 : 1,
              }}
            >
              {busy === "newArea" ? "Creating…" : "+ New price book"}
            </button>
          )}
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
