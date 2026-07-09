"use client";

import {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";

export type Tab = {
  href: string;   // unique key — one tab per URL
  title: string;
  icon: string;
  section: string; // small type label shown below title
};

type TabsCtx = {
  tabs: Tab[];
  activeHref: string;
  openTab: (href: string, title?: string, icon?: string) => void;
  closeTab: (href: string) => void;
  closeAllTabs: () => void;
  focusTab: (href: string) => void;
  updateTabTitle: (href: string, title: string) => void;
  limitWarning: boolean;
  clearLimitWarning: () => void;
};

const Ctx = createContext<TabsCtx | null>(null);

const noopTabs: TabsCtx = {
  tabs: [], activeHref: "",
  openTab: () => {}, closeTab: () => {}, closeAllTabs: () => {},
  focusTab: () => {}, updateTabTitle: () => {},
  limitWarning: false, clearLimitWarning: () => {},
};

export function useTabs() {
  return useContext(Ctx) ?? noopTabs;
}

// ── Derive title + icon from pathname ────────────────────────────────────────

// Returns a short human-readable ID from the last URL segment (for detail tabs).
// UUIDs are truncated to 6 chars; ref-like strings (e.g. Q-2024-001) kept as-is.
function shortId(href: string): string {
  const seg = href.split("/").filter(Boolean).pop() ?? "";
  if (seg.length === 36 && seg.includes("-")) return seg.slice(0, 6).toUpperCase();
  return seg.length > 12 ? seg.slice(0, 10) + "…" : seg;
}

function tabMeta(href: string): { title: string; icon: string; section: string } {
  const p = href.split("?")[0];
  if (p === ROUTES.dashboard)           return { title: "Dashboard",           icon: "◈", section: "Home" };
  if (p === ROUTES.pipeline)            return { title: "Pipeline",            icon: "▦", section: "Sales" };
  if (p === ROUTES.leads)               return { title: "Leads",               icon: "◎", section: "Marketing" };
  if (p === ROUTES.accounts)            return { title: "Accounts",            icon: "▣", section: "Workspace" };
  if (p.startsWith("/accounts/new"))    return { title: "New Account",         icon: "▣", section: "Accounts" };
  if (p.startsWith("/accounts/"))       return { title: shortId(p),            icon: "▣", section: "Account" };
  if (p === ROUTES.contacts)            return { title: "Contacts",            icon: "◉", section: "Workspace" };
  if (p.startsWith("/contacts/new"))    return { title: "New Contact",         icon: "◉", section: "Contacts" };
  if (p === ROUTES.assets)              return { title: "Assets",              icon: "◧", section: "Records" };
  if (p === ROUTES.suppliers)           return { title: "Suppliers",           icon: "◫", section: "Records" };
  if (p.startsWith("/suppliers/new"))   return { title: "New Supplier",        icon: "◫", section: "Suppliers" };
  if (p.startsWith("/suppliers/"))      return { title: shortId(p),            icon: "◫", section: "Supplier" };
  if (p.startsWith("/assets/new"))      return { title: "New Asset",           icon: "◧", section: "Assets" };
  if (p === ROUTES.quotations)          return { title: "Quotations",          icon: "₹", section: "Sales" };
  if (p.startsWith("/quotations/new"))  return { title: "New Quote",           icon: "₹", section: "Quotations" };
  if (p.startsWith("/quotations/"))     return { title: shortId(p),            icon: "₹", section: "Quotation" };
  if (p === ROUTES.cases)               return { title: "Cases",               icon: "◉", section: "Service" };
  if (p.startsWith("/cases/"))          return { title: shortId(p),            icon: "◉", section: "Case" };
  if (p === ROUTES.amc)                 return { title: "AMC Contracts",       icon: "◫", section: "Service" };
  if (p === ROUTES.workOrders)          return { title: "Work Orders",         icon: "▤", section: "Field" };
  if (p.startsWith("/work-orders/"))    return { title: shortId(p),            icon: "▤", section: "Work Order" };
  if (p === ROUTES.dispatch)            return { title: "Dispatch",            icon: "◐", section: "Field" };
  if (p === ROUTES.invoices)            return { title: "Invoices",            icon: "⊟", section: "Records" };
  if (p === ROUTES.technicians)         return { title: "Technicians",         icon: "◑", section: "Field" };
  if (p.startsWith("/technicians/"))    return { title: shortId(p),            icon: "◑", section: "Technician" };
  if (p.startsWith(ROUTES.settings))   return { title: "Settings",            icon: "◈", section: "Config" };
  if (p === ROUTES.reports)             return { title: "Analytics",           icon: "◧", section: "Records" };
  if (p.startsWith(ROUTES.admin))       return { title: "Admin",               icon: "◈", section: "System" };
  if (p === ROUTES.dataWorkbench)       return { title: "Data Workbench",      icon: "⇅", section: "Admin" };
  return { title: p.split("/").filter(Boolean).pop() ?? "Page", icon: "◫", section: "" };
}

const MAX_TABS = 20;
const STORAGE_KEY = "vvcrm_tabs";

function load(): Tab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function save(tabs: Tab[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs)); } catch { /* noop */ }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [limitWarning, setLimitWarning] = useState(false);
  const tabsRef = useRef<Tab[]>([]);
  const initRef = useRef(false);
  const lastValidHref = useRef<string>("");

  // Load from localStorage on first mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const stored = load();
    tabsRef.current = stored.length ? stored : [];
    setTabs(tabsRef.current);
  }, []);

  // Auto-register every page visit as a tab
  useEffect(() => {
    if (!pathname) return;
    setTabs((prev) => {
      const exists = prev.find((t) => t.href === pathname);
      if (exists) {
        lastValidHref.current = pathname;
        return prev;
      }
      if (prev.length >= MAX_TABS) {
        setLimitWarning(true);
        // Navigate back to last valid tab — user must close one first
        const fallback = lastValidHref.current || (prev[prev.length - 1]?.href ?? ROUTES.dashboard);
        router.replace(fallback);
        return prev;
      }
      const meta = tabMeta(pathname);
      const next = [...prev, { href: pathname, ...meta }];
      tabsRef.current = next;
      save(next);
      lastValidHref.current = pathname;
      return next;
    });
  }, [pathname, router]);

  // Prefetch all open tab routes so switching is instant
  useEffect(() => {
    tabs.forEach((t) => {
      if (t.href !== pathname) router.prefetch(t.href);
    });
  }, [tabs, pathname, router]);

  const openTab = useCallback((href: string, title?: string, icon?: string) => {
    const meta = tabMeta(href);
    setTabs((prev) => {
      const exists = prev.find((t) => t.href === href);
      if (exists) { router.push(href); return prev; }
      if (prev.length >= MAX_TABS) {
        setLimitWarning(true);
        return prev;
      }
      const tab: Tab = { href, title: title ?? meta.title, icon: icon ?? meta.icon, section: meta.section };
      const next = [...prev, tab];
      tabsRef.current = next;
      save(next);
      router.push(href);
      return next;
    });
  }, [router]);

  const clearLimitWarning = useCallback(() => setLimitWarning(false), []);

  const closeTab = useCallback((href: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.href === href);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.href !== href);
      tabsRef.current = next;
      save(next);
      if (href === pathname) {
        const target = next[idx] ?? next[idx - 1];
        if (target) router.push(target.href);
        else router.push(ROUTES.dashboard);
      }
      return next;
    });
  }, [pathname, router]);

  const closeAllTabs = useCallback(() => {
    tabsRef.current = [];
    save([]);
    setTabs([]);
    setLimitWarning(false);
    router.push(ROUTES.dashboard);
  }, [router]);

  const updateTabTitle = useCallback((href: string, title: string) => {
    setTabs((prev) => {
      const next = prev.map((t) => t.href === href ? { ...t, title } : t);
      save(next);
      return next;
    });
  }, []);

  const focusTab = useCallback((href: string) => {
    router.push(href);
  }, [router]);

  return (
    <Ctx.Provider value={{ tabs, activeHref: pathname, openTab, closeTab, closeAllTabs, focusTab, updateTabTitle, limitWarning, clearLimitWarning }}>
      {children}
    </Ctx.Provider>
  );
}
