"use client";

import type { DashLayoutItem, TenantFeatures, AnalyticsMetricId } from "@/lib/constants";
import { ANALYTICS_META } from "@/lib/analyticsMeta";
import { novaBlockLabel, novaBlockAllowed, isNovaNativeId } from "@/lib/nova/streamLayout";

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Nova's Stream customization drawer -- add analytics widgets, reorder with
 * up/down, hide/show. Reused for both the tenant-wide default (admin,
 * "Adapt Stream") and the caller's own personal layer ("My Stream"),
 * exactly like the classic dashboard's AdaptDrawer.
 */
export default function NovaAdaptDrawer({
  layout,
  features,
  onLayoutChange,
  onClose,
  saving,
  title = "Adapt Stream",
  subtitle = "Reorder, hide, or add widgets",
  onReset,
  resetLabel,
}: {
  layout: DashLayoutItem[];
  features: TenantFeatures;
  onLayoutChange: (next: DashLayoutItem[]) => void;
  onClose: () => void;
  saving: boolean;
  title?: string;
  subtitle?: string;
  onReset?: () => void;
  resetLabel?: string;
}) {
  const presentIds = new Set(layout.map((b) => b.id));
  const addable = (Object.keys(ANALYTICS_META) as AnalyticsMetricId[])
    .filter((id) => !presentIds.has(id) && novaBlockAllowed(id, features))
    .sort((a, b) => ANALYTICS_META[a].label.localeCompare(ANALYTICS_META[b].label));

  function toggleHidden(index: number) {
    const next = layout.slice();
    next[index] = { ...next[index], hidden: !next[index].hidden };
    onLayoutChange(next);
  }
  function reorder(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= layout.length) return;
    onLayoutChange(move(layout, index, target));
  }
  function addWidget(id: AnalyticsMetricId) {
    onLayoutChange([...layout, { id }]);
  }
  function removeWidget(index: number) {
    const next = layout.slice();
    next.splice(index, 1);
    onLayoutChange(next);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div
        style={{
          position: "relative", width: 380, maxWidth: "100%", height: "100%",
          background: "var(--nova-bg)", borderLeft: "1px solid var(--nova-line)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--nova-line-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="nova-display" style={{ fontSize: 16 }}>{title}</div>
            <button
              type="button"
              onClick={onClose}
              style={{ background: "none", border: "none", color: "var(--nova-ink-faint)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--nova-ink-faint)", marginTop: 3 }}>{subtitle}</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginBottom: 10 }}>
            On your Stream
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
            {layout.map((block, i) => {
              const native = isNovaNativeId(block.id);
              return (
                <div
                  key={block.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "var(--nova-glass-bg)", border: "1px solid var(--nova-glass-border)",
                    borderRadius: 10, padding: "8px 10px", opacity: block.hidden ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <button
                      type="button"
                      onClick={() => reorder(i, -1)}
                      disabled={i === 0}
                      style={{ background: "none", border: "none", color: "var(--nova-ink-faint)", cursor: i === 0 ? "default" : "pointer", fontSize: 11, padding: 0, lineHeight: 1, opacity: i === 0 ? 0.3 : 1 }}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => reorder(i, 1)}
                      disabled={i === layout.length - 1}
                      style={{ background: "none", border: "none", color: "var(--nova-ink-faint)", cursor: i === layout.length - 1 ? "default" : "pointer", fontSize: 11, padding: 0, lineHeight: 1, opacity: i === layout.length - 1 ? 0.3 : 1 }}
                    >
                      ▼
                    </button>
                  </div>
                  <div style={{ flex: 1, fontSize: 13, color: "var(--nova-ink)" }}>{novaBlockLabel(block.id)}</div>
                  <button
                    type="button"
                    onClick={() => toggleHidden(i)}
                    title={block.hidden ? "Show" : "Hide"}
                    style={{ background: "none", border: "none", color: "var(--nova-ink-faint)", cursor: "pointer", fontSize: 13 }}
                  >
                    {block.hidden ? "◌" : "●"}
                  </button>
                  {!native && (
                    <button
                      type="button"
                      onClick={() => removeWidget(i)}
                      title="Remove"
                      style={{ background: "none", border: "none", color: "var(--nova-orange-soft)", cursor: "pointer", fontSize: 13 }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {addable.length > 0 && (
            <>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginBottom: 10 }}>
                Add analytics
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {addable.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => addWidget(id)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      background: "var(--nova-glass-bg)", border: "1px solid var(--nova-glass-border)",
                      borderRadius: 10, padding: "8px 12px", cursor: "pointer",
                      fontSize: 13, color: "var(--nova-ink-dim)", textAlign: "left",
                    }}
                  >
                    {ANALYTICS_META[id].label}
                    <span style={{ color: "var(--nova-teal-soft)", fontSize: 15 }}>+</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--nova-line-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              style={{ fontSize: 11.5, color: "var(--nova-ink-faint)", background: "none", border: "1px solid var(--nova-glass-border)", borderRadius: 7, padding: "6px 10px", cursor: "pointer" }}
            >
              {resetLabel}
            </button>
          )}
          <div style={{ fontSize: 10.5, color: "var(--nova-ink-faint)", textAlign: "center" }}>
            {saving ? "Saving…" : "Changes saved automatically"}
          </div>
        </div>
      </div>
    </div>
  );
}
