"use client";

import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Toggle } from "@/components/settings/generalShared";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import { navState, toggleNavItem } from "@/lib/navVisibility";
import type { NavItem, TenantFeatures } from "@/lib/constants";
import { menuGroups, menuRows, type MenuRow } from "./appearanceLogic";
import s from "./appearance.module.css";

/**
 * Which sidebar items the workspace shows: one list, grouped under the sidebar's own section names, a switch per
 * row. A parent bundles its sub-items and switches them together. No pager, no per-row captions.
 */
export default function MenuTab({ hidden, features, accent, onChange, onReset }: {
  hidden: string[];
  features: Partial<TenantFeatures> | undefined;
  accent: string;
  onChange: (next: string[]) => void;
  onReset: () => void;
}) {
  // Only the sub-items this workspace has count toward a parent's state.
  const flags = features as Record<string, boolean> | undefined;
  const hasChild = (ch: NavItem) => !ch.featureKey || flags?.[ch.featureKey] === true;
  const groups = menuGroups(menuRows(features));

  return (
    <div className={s.card}>
      <div className={s.menuBar}>
        <span className={s.name}>Sidebar items<InfoTip label="Sidebar items">{SETTINGS_TIPS.navigation}</InfoTip></span>
        <Button size="sm" onClick={onReset}>Reset to defaults</Button>
      </div>
      <div>
        {groups.map((grp) => (
          <div key={grp.group}>
            <div className={s.groupHead}>{grp.group}</div>
            {grp.items.map((item: MenuRow) => {
              const state = navState(hidden, item, hasChild);
              const on = state !== "off";
              return (
                <div key={`${item.indent ? "child" : "row"}:${item.href}`} className={`${s.menuRow} ${item.indent ? s.menuRowIndent : ""}`} data-off={!on}>
                  <span className={s.menuIcon} aria-hidden="true">{item.icon}</span>
                  <span className={s.menuName}>{item.label}{state === "mixed" && <span className={s.menuMixed}>Some hidden</span>}</span>
                  <Toggle on={on} label={item.label} accent={accent} onChange={() => onChange(toggleNavItem(hidden, item, hasChild))} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
