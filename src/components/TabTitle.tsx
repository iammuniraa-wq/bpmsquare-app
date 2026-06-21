"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTabs } from "@/lib/tabs-context";

/**
 * Drop into any server-component detail page to set the tab title to the
 * entity's real ref (e.g. "Q-2024-001", "C-2024-005", "Crompton Greaves").
 * Runs client-side after hydration — no server round-trip.
 */
export default function TabTitle({ title }: { title: string }) {
  const pathname = usePathname();
  const { updateTabTitle } = useTabs();

  useEffect(() => {
    if (pathname && title) updateTabTitle(pathname, title);
  }, [pathname, title, updateTabTitle]);

  return null;
}
