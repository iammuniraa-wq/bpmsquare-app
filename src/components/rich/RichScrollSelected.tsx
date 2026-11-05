"use client";

import { useEffect, useRef } from "react";

/**
 * Wraps a tab strip and, when it mounts, scrolls the selected tab into view inside the strip. A shared link to a tab far along a
 * scrollable pill strip on a phone would otherwise open with its tab off screen. `block: "nearest"` keeps the page itself still.
 */
export default function RichScrollSelected({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  return <div ref={ref} className="rich-acct__tabs">{children}</div>;
}
