"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SettingsSection from "@/components/settings/SettingsSection";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { BidVersionSummary } from "@/lib/tender/bids/rules";
import type { LinkedQuote } from "@/lib/sales/opportunityServer";
import BoqDownloads from "./BoqDownloads";

// "Documents we send" on the Bid tab of a tender deal (redesign, docs/design/gcc-tender-deals.md section 26): the priced BOQ Excel and the
// answer sheet (never a cost or a markup), and the Standard Quotes made from this deal. A quote is made from a CHOSEN bid version, keeps
// the client's own item numbers and links back to the deal; the quotes already made are listed here. This is where the old Quotes tab
// and the header's "Convert to Standard Quote" went for a tender.

const SHOWN_QUOTES = 5;
const fmtDay = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function BidDocuments({ opportunityId, versions, quotes, canMakeQuote, fmt, onError, onNotice, onChanged }: {
  opportunityId: string;
  versions: readonly BidVersionSummary[];
  quotes: readonly LinkedQuote[];
  /** Standard Quotes are on in this workspace and the caller may change the deal. */
  canMakeQuote: boolean;
  fmt: (n: number) => string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [version, setVersion] = useState(String(versions[0]?.version_no ?? ""));
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? quotes : quotes.slice(0, SHOWN_QUOTES);

  async function makeQuote() {
    onError(""); onNotice("");
    if (!version) { onError("Pick a bid version"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "standard_quote", bid_version: Number(version) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not make the quote"); return; }
      onNotice(`Standard Quote ${j.ref ?? ""} made from version ${version}`.replace("  ", " "));
      onChanged?.();
      router.push(ROUTES.standardQuote(j.id));
    } finally { setBusy(false); }
  }

  return (
    <SettingsSection id="tender.bids.documents" title="Documents we send" info={TENDER_TIPS.bidDocuments} summary={quotes.length === 0 ? "Priced BOQ, answer sheet" : `Priced BOQ, answer sheet, ${quotes.length} quote${quotes.length === 1 ? "" : "s"}`} defaultOpen>
      <div data-guide="tender.bid.documents" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <BoqDownloads opportunityId={opportunityId} />

        {canMakeQuote && (
          <div data-guide="tender.bid.quote" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
            {versions.length === 0 ? (
              <span style={{ fontSize: 12.5, color: c.hint }}>Submit a bid first. A quote is made from a saved version.</span>
            ) : (
              <>
                <Field label="Version" guide="tender.bid.quote_version">
                  <Select value={version} onChange={(e) => setVersion(e.target.value)} style={{ minHeight: 44 }}>
                    {versions.map((v) => <option key={v.id} value={v.version_no}>Version {v.version_no} · {fmt(v.total)}</option>)}
                  </Select>
                </Field>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Button variant="secondary" loading={busy} style={{ minHeight: 44 }} data-guide="tender.bid.make_quote" onClick={() => void makeQuote()}>Make a Standard Quote from this version</Button>
                  <InfoTip label="Standard Quote">{TENDER_TIPS.bidQuote}</InfoTip>
                </span>
              </>
            )}
          </div>
        )}

        {quotes.length > 0 && (
          <div data-guide="tender.bid.quotes" style={{ border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden" }}>
            {shown.map((q, i) => (
              <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 13, flexWrap: "wrap", minHeight: 44 }}>
                <Link href={q.object === "standard_quote" ? ROUTES.standardQuote(q.id) : ROUTES.quotation(q.id)} data-guide="tender.bid.quote_link" style={{ color: c.accent, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", minHeight: 44 }}>{q.ref}</Link>
                <span style={{ fontSize: 11.5, color: c.hint }}>{q.object === "standard_quote" ? "Standard Quote" : "Quotation"} · {fmtDay(q.created_at)}{i === 0 ? " · latest" : ""}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "capitalize" }}>{q.status}</span>
                <span style={{ marginLeft: "auto", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(q.subtotal)}</span>
              </div>
            ))}
          </div>
        )}
        {!showAll && quotes.length > SHOWN_QUOTES && (
          <div><Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="tender.bid.quotes_show_all" onClick={() => setShowAll(true)}>Show all {quotes.length}</Button></div>
        )}
      </div>
    </SettingsSection>
  );
}
