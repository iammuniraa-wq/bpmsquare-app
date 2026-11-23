"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { CheckOpt } from "@/components/ui/Opt";

type Option = { id: string; label: string; value: string; entity: string };

/** "Print on documents": which of the company's extra ids (a vendor number, for example) this customer sees on printed
 *  documents. The ids are set once on the legal entity; the choice belongs to the customer, never to a name match. */
export default function AccountPrintIds({ accountId, options, selected }: { accountId: string; options: Option[]; selected: string[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(selected);
  const [error, setError] = useState("");

  async function toggle(id: string, on: boolean) {
    const next = on ? [...picked, id] : picked.filter((x) => x !== id);
    setPicked(next);
    setError("");
    const res = await fetch(`/api/accounts/${accountId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ print_ids: next }) }).catch(() => null);
    if (!res || !res.ok) { setPicked(picked); setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not save") : "Network error"); return; }
    router.refresh();
  }

  return (
    <Card padding={14}>
      <div className="bpm-label-row" style={{ marginBottom: 6 }}>
        <span className="bpm-t-label">Print on documents</span>
        <InfoTip label="Print on documents">The ids ticked here print in the header of this customer&apos;s quotations. They are set on the legal entity in Settings &gt; Company.</InfoTip>
      </div>
      <div data-guide="account.print-ids">
        {options.map((o) => (
          <CheckOpt key={o.id} label={`${o.label}: ${o.value}${o.entity ? ` (${o.entity})` : ""}`} checked={picked.includes(o.id)} onChange={(on) => toggle(o.id, on)} />
        ))}
      </div>
      {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 12.5, marginTop: 6 }}>{error}</div>}
    </Card>
  );
}
