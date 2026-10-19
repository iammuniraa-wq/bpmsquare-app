"use client";

import { useEffect, useState } from "react";
import type { CurrentSupplier } from "@/lib/rfq/currentSupplier";

// What both RFQ forms need to choose suppliers: every active supplier of the
// tenant, the tenant's own RFQ history for the products asked about, and the
// current supplier of each product.

export type PickerSupplier = { id: string; name: string; email: string | null; city: string | null; status: string; ref?: string | null };
export type SuggestedSupplier = { supplier_id: string; name: string; awarded: number; quoted: number; last_awarded_at: string | null };
export type CurrentForProduct = CurrentSupplier & { product_id: string };

export function useRfqSuppliers(productIds: string[]) {
  const [suppliers, setSuppliers] = useState<PickerSupplier[] | null>(null);
  const [suggested, setSuggested] = useState<SuggestedSupplier[] | null>(null);
  const [current, setCurrent] = useState<CurrentForProduct[] | null>(null);
  const key = [...new Set(productIds.filter(Boolean))].sort().join(",");

  useEffect(() => {
    fetch("/api/suppliers").then((r) => (r.ok ? r.json() : [])).then((d) => {
      setSuppliers(Array.isArray(d) ? d.filter((s: PickerSupplier) => s.status !== "inactive") : []);
    }).catch(() => setSuppliers([]));
  }, []);

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

  return { suppliers, suggested, current, loading: suppliers === null || suggested === null || current === null };
}
