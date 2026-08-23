"use client";

import { useEffect, useState } from "react";
import { normalizeCategoryTree, type ProductCategoryNode } from "@/lib/picklists";

export type SalesConfig = {
  product_categories: ProductCategoryNode[];
};

const EMPTY: SalesConfig = { product_categories: [] };
const cache: { data: SalesConfig | null; fetched: boolean } = { data: null, fetched: false };

export function useSalesConfig(): SalesConfig {
  const [cfg, setCfg] = useState<SalesConfig>(cache.data ?? EMPTY);

  useEffect(() => {
    if (cache.fetched) return;
    cache.fetched = true;
    fetch("/api/settings/sales-config")
      .then((r) => r.json())
      .then((data: Record<string, unknown>) => {
        const norm: SalesConfig = {
          product_categories: normalizeCategoryTree(data.product_categories),
        };
        cache.data = norm; setCfg(norm);
      })
      .catch(() => {});
  }, []);

  return cfg;
}
