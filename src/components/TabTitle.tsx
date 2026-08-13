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
  const { tabs, updateTabTitle } = useTabs();

  // Depend on `tabs` so this re-applies once the tab is actually registered:
  // this effect can otherwise fire before the provider's auto-register runs,
  // finding no matching tab and silently no-opping (which left detail tabs
  // showing the raw URL segment / UUID). Guarded on a title mismatch so it
  // doesn't loop.
  useEffect(() => {
    if (!pathname || !title) return;
    const tab = tabs.find((t) => t.href === pathname);
    if (tab && tab.title !== title) updateTabTitle(pathname, title);
  }, [pathname, title, tabs, updateTabTitle]);

  return null;
}
