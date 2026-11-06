"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTenant, useViewableWorkcenters, useIsWfmSupervisor } from "@/lib/tenant-context";
import { buildSpaceGroups, type SpaceGroup } from "@/lib/nova/spaces";

/**
 * Rich phone: what "More" opens. The rail's way of navigating (docs/design/rich-ui.md): every category with its modules under it, one
 * tap to anywhere, and none of the Spaces grid, "Needs you now" or Flows panels of the sidebar. Same categories, same feature, workcenter,
 * supervisor and hidden-menu gating as the rail and the tab bar (buildSpaceGroups), so nothing becomes reachable or unreachable.
 */
export default function RichMoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();
  const features = (tenant?.features ?? {}) as Record<string, boolean>;
  const groups: SpaceGroup[] = buildSpaceGroups(features, viewable, isWfmSupervisor, tenant?.config?.nav_hidden_hrefs ?? []);
  const isOn = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));

  return (
    <>
      {open && <div className="rich-more__scrim" onClick={onClose} aria-hidden="true" />}
      <nav className="rich-more" data-open={open} aria-label="All sections" aria-hidden={!open}>
        <div className="rich-more__grab" aria-hidden="true" />
        {groups.map((g) => {
          const Icon = g.icon;
          return (
            <section key={g.key} className="rich-more__group">
              <h2 className="rich-more__head"><Icon size={20} color="currentColor" />{g.label}</h2>
              <div className="rich-more__grid">
                {g.items.map((it) => {
                  const ItemIcon = it.icon;
                  return (
                    <Link key={it.href} href={it.href} className="rich-more__item" aria-current={isOn(it.href) ? "page" : undefined} tabIndex={open ? 0 : -1} onClick={onClose}>
                      <ItemIcon size={18} color="currentColor" />
                      <span>{it.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
    </>
  );
}
