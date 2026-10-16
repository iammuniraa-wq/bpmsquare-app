"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import {
  activeSettingsItemId, filterSettingsMenu, type SettingsMenuGroup,
} from "@/lib/settingsMenu";

/**
 * Two-pane Settings: grouped menu left, the chosen page right. On a phone the
 * menu IS the page at /settings and a settings page is a sub-page with an
 * "All settings" way back -- the swap is CSS (`data-root`), so the menu is
 * one set of links in the DOM at every width.
 */
export default function SettingsShell({
  groups, children,
}: {
  groups: SettingsMenuGroup[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const isRoot = pathname === ROUTES.settings;
  const activeId = activeSettingsItemId(groups, pathname);
  const shown = useMemo(() => filterSettingsMenu(groups, query), [groups, query]);
  const matchCount = shown.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="bpm-settings" data-root={isRoot ? "true" : "false"}>
      <nav className="bpm-settings-nav" aria-label="Settings">
        <div className="bpm-settings-search">
          <label htmlFor={searchId} className="bpm-sr-only">Search settings</label>
          <input
            id={searchId}
            type="search"
            className="bpm-input"
            placeholder="Search settings"
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]?.items[0]) router.push(shown[0].items[0].href);
              else if (e.key === "Escape") setQuery("");
            }}
          />
        </div>
        <div role="status" className="bpm-sr-only">
          {query.trim() ? `${matchCount} setting${matchCount === 1 ? "" : "s"} found` : ""}
        </div>

        {shown.length === 0 ? (
          <p className="bpm-settings-none">No setting matches &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          shown.map((g) => (
            <div key={g.id} className="bpm-settings-group" role="group" aria-label={g.label}>
              <div className="bpm-settings-group-label" aria-hidden="true">{g.label}</div>
              <ul className="bpm-settings-list">
                {g.items.map((item) => {
                  const active = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className="bpm-settings-item"
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="bpm-settings-item-text">
                          <span className="bpm-settings-item-label">
                            {item.label}
                            {item.external && <span aria-hidden="true" className="bpm-settings-ext"> ↗</span>}
                          </span>
                          <span className="bpm-settings-item-desc">{item.description}</span>
                        </span>
                        <span aria-hidden="true" className="bpm-settings-chevron">›</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>

      <div className="bpm-settings-main">
        {!isRoot && (
          <Link href={ROUTES.settings} className="bpm-settings-back">← All settings</Link>
        )}
        {children}
      </div>
    </div>
  );
}
