"use client";

import { useEffect, useState } from "react";

export type ProductCategoryDef = { name: string; subs: string[] };
export type SalesConfig = { territories: string[]; sales_orgs: string[]; product_categories: ProductCategoryDef[] };

const EMPTY: SalesConfig = { territories: [], sales_orgs: [], product_categories: [] };
const cache: { data: SalesConfig | null; fetched: boolean } = { data: null, fetched: false };

export function useSalesConfig(): SalesConfig {
  const [cfg, setCfg] = useState<SalesConfig>(cache.data ?? EMPTY);

  useEffect(() => {
    if (cache.fetched) return;
    cache.fetched = true;
    fetch("/api/settings/sales-config")
      .then((r) => r.json())
      .then((data: Partial<SalesConfig>) => {
        const norm: SalesConfig = {
          territories: data.territories ?? [],
          sales_orgs: data.sales_orgs ?? [],
          product_categories: data.product_categories ?? [],
        };
        cache.data = norm; setCfg(norm);
      })
      .catch(() => {});
  }, []);

  return cfg;
}
