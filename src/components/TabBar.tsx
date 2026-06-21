"use client";

import { useRef, useState, useEffect, useLayoutEffect } from "react";
import { useTabs } from "@/lib/tabs-context";
import { c, g } from "@/lib/theme";

export default function TabBar() {
  const { tabs, activeHref, focusTab, closeTab } = useTabs();
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

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  };

  const btn: React.CSSProperties = {
    flexShrink: 0, width: 28, height: 28, borderRadius: 6, border: "none",
    background: "transparent", color: "#9db3c4", cursor: "pointer",
    fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background .12s, color .12s",
  };

  return (
    <div style={{
      display: "flex", alignItems: "center",
      borderBottom: "1px solid rgba(255,255,255,.07)",
      background: g.sidebar,
      height: 36, minHeight: 36, flexShrink: 0,
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
                minWidth: 100, maxWidth: 180, flexShrink: 0,
                height: 36,
                background: active ? "rgba(255,255,255,.09)" : "transparent",
                borderBottom: active ? `2px solid ${c.accent}` : "2px solid transparent",
                cursor: "pointer",
                borderRight: "1px solid rgba(255,255,255,.05)",
                position: "relative",
                transition: "background .12s",
              }}
              onClick={() => focusTab(tab.href)}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,.04)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 11, flexShrink: 0, opacity: 0.7 }}>{tab.icon}</span>
              <span style={{
                fontSize: 12, fontWeight: active ? 600 : 400,
                color: active ? "#e2e7ee" : "#8fa8be",
                flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {tab.title}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.href); }}
                title="Close tab"
                style={{
                  flexShrink: 0, width: 16, height: 16, borderRadius: 3,
                  border: "none", background: "transparent",
                  color: "#6b8599", cursor: "pointer", fontSize: 12, lineHeight: 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,.12)"; e.currentTarget.style.color = "#e2e7ee"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#6b8599"; }}
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

      {/* Dropdown — all tabs */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          style={{ ...btn, width: 32 }}
          onClick={() => setDropOpen((v) => !v)}
          title={`All tabs (${tabs.length})`}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: "#8fa8be" }}>
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
              width: 240, background: "#152233",
              border: "1px solid rgba(255,255,255,.1)", borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,.5)",
              zIndex: 401, overflow: "hidden",
              padding: "4px 0",
            }}>
              {tabs.map((tab) => {
                const active = tab.href === activeHref;
                return (
                  <button
                    key={tab.href}
                    onClick={() => { focusTab(tab.href); setDropOpen(false); }}
                    style={{
                      width: "100%", textAlign: "left",
                      padding: "8px 14px", border: "none",
                      background: active ? "rgba(55,138,221,.2)" : "transparent",
                      color: active ? "#e2e7ee" : "#8fa8be",
                      fontSize: 12.5, fontWeight: active ? 600 : 400,
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,.05)"; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? "rgba(55,138,221,.2)" : "transparent"; }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{tab.icon}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.title}</span>
                    {active && <span style={{ fontSize: 10, color: c.accent }}>●</span>}
                    <span
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.href); setDropOpen(false); }}
                      style={{ color: "#4a6070", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#e2e7ee"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "#4a6070"; }}
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
