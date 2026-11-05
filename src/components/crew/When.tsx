"use client";

import { useEffect, useState } from "react";

/** "5 min ago", "3 h ago", "2 days ago" or a date: a pure function so it is tested. */
export function agoLabel(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** A time that is the same on the server and in the browser until it mounts (no hydration mismatch), then reads in the viewer's clock. */
export default function When({ iso, mode = "ago" }: { iso: string | null; mode?: "ago" | "stamp" }) {
  const [text, setText] = useState(() => (iso ? iso.slice(0, 10) : ""));
  useEffect(() => {
    if (!iso) return;
    const t = Date.parse(iso);
    setText(mode === "ago" ? agoLabel(iso, Date.now()) : new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
  }, [iso, mode]);
  if (!iso) return <>Never</>;
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
