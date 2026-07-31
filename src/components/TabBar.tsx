"use client";

import { useRef, useState, useEffect, useLayoutEffect } from "react";
import { useTabs } from "@/lib/tabs-context";
import { c } from "@/lib/theme";
import { AlertTriangle, XIcon, Dot } from "@/components/Icons";

export default function TabBar() {
  const { tabs, activeHref, focusTab, closeTab, closeAllTabs, limitWarning, clearLimitWarning } = useTabs();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft]   = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);

  // Update arrow visibility whenever tabs or scroll position changes
  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useLayoutEffect(() => { checkScroll(); }, [tabs]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => { el.removeEventListener("scroll", checkScroll); window.removeEventListener("resize", checkScroll); };
  }, []);

  // Scroll active tab into view when it changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeEl = el.querySelector<HTMLElement>("[data-active='true']");
    activeEl?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeHref]);

  if (tabs.length === 0) return null;

  const MAX_TABS = 20; // mirror of tabs-context constant — for display only

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  };

  const btn: React.CSSProperties = {
    flexShrink: 0, width: 28, height: 28, borderRadius: 6, border: "none",
    background: "transparent", color: "var(--sb-icon-muted)", cursor: "pointer",
    fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background .12s, color .12s",
  };

  return (
    <div style={{
      display: "flex", alignItems: "center",
      borderBottom: "1px solid var(--sb-line)",
      background: "var(--sb-bar-bg)",
      height: 42, minHeight: 42, flexShrink: 0,
      position: "relative",
    }}>
      {/* Left arrow */}
      <button
        style={{ ...btn, opacity: canLeft ? 1 : 0.25, pointerEvents: canLeft ? "auto" : "none" }}
        onClick={() => scroll("left")}
        title="Scroll tabs left"
      >‹</button>

      {/* Tab strip */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, display: "flex", alignItems: "stretch",
          overflowX: "auto", scrollbarWidth: "none",
          gap: 1,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.href === activeHref;
          return (
            <div
              key={tab.href}
              data-active={active}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "0 10px 0 12px",
                minWidth: 110, maxWidth: 180, flexShrink: 0,
                height: 42,
                background: active ? "var(--sb-hover-strong)" : "transparent",
                borderBottom: active ? `2px solid var(--sb-tab-underline, ${c.accent})` : "2px solid transparent",
                cursor: "pointer",
                borderRight: "1px solid var(--sb-line)",
                position: "relative",
                transition: "background .12s",
              }}
              onClick={() => focusTab(tab.href)}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--sb-hover)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 11, flexShrink: 0, opacity: 0.7 }}>{tab.icon}</span>
              <span style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <span style={{
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  color: active ? "var(--sb-strong)" : "var(--sb-text-dim)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  lineHeight: "1.2",
                }}>
                  {tab.title}
                </span>
                {tab.section && (
                  <span style={{
                    fontSize: 9, color: active ? "var(--sb-tab-sub-active, #5a8ab0)" : "var(--sb-text-faint)",
                    textTransform: "uppercase", letterSpacing: "0.04em",
                    lineHeight: "1.2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {tab.section}
                  </span>
                )}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.href); }}
                title="Close tab"
                style={{
                  flexShrink: 0, width: 16, height: 16, borderRadius: 3,
                  border: "none", background: "transparent",
                  color: "var(--sb-text-dim)", cursor: "pointer", fontSize: 12, lineHeight: 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--sb-hover-strong)"; e.currentTarget.style.color = "var(--sb-strong)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--sb-text-dim)"; }}
              >×</button>
            </div>
          );
        })}
      </div>

      {/* Right arrow */}
      <button
        style={{ ...btn, opacity: canRight ? 1 : 0.25, pointerEvents: canRight ? "auto" : "none" }}
        onClick={() => scroll("right")}
        title="Scroll tabs right"
      >›</button>

      {/* Max-tabs warning toast */}
      {limitWarning && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)",
          background: "var(--amberbg)", border: "1px solid var(--amberline)",
          borderRadius: 8, padding: "8px 14px",
          display: "flex", alignItems: "center", gap: 10,
          boxShadow: "0 4px 20px rgba(0,0,0,.25)",
          zIndex: 500, whiteSpace: "nowrap",
          animation: "vvcrm-fadein .18s ease",
        }}>
          <AlertTriangle size={14} color="var(--amberc)" />
          <span style={{ fontSize: 12.5, color: "var(--amberink)", fontWeight: 500 }}>
            Maximum {MAX_TABS} tabs open — close a tab to open a new one.
          </span>
          <button
            onClick={clearLimitWarning}
            style={{ background: "none", border: "none", color: "#7a9ab5", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px", marginLeft: 4 }}
            title="Dismiss"
          >×</button>
        </div>
      )}

      {/* Dropdown — all tabs */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          style={{ ...btn, width: 32 }}
          onClick={() => setDropOpen((v) => !v)}
          title={`All tabs (${tabs.length})`}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--sb-text-dim)" }}>
            {tabs.length} ▾
          </span>
        </button>

        {dropOpen && (
          <>
            <div
              onClick={() => setDropOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 400 }}
            />
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", right: 0,
              width: 240, background: "var(--sb-panel-bg)",
              border: "1px solid var(--sb-panel-border)", borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,.5)",
              zIndex: 401, overflow: "hidden",
              padding: "4px 0",
            }}>
              {/* Close all */}
              <button
                onClick={() => { closeAllTabs(); setDropOpen(false); }}
                style={{
                  width: "100%", textAlign: "left",
                  padding: "7px 14px", border: "none", borderBottom: "1px solid var(--sb-panel-border)",
                  background: "transparent", color: "#e05a5a",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  marginBottom: 2,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(224,90,90,.12)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <XIcon size={13} color="#e05a5a" /> Close all tabs
              </button>
              {tabs.map((tab) => {
                const active = tab.href === activeHref;
                return (
                  <button
                    key={tab.href}
                    onClick={() => { focusTab(tab.href); setDropOpen(false); }}
                    style={{
                      width: "100%", textAlign: "left",
                      padding: "8px 14px", border: "none",
                      // Derived from --modern-accent (falls back to the base --accent
                      // token for classic/modern1) rather than --sb-active-bg -- that
                      // token is tuned for a translucent pill on the solid modern2 blue
                      // BAR and goes near-invisible reused here, against this dropdown's
                      // own (white/panel-coloured) background.
                      background: active ? "color-mix(in srgb, var(--modern-accent, var(--accent)) 20%, transparent)" : "transparent",
                      color: active ? "var(--sb-panel-text)" : "var(--sb-panel-text-dim)",
                      fontSize: 12.5, fontWeight: active ? 600 : 400,
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--sb-panel-hover)"; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? "color-mix(in srgb, var(--modern-accent, var(--accent)) 20%, transparent)" : "transparent"; }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.7, flexShrink: 0 }}>{tab.icon}</span>
                    <span style={{ flex: 1, overflow: "hidden" }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.title}</span>
                      {tab.section && <span style={{ display: "block", fontSize: 10, color: "var(--sb-panel-text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{tab.section}</span>}
                    </span>
                    {active && <Dot size={8} color="var(--modern-accent, var(--accent))" />}
                    <span
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.href); setDropOpen(false); }}
                      style={{ color: "var(--sb-panel-text-dim)", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--sb-panel-text)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--sb-panel-text-dim)"; }}
                    >×</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
