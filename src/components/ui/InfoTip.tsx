"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { guideUrl } from "@/lib/guideLinks";
import { isSheetMode, placePopover, tipButtonAria } from "@/lib/infoTip";

type Props = {
  /** The label this tip explains: aria-label ("About <label>") and the sheet's title. */
  label: string;
  /** The explanation: plain words, at most two short sentences (160 characters). */
  children: React.ReactNode;
  /** Key into GUIDE_LINKS: adds "Learn more" once the guide's address is configured. */
  guide?: string;
  placement?: "below" | "above";
};

const sheetNow = () =>
  typeof window !== "undefined" && isSheetMode(window.innerWidth, window.matchMedia("(pointer: coarse)").matches);
const hoverCapable = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * The "i" after a label (docs/design/ux-simplification.md §2a). Desktop: opens on hover (150 ms) and keyboard focus,
 * a click pins it so "Learn more" can be reached, Esc closes. Under 900 px or on touch: a bottom sheet with a
 * Close button. Never place it inside another button: the studio group header is a row for that reason.
 */
export default function InfoTip({ label, children, guide, placement = "below" }: Props) {
  const id = useId();
  const popId = `tip-${id}`;
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const href = guideUrl(guide);

  const clearTimers = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  };
  const close = useCallback((returnFocus = false) => {
    clearTimers();
    setOpen(false); setPinned(false); setAt(null);
    if (returnFocus) btn.current?.focus();
  }, []);
  useEffect(() => clearTimers, []);

  const openPopover = () => { setSheet(false); setOpen(true); };
  const openSheet = () => { setSheet(true); setOpen(true); setPinned(true); };

  // Position after the popover has a size; keep it in place while the page scrolls or resizes.
  const place = useCallback(() => {
    if (!btn.current || !pop.current) return;
    const t = btn.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const r = placePopover(t, { width: p.width, height: p.height }, { width: window.innerWidth, height: window.innerHeight }, placement);
    setAt({ top: r.top, left: r.left });
  }, [placement]);
  useLayoutEffect(() => {
    if (!open || sheet) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, sheet, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(true); } };
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (btn.current?.contains(n) || pop.current?.contains(n)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open, close]);

  // The sheet holds the page still, moves focus in, and hands it back on close.
  useEffect(() => {
    if (!open || !sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => { document.body.style.overflow = prev; btn.current?.focus(); };
  }, [open, sheet]);

  function onClick() {
    if (sheetNow()) { if (open) close(); else openSheet(); return; }
    if (open && pinned) { close(); return; }
    openPopover(); setPinned(true);
  }

  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const items = Array.from(pop.current?.querySelectorAll<HTMLElement>("a[href], button") ?? []);
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const aria = tipButtonAria(label, open, popId, sheet);
  const body = (
    <>
      {children}
      {href && <a className="bpm-tip-learn" href={href} target="_blank" rel="noopener noreferrer">Learn more</a>}
    </>
  );

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="bpm-tip"
        {...aria}
        onClick={onClick}
        onMouseEnter={() => {
          if (!hoverCapable() || sheetNow() || pinned) return;
          clearTimers();
          hoverTimer.current = setTimeout(openPopover, 150);
        }}
        onMouseLeave={() => {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          if (pinned || sheet) return;
          leaveTimer.current = setTimeout(() => close(), 200);
        }}
        onFocus={() => { if (!sheetNow() && !open) openPopover(); }}
        onBlur={() => { if (!pinned && !sheet) leaveTimer.current = setTimeout(() => close(), 120); }}
        onKeyDown={(e) => {
          // A pinned popover with a link: Tab goes into it, since it lives outside the button's DOM neighbourhood.
          if (e.key === "Tab" && !e.shiftKey && open && pinned && !sheet && href) {
            const link = pop.current?.querySelector<HTMLElement>("a");
            if (link) { e.preventDefault(); link.focus(); }
          }
        }}
      >
        <span aria-hidden="true">i</span>
      </button>

      {open && !sheet && typeof document !== "undefined" && createPortal(
        <div
          ref={pop}
          id={popId}
          role="tooltip"
          className="bpm-tip-pop"
          style={at ? { top: at.top, left: at.left } : { top: 0, left: 0, visibility: "hidden" }}
          onMouseEnter={() => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }}
          onMouseLeave={() => { if (!pinned) leaveTimer.current = setTimeout(() => close(), 200); }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && href) { close(true); }
          }}
        >
          {body}
        </div>,
        document.body,
      )}

      {open && sheet && typeof document !== "undefined" && createPortal(
        <>
          <div className="bpm-sheet-backdrop" onClick={() => close()} />
          <div ref={pop} id={popId} role="dialog" aria-modal="true" aria-labelledby={`${popId}-t`} className="bpm-sheet" onKeyDown={trapTab}>
            <h3 id={`${popId}-t`}>{label}</h3>
            <p>{children}</p>
            {href && <a className="bpm-tip-learn" href={href} target="_blank" rel="noopener noreferrer">Learn more</a>}
            <div className="bpm-sheet-acts"><button ref={closeBtn} type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" onClick={() => close()}>Close</button></div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
