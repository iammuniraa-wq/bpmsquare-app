"use client";

import { useEffect, useState } from "react";

/**
 * Viewport-width hook for layouts that need a genuinely different STRUCTURE
 * on a phone (a 16-column table becoming cards), not just different styling
 * — those stay in CSS. SSR renders the desktop shape (false) and the first
 * client effect corrects it, so use this only where a one-frame desktop
 * flash on mobile is acceptable.
 */
export function useIsMobile(maxWidth = 700): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxWidth]);
  return mobile;
}
