"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QUOTE_TYPES } from "@/lib/constants";
import type { QuoteTypeId } from "@/lib/constants";
import { c } from "@/lib/theme";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import PageHeader from "@/components/PageHeader";
import { FileText, Wrench, BarChart2, Package, CalendarCheck, Zap } from "@/components/Icons";
import EmptyState from "@/components/ui/EmptyState";
import { Section, Toggle, useSavedFlash } from "@/components/settings/generalShared";

export default function QuoteTypesPage() {
  const router = useRouter();
  const { settings } = useSettings();
  const tenant = useTenant();
  const tenantFeatures = tenant?.features as Record<string, boolean> | undefined;
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const [saved, flashSaved] = useSavedFlash();

  // ── Quote type visibility ─────────────────────────────────────────────────
  const [qtSaving, startQtSave] = useTransition();
  const [qtVis, setQtVis] = useState<Partial<Record<QuoteTypeId, boolean>>>(() => tenant?.config?.quote_type_visibility ?? {});

  function isQtVisible(id: QuoteTypeId): boolean {
    return id in qtVis ? qtVis[id] !== false : true;
  }

  function toggleQtType(id: QuoteTypeId) {
    const next = { ...qtVis, [id]: !isQtVisible(id) };
    setQtVis(next);
    startQtSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_type_visibility: next }),
      });
      flashSaved();
      router.refresh();
    });
  }

  function TypeIcon({ id }: { id: string }) {
    const p = { size: 15, color: c.muted };
    switch (id) {
      case "quotation":    return <FileText {...p} />;
      case "technical":    return <Wrench {...p} />;
      case "budgetary":    return <BarChart2 {...p} />;
      case "supply":       return <Package {...p} />;
      case "amc":          return <CalendarCheck {...p} />;
      case "installation": return <Zap {...p} />;
      default:             return <FileText {...p} />;
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <PageHeader
        title="Quote types"
        subtitle="Show or hide offer types in the New Quotation picker. Hidden types (including Coming Soon ones you don't need) won't appear there at all."
        action={<span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 500, opacity: saved ? 1 : 0, transition: "opacity 0.3s" }}>✓ Saved</span>}
      />

      {tenantFeatures?.quotations === true ? (
      <Section
        id="quote-types"
        title=""
        description="Show or hide offer types in the New Quotation picker. Hidden types (including Coming Soon ones you don't need) won't appear there at all."
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {QUOTE_TYPES.map((qt, idx) => {
            const visible = isQtVisible(qt.id as QuoteTypeId);
            return (
              <div key={qt.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderTop: idx > 0 ? `1px solid ${c.line}` : "none", opacity: visible ? 1 : 0.45, transition: "opacity 0.15s" }}>
                <TypeIcon id={qt.id} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>{qt.label}</div>
                  <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>{qt.description}</div>
                </div>
                {!qt.available && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: c.hint, background: c.panel2, border: `1px solid ${c.line}`, borderRadius: 4, padding: "2px 7px", letterSpacing: 0.3, textTransform: "uppercase" }}>
                    Coming soon
                  </span>
                )}
                <Toggle on={visible} onChange={() => !qtSaving && toggleQtType(qt.id as QuoteTypeId)} accent={accent} />
              </div>
            );
          })}
        </div>
      </Section>
      ) : (
        <EmptyState title="Quotations isn't enabled" text="Quote types apply to the Quotations module." />
      )}
    </div>
  );
}
