"use client";

import { useEffect, useState } from "react";
import type { CurrentSupplier } from "@/lib/rfq/currentSupplier";

// What both RFQ forms need to choose suppliers: every active supplier of the
// tenant, the tenant's own RFQ history for the products asked about, and the
// current supplier of each product.
//
// A tender deal passes `source` (tenderSupplierSource): the deal's own list,
// which holds only the client's approved group when the deal's account has one
// (`restricted`). The server enforces that on create; here the picker simply
// does not offer the others, and the history chips are cut to the same list.
// If the source cannot be read the ordinary list is used, so a form never
// opens empty because of it.

export type PickerSupplier = { id: string; name: string; email: string | null; city: string | null; status: string; ref?: string | null; type?: string | null };
export type SuggestedSupplier = { supplier_id: string; name: string; awarded: number; quoted: number; last_awarded_at: string | null };
export type CurrentForProduct = CurrentSupplier & { product_id: string };
/** `restricted` = the client has an approved group and the list is its members; `group` names it when the route says. */
export type SupplierScope = { restricted: boolean; group: string | null };

/** The list a tender deal's RFQ forms read: GET returns `{ restricted, suppliers: [{ id, name, email, phone, type, city }] }`. */
export const tenderSupplierSource = (opportunityId: string) => `/api/opportunities/${opportunityId}/tender/costing/suppliers`;

/** Reads the source's answer: `{ restricted, suppliers, group? }` or a bare list (read as unrestricted). */
export function readSupplierSource(json: unknown): { suppliers: PickerSupplier[]; scope: SupplierScope } {
  const list = (v: unknown): PickerSupplier[] =>
    (Array.isArray(v) ? v : [])
      .filter((s): s is PickerSupplier => !!s && typeof (s as PickerSupplier).id === "string")
      .map((s) => ({ ...s, email: s.email ?? null, city: s.city ?? null, status: s.status ?? "active" }))
      .filter((s) => s.status !== "inactive");
  if (Array.isArray(json)) return { suppliers: list(json), scope: { restricted: false, group: null } };
  const j = (json ?? {}) as { restricted?: boolean; suppliers?: unknown; group?: { name?: string } | string | null; group_name?: string | null };
  const group = typeof j.group === "string" ? j.group : j.group?.name ?? j.group_name ?? null;
  return { suppliers: list(j.suppliers), scope: { restricted: j.restricted === true, group } };
}

export function useRfqSuppliers(productIds: string[], source?: string) {
  const [suppliers, setSuppliers] = useState<PickerSupplier[] | null>(null);
  const [scope, setScope] = useState<SupplierScope | null>(null);
  const [suggested, setSuggested] = useState<SuggestedSupplier[] | null>(null);
  const [current, setCurrent] = useState<CurrentForProduct[] | null>(null);
  const key = [...new Set(productIds.filter(Boolean))].sort().join(",");

  useEffect(() => {
    const ordinary = () => fetch("/api/suppliers").then((r) => (r.ok ? r.json() : [])).then((d) => {
      setSuppliers(Array.isArray(d) ? d.filter((s: PickerSupplier) => s.status !== "inactive") : []);
    }).catch(() => setSuppliers([]));
    if (!source) { void ordinary(); return; }
    let live = true;
    fetch(source, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("source")))).then((j) => {
      if (!live) return;
      const read = readSupplierSource(j);
      setSuppliers(read.suppliers); setScope(read.scope);
    }).catch(() => { if (live) { setScope({ restricted: false, group: null }); void ordinary(); } });
    return () => { live = false; };
  }, [source]);

  useEffect(() => {
    if (!key) { setSuggested([]); setCurrent([]); return; }
    let cancelled = false;
    setSuggested(null); setCurrent(null);
    fetch(`/api/rfqs/suggest-suppliers?product_ids=${key}`).then((r) => (r.ok ? r.json() : {})).then((j: { suppliers?: SuggestedSupplier[]; current?: Record<string, CurrentSupplier | null> }) => {
      if (cancelled) return;
      setSuggested(j.suppliers ?? []);
      const map = j.current ?? {};
      setCurrent(Object.entries(map).filter((e): e is [string, CurrentSupplier] => !!e[1]).map(([product_id, v]) => ({ ...v, product_id })));
    }).catch(() => { if (!cancelled) { setSuggested([]); setCurrent([]); } });
    return () => { cancelled = true; };
  }, [key]);

  // A restricted list also cuts the history chips and the current-supplier hints to the approved suppliers.
  const allowed = scope?.restricted && suppliers ? new Set(suppliers.map((s) => s.id)) : null;
  const suggestedShown = allowed && suggested ? suggested.filter((s) => allowed.has(s.supplier_id)) : suggested;
  const currentShown = allowed && current ? current.filter((x) => allowed.has(x.supplier_id)) : current;

  return { suppliers, suggested: suggestedShown, current: currentShown, scope, loading: suppliers === null || suggested === null || current === null };
}
