"use client";

import { useEffect, useState } from "react";

export type SalesConfig = { territories: string[]; sales_orgs: string[] };

const cache: { data: SalesConfig | null; fetched: boolean } = { data: null, fetched: false };

export function useSalesConfig(): SalesConfig {
  const [cfg, setCfg] = useState<SalesConfig>(cache.data ?? { territories: [], sales_orgs: [] });

  useEffect(() => {
    if (cache.fetched) return;
    cache.fetched = true;
    fetch("/api/settings/sales-config")
      .then((r) => r.json())
      .then((data: SalesConfig) => { cache.data = data; setCfg(data); })
      .catch(() => {});
  }, []);

  return cfg;
}
