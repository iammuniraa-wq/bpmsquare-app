"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";

/**
 * Settings is a hub (see /settings/page.tsx) — a menu of destinations, each
 * its own full page. This used to be a horizontal tab strip listing every
 * destination on every settings page; that grows unbounded as settings
 * sections are added and starts to look like an afterthought. Replaced with
 * a small "back to the hub" link, shown on every settings page except the
 * hub itself.
 */
export default function SettingsTabs({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHub = pathname === ROUTES.settings;

  return (
    <>
      {!isHub && (
        <Link
          href={ROUTES.settings}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 12.5, fontWeight: 500, color: c.muted,
            textDecoration: "none", marginBottom: 16,
          }}
        >
          ← Settings
        </Link>
      )}
      {children}
    </>
  );
}
