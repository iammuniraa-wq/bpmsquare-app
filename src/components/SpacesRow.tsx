"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTenant, useViewableWorkcenters, useIsWfmSupervisor, useIsSpectacular } from "@/lib/tenant-context";
import { buildSpaceGroups, type SpaceGroup } from "@/lib/nova/spaces";
import { MOBILE_BREAKPOINT } from "@/lib/constants";

/**
 * SPACES, on the classic rail — one icon per NAV group (Sales, Service,
 * Master data, Workforce, …), with that group's modules in a labelled
 * flyout beside the rail. Nova's best navigation idea, brought to
 * Spectacular (owner request 2026-09-21: "bring spaces only from nova to
 * spectacular"). Only Spaces: nothing else from Nova's rail comes with it.
 *
 * WHY THIS IS NOT NovaSidebar's COPY. The thinking and every gating rule
 * live in lib/nova/spaces.ts — buildSpaceGroups() applies exactly the
 * featureKey / workcenter / supervisorOnly rules Sidebar.tsx enforces, so a
 * module this tenant hasn't bought can never appear here. That shared
 * function is the part worth sharing. The MARKUP is deliberately separate,
 * because Nova's is welded to machinery that does not exist on this rail:
 * its SectionHead and `maximized` state (maximizing Spaces swaps in this
 * very sidebar), its attention dots (getNovaStreamItems, a Nova-only
 * signal), and a flyout anchored at a hardcoded left: 272 — Nova's own rail
 * width. Threading ten props through a live experimental surface to share
 * eighty lines of layout would have been the riskier trade.
 *
 * So the two differ on purpose: no maximize toggle (the full nav tree is
 * already right below this), no attention dots, and the flyout is anchored
 * off this rail's MEASURED edge rather than a constant. What it does share
 * is every rule about what may be shown.
 *
 * Painted entirely in --sb-* tokens, so it belongs to whichever theme
 * mounts it — light ink on Spectacular's navy palette, white on purple's
 * violet shell, with no branch here.
 */
export default function SpacesRow({ onNavigate }: { onNavigate?: () => void }) {
  const spectacular = useIsSpectacular();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();
  const pathname = usePathname() || "/";
  const router = useRouter();

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close on an outside click or Escape. Both refs are checked, or clicking
  // a row inside the flyout would close it before the link navigated.
  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rowRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenKey(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKey]);

  // Every navigation closes it, including one made from the flyout itself.
  useEffect(() => { setOpenKey(null); }, [pathname]);

  if (!spectacular) return null;

  const groups = buildSpaceGroups(
    (tenant?.features ?? {}) as Record<string, boolean>,
    viewable,
    isWfmSupervisor
  );
  if (groups.length === 0) return null;

  const open = groups.find((g) => g.key === openKey) ?? null;

  // A single-item group has nothing to choose between, so it navigates
  // instead of opening a one-row menu.
  const onClick = (g: SpaceGroup, e: React.MouseEvent<HTMLButtonElement>) => {
    if (g.items.length === 1) {
      // router.push, not window.location: a full document reload would drop
      // the whole client tree -- open tabs, drawer state, every fetched
      // list -- to move one screen inside the same app.
      onNavigate?.();
      router.push(g.items[0].href);
      return;
    }
    if (openKey === g.key) { setOpenKey(null); return; }
    // Measured, not assumed: this rail is 236px, 210px compact or 56px
    // collapsed, and on a phone it is an overlay drawer.
    const rect = (e.currentTarget.closest("[data-spaces-row]") as HTMLElement | null)?.getBoundingClientRect();
    const railRect = rowRef.current?.closest(".bpm-sidebar-rail")?.getBoundingClientRect();
    setAnchor({
      top: Math.min(rect?.top ?? 80, Math.max(80, window.innerHeight - 420)),
      left: (railRect?.right ?? 240) + 8,
    });
    setOpenKey(g.key);
  };

  return (
    <>
      <div ref={rowRef} data-spaces-row style={{ padding: "0 4px 10px" }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
          color: "var(--sb-text-faint)", padding: "0 6px 6px",
        }}>
          Spaces
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5 }}>
          {groups.map((g) => {
            const Icon = g.icon;
            const active = g.items.some((it) => pathname === it.href || pathname.startsWith(it.href + "/"));
            const isOpen = openKey === g.key;
            return (
              <button
                key={g.key}
                type="button"
                title={g.label}
                aria-label={g.label}
                aria-expanded={g.items.length > 1 ? isOpen : undefined}
                onClick={(e) => onClick(g, e)}
                style={{
                  position: "relative", aspectRatio: "1", display: "flex",
                  alignItems: "center", justifyContent: "center",
                  borderRadius: 9, cursor: "pointer", minWidth: 0, padding: 0,
                  background: active || isOpen ? "var(--sb-hover-strong)" : "var(--sb-hover)",
                  border: `1px solid ${isOpen ? "var(--sb-tab-underline, var(--sb-line))" : "var(--sb-line)"}`,
                }}
              >
                <Icon size={18} color={active || isOpen ? "var(--sb-strong)" : "var(--sb-icon-muted)"} />
                {active && (
                  <span style={{
                    position: "absolute", left: 9, right: 9, bottom: 3, height: 2, borderRadius: 2,
                    background: "var(--sb-tab-underline, var(--sb-strong))",
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* On a phone the rail IS an overlay drawer with nothing beside it, so
            the list opens inline underneath rather than flying out. A fixed
            panel would also mis-anchor: the drawer's translateX transform
            makes "fixed" resolve against the drawer, not the viewport. */}
        {isMobile && open && (
          <div style={{
            marginTop: 8, background: "var(--sb-hover)", border: "1px solid var(--sb-line)",
            borderRadius: 11, padding: 4,
          }}>
            {open.items.map((it) => (
              <SpaceLink key={it.href} item={it} pathname={pathname} onDone={() => { setOpenKey(null); onNavigate?.(); }} />
            ))}
          </div>
        )}
      </div>

      {!isMobile && open && anchor && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={open.label}
          style={{
            position: "fixed", top: anchor.top, left: anchor.left, zIndex: 130,
            minWidth: 224, maxWidth: 280, maxHeight: "min(480px, 78vh)", overflowY: "auto",
            background: "var(--sb-panel-bg)", border: "1px solid var(--sb-panel-border)",
            borderRadius: 13, boxShadow: "var(--shadow-raised, 0 12px 40px rgba(0,0,0,.28))", padding: 6,
          }}
        >
          <div style={{
            fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
            color: "var(--sb-panel-text-dim)", padding: "7px 10px 6px",
          }}>
            {open.label}
          </div>
          {open.items.map((it) => (
            <SpaceLink key={it.href} item={it} pathname={pathname} panel onDone={() => { setOpenKey(null); onNavigate?.(); }} />
          ))}
        </div>
      )}
    </>
  );
}

function SpaceLink({
  item, pathname, onDone, panel,
}: {
  item: { href: string; label: string; icon: React.ComponentType<{ size?: number; color?: string }> };
  pathname: string;
  onDone: () => void;
  panel?: boolean;
}) {
  const Icon = item.icon;
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  // The flyout is a light sheet of its own (--sb-panel-*), the inline mobile
  // list sits on the rail -- so each takes the ink of the surface it is on.
  const ink = panel ? "var(--sb-panel-text)" : "var(--sb-text)";
  const inkDim = panel ? "var(--sb-panel-text-dim)" : "var(--sb-text-dim)";
  return (
    <Link
      href={item.href}
      role={panel ? "menuitem" : undefined}
      onClick={onDone}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
        borderRadius: 8, textDecoration: "none",
        background: active ? (panel ? "var(--sb-panel-hover)" : "var(--sb-hover-strong)") : "transparent",
      }}
    >
      <Icon size={15} color={active ? ink : inkDim} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? ink : inkDim,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {item.label}
      </span>
    </Link>
  );
}
