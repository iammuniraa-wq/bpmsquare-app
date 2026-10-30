"use client";

import { useEffect, useState } from "react";

/** Phone layout (cards) under 900 px, table above. A prop fixes it, for a server render. */
export function useCards(fixed?: "table" | "cards"): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (fixed) return;
    const mq = window.matchMedia("(max-width: 900px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [fixed]);
  return fixed ? fixed === "cards" : narrow;
}
