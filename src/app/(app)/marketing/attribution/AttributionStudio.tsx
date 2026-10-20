"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import { Group, StudioTour, cx, studio as styles, type TourStep } from "@/components/marketing/StudioKit";
import { formatMoney, type CurrencyDef } from "@/lib/currency";
import {
  ASSET_HINT, ASSET_LABEL, ASSET_TYPES, MODEL_HINT, MODEL_LABEL, MODELS, MODES, MODE_HINT, MODE_LABEL, WINDOW_DAYS, interpretation,
  type AssetType, type Mode, type Model,
} from "@/lib/marketing/attribution/models";
import type { ReportRow } from "@/lib/marketing/attribution/server";

// "Revenue by campaign" in the studio layout: the choices on the left (each with a one-line hint), the answer on the
// right, the panel above the answer on a phone. Changing a choice reloads the page with the new choice in the
// address, so every view can be linked and nothing is computed in the browser.

type Sec = "bySec" | "modelSec" | "modeSec";

export default function AttributionStudio({ by, model, mode, rows, computedAt, dealsConsidered, currency, canRefresh }: {
  by: AssetType; model: Model; mode: Mode; rows: ReportRow[]; computedAt: string | null; dealsConsidered: number; currency: CurrencyDef; canRefresh: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Sec | null>("bySec");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "stop"; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const money = (n: number) => formatMoney(n, currency);

  const go = useCallback((next: Partial<{ by: AssetType; model: Model; mode: Mode }>) => {
    const q = new URLSearchParams({ by: next.by ?? by, model: next.model ?? model, mode: next.mode ?? mode });
    router.push(`/marketing/attribution?${q.toString()}`);
  }, [router, by, model, mode]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function refresh() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/attribution/recompute", { method: "POST" });
    const j = (await res.json().catch(() => ({}))) as { error?: string; touches?: number; rows?: number };
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "stop", text: j.error ?? "Could not refresh the figures." }); return; }
    setMsg({ tone: "ok", text: "Figures refreshed." });
    router.refresh();
  }

  const notes = interpretation(model, mode, by, dealsConsidered);
  const withCredit = rows.filter((r) => r.sourcedDeals > 0 || r.influencedDeals > 0);
  const total = rows.reduce((t, r) => ({ won: t.won + r.sourcedWonValue, open: t.open + r.sourcedOpenValue, deals: t.deals + r.sourcedDeals }), { won: 0, open: 0, deals: 0 });
  const updated = computedAt ? new Date(computedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const toggle = (s: Sec) => setOpen((o) => (o === s ? null : s));

  const tour: TourStep[] = [
    { target: "bySec", text: "Choose what you want to look at: campaigns, newsletters, forms, journeys, WhatsApp templates or events." },
    { target: "modelSec", text: "Choose who gets the credit for starting a deal. First touch, last touch and an even share answer different questions, so try all three." },
    { target: "modeSec", text: "Choose what counts as a touch. By default only something a person did counts, because being sent a message is not influence." },
    { target: "attCanvas", text: "Here is the answer. Read the notes under the table: they say what these figures can and cannot tell you." },
  ];

  return (
    <div className={styles.accent}>
      <PageHeader
        title="Revenue by campaign"
        subtitle={updated ? `Figures updated ${updated}` : "Not calculated yet"}
        action={
          <span className={styles.headRow}>
            <StudioTour steps={tour} storageKey="bpm.attribution.tour.step" />
            {canRefresh && <Button loading={busy} onClick={() => void refresh()}>Refresh figures</Button>}
          </span>
        }
      />
      {msg && <div className={cx(styles.check, msg.tone === "stop" && styles.stop)} role="status">{msg.text}</div>}

      <div className={styles.studio}>
        <div className={styles.panel}>
          <Group id="bySec" title="What to look at" summary={ASSET_LABEL[by]} hint="The kind of thing you want to see revenue for." open={open === "bySec"} onToggle={() => toggle("bySec")}>
            <div role="radiogroup" aria-label="What to look at" style={{ display: "grid", gap: 8 }}>
              {ASSET_TYPES.map((a) => (
                <label key={a} className={styles.chk}>
                  <input type="radio" name="by" checked={by === a} onChange={() => go({ by: a })} />
                  <span><b>{ASSET_LABEL[a]}</b><br /><span className={styles.hint}>{ASSET_HINT[a]}</span></span>
                </label>
              ))}
            </div>
          </Group>
          <Group id="modelSec" title="Who gets the credit" summary={MODEL_LABEL[model]} hint="How the credit for starting a deal is shared." open={open === "modelSec"} onToggle={() => toggle("modelSec")}>
            <div role="radiogroup" aria-label="Who gets the credit" style={{ display: "grid", gap: 8 }}>
              {MODELS.map((m) => (
                <label key={m} className={styles.chk}>
                  <input type="radio" name="model" checked={model === m} onChange={() => go({ model: m })} />
                  <span><b>{MODEL_LABEL[m]}</b><br /><span className={styles.hint}>{MODEL_HINT[m]}</span></span>
                </label>
              ))}
            </div>
          </Group>
          <Group id="modeSec" title="What counts as a touch" summary={MODE_LABEL[mode]} hint={`Looking back ${WINDOW_DAYS} days from each deal.`} open={open === "modeSec"} onToggle={() => toggle("modeSec")}>
            <div role="radiogroup" aria-label="What counts as a touch" style={{ display: "grid", gap: 8 }}>
              {MODES.map((m) => (
                <label key={m} className={styles.chk}>
                  <input type="radio" name="mode" checked={mode === m} onChange={() => go({ mode: m })} />
                  <span><b>{MODE_LABEL[m]}</b><br /><span className={styles.hint}>{MODE_HINT[m]}</span></span>
                </label>
              ))}
            </div>
          </Group>
        </div>

        <div className={styles.canvas} id="attCanvas">
          <div className={styles.card}>
            <h2>{ASSET_LABEL[by]} <small>{MODEL_LABEL[model].toLowerCase()}, looking back {WINDOW_DAYS} days</small></h2>
            <div className={styles.kpis}>
              <div className={styles.kpi}><b>{money(total.won)}</b><span>Won, where it started</span></div>
              <div className={styles.kpi}><b>{money(total.open)}</b><span>Open, where it started</span></div>
              <div className={styles.kpi}><b>{Math.round(total.deals * 10) / 10}</b><span>Deals started</span></div>
              <div className={styles.kpi}><b>{dealsConsidered}</b><span>Deals in all</span></div>
            </div>

            {rows.length === 0 ? (
              <p className={styles.help} style={{ padding: "8px 0" }}>
                {updated
                  ? `No ${ASSET_LABEL[by].toLowerCase()} have touched a company yet. Once people click, fill in forms or register, they appear here.`
                  : "Nothing has been calculated yet. An admin can press Refresh figures, or it happens by itself every few hours."}
              </p>
            ) : (
              <div className={styles.scroll}>
                <table className={styles.logTable}>
                  <thead>
                    <tr>
                      <th>{ASSET_LABEL[by].replace(/s$/, "")}</th><th>Companies</th><th>Deals started</th><th>Open</th><th>Won</th><th>Paid</th><th>Deals touched</th><th>Won touched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.assetId}>
                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                        <td>{r.people}</td>
                        <td>{r.sourcedDeals ? Math.round(r.sourcedDeals * 10) / 10 : "—"}</td>
                        <td>{r.sourcedOpenValue ? money(r.sourcedOpenValue) : "—"}</td>
                        <td>{r.sourcedWonValue ? money(r.sourcedWonValue) : "—"}</td>
                        <td>{r.sourcedPaidValue ? money(r.sourcedPaidValue) : "—"}</td>
                        <td>{r.influencedDeals || "—"}</td>
                        <td>{r.influencedWonValue ? `${money(r.influencedWonValue)} (${r.influencedWonDeals})` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > 0 && withCredit.length === 0 && <p className={styles.help}>These {ASSET_LABEL[by].toLowerCase()} touched companies, but none of those companies has a deal in the last {WINDOW_DAYS} days yet.</p>}
          </div>

          <div className={styles.card}>
            <h2>How to read this</h2>
            <ul style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 6, fontSize: 13, lineHeight: 1.5 }}>
              {notes.map((n) => <li key={n}>{n}</li>)}
              <li>Paid is the money received on invoices raised from the deal&apos;s quotes, shared in the same proportion.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
