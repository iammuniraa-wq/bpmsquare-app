"use client";

import { useEffect, useRef } from "react";

/** Ease-out cubic; t is clamped to 0..1. Exported for the test. */
export function countUpValue(from: number, to: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return from + (to - from) * (1 - Math.pow(1 - k, 3));
}

/**
 * A number that counts up to its value once on mount (docs/design/rich-ui.md, motion explains). The server render and anyone with
 * prefers-reduced-motion get the final, formatted number straight away, so it is never wrong, only sometimes still. Updating `value`
 * later just shows the new number. Writes to the DOM node directly so the count costs no React renders.
 */
export default function CountUp({ value, format, duration = 900, className }: {
  value: number;
  /** Formats each step; default is the locale string, with up to two decimals for non-integers. */
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = format ?? ((n: number) => (Number.isInteger(value) ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 })));
  const first = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!first.current || reduced || !Number.isFinite(value)) {
      first.current = false;
      el.textContent = fmt(value);
      return;
    }
    first.current = false;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / duration;
      el.textContent = fmt(countUpValue(0, value, t));
      if (t < 1) raf = requestAnimationFrame(step);
      else el.textContent = fmt(value);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // fmt is rebuilt every render; the count restarts only when the value or duration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(value)}</span>;
}
