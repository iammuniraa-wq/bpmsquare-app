"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ROUTES } from "@/lib/constants";
import { orgKey, type ErpOrgChip, type OrgKeyType } from "@/lib/middleware/erpOrgPure";

// The ERP code the Mapping tab holds for a coverage (segment) or an order type, as a small read-only chip that links to the one place
// where it is changed (Settings > Integration middleware > Mapping > Value mapping). Nothing is edited here (rule 6c: one place).

type Codes = Record<string, ErpOrgChip[]>;

let cache: { at: number; promise: Promise<Codes> } | null = null;
const FRESH_MS = 15_000;

function loadCodes(): Promise<Codes> {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache.promise;
  const promise = fetch("/api/settings/erp-org")
    .then((r) => (r.ok ? r.json() : { codes: {} }))
    .then((j: { codes?: Codes }) => j.codes ?? {})
    .catch(() => ({}) as Codes);
  cache = { at: Date.now(), promise };
  return promise;
}

export const mappingHref = (connection: string): string =>
  `${ROUTES.settingsMiddleware}?connector=${encodeURIComponent(connection)}&tab=mapping&view=values`;

export default function ErpOrgChips({ type, id }: { type: OrgKeyType; id: string }) {
  const [chips, setChips] = useState<ErpOrgChip[]>([]);
  useEffect(() => {
    let live = true;
    const key = orgKey(type, id);
    void loadCodes().then((all) => { if (live) setChips(all[key] ?? []); });
    return () => { live = false; };
  }, [type, id]);
  if (chips.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }} data-guide="erp_org.chips">
      {chips.map((chip) => (
        <Link
          key={`${chip.connection}:${chip.kind}`}
          href={mappingHref(chip.connection)}
          title="Change it under Integration middleware, Mapping, Value mapping"
          style={{
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, textDecoration: "none", overflowWrap: "anywhere",
            color: "var(--ink)", background: "var(--panel2)", border: "1px solid var(--line)",
          }}
        >
          {chip.label} {chip.code}
        </Link>
      ))}
    </span>
  );
}
