"use client";

import { useEffect, useRef } from "react";
import type { TenderDeskStyle } from "@/lib/tenderDesk/types";
import InfoTip from "@/components/ui/InfoTip";
import { DASH_LOOK_TIP } from "@/lib/tenderDesk/tips";
import { DASH_LOOK_ATTR, dashLookCss } from "./dashLookCss";
import s from "./tenderBlocks.module.css";

/**
 * Makes the whole page dark while the dashboard is on "Control room". It renders the stylesheet (dashLookCss.ts) and a marker element, both
 * server-side, so the first paint is dark; nothing is rendered for "Bold" (or a workspace without the tender edition, which passes null).
 * Both leave the page with the dashboard, so no other screen can inherit the look. The effect marks the shell as well, for browsers
 * without :has(), and removes the mark when the look changes or the dashboard unmounts.
 */
export function DashLookScope({ look }: { look: TenderDeskStyle | null }) {
  const marker = useRef<HTMLSpanElement>(null);
  const control = look === "control";
  useEffect(() => {
    if (!control) return;
    const shell = marker.current?.closest("[data-theme]");
    shell?.setAttribute(DASH_LOOK_ATTR, "control");
    return () => shell?.removeAttribute(DASH_LOOK_ATTR);
  }, [control]);
  if (!control) return null;
  return (
    <>
      <style data-dash-look-style="">{dashLookCss()}</style>
      <span ref={marker} hidden {...{ [DASH_LOOK_ATTR]: "control" }} />
    </>
  );
}

const OPTIONS: { value: TenderDeskStyle; label: string }[] = [
  { value: "bold", label: "Bold" },
  { value: "control", label: "Control room" },
];

/** "Bold | Control room", next to Curated | My layout. A radio group: arrows move, the chosen look is marked. */
export function LookSwitch({ look, busy, onChange }: { look: TenderDeskStyle; busy?: boolean; onChange: (next: TenderDeskStyle) => void }) {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = OPTIONS.findIndex((o) => o.value === look);
    const next = OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length];
    buttons.current[next.value]?.focus();
    onChange(next.value);
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      <span className={s.seg} role="radiogroup" aria-label="Dashboard look" aria-busy={busy || undefined} data-guide="tender.dash.look" onKeyDown={onKeyDown}>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            ref={(el) => { buttons.current[o.value] = el; }}
            type="button"
            role="radio"
            aria-checked={look === o.value}
            tabIndex={look === o.value ? 0 : -1}
            className={s.segBtn}
            data-guide={`tender.dash.look.${o.value}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </span>
      <InfoTip label="Dashboard look">{DASH_LOOK_TIP}</InfoTip>
    </span>
  );
}
