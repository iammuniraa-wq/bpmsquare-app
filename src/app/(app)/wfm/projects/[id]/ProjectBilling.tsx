"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import { useFeel } from "@/components/FeelProvider";

type Line = { description: string; rate: number; source: string; minutes: number; hours: number; amount: number; cost: number; people: number };
type Billed = { id: string; project_name: string; invoice_id: string; invoice_ref: string; invoice_status: string; period_from: string; period_to: string; minutes: number; amount: number };
type Preview = {
  from: string; to: string; granularity: "project" | "sub_project";
  lines: Line[]; minutes: number; hours: number; subtotal: number;
  cost: number | null; margin_pct: number | null;
  tax: { label: string; rate: number; inclusive: boolean; amount: number };
  total: number; due_date: string; unassigned_minutes: number;
  conflicts: Billed[];
  top_up: { invoice_ref: string; billed_minutes: number; delta_minutes: number; delta_amount: number } | null;
  billed: Billed[]; blockers: string[]; pending_migration?: true;
};

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
const money = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const SOURCE_LABEL: Record<string, string> = {
  project: "project rate", parent: "parent project rate", employment_type: "employment-type rate", default: "workspace rate",
};

function monthRange(offset: number): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(first), to: iso(last) };
}

const th: React.CSSProperties = { fontSize: 11, color: c.hint, fontWeight: 600, padding: "6px 8px", textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 12.5, padding: "7px 8px", borderTop: `1px solid ${c.line}`, verticalAlign: "top" };
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const field: React.CSSProperties = { fontSize: 12.5, padding: "6px 8px", border: `1px solid ${c.line}`, borderRadius: 6, background: c.panel, color: c.ink };
const chip = (on: boolean): React.CSSProperties => ({
  fontSize: 12, fontWeight: on ? 700 : 500, cursor: "pointer", padding: "5px 11px", borderRadius: 6,
  color: on ? c.accent : c.muted, background: on ? c.accentbg : c.panel2,
  border: `1px solid ${on ? c.accent + "60" : c.line}`,
});
const primary: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 7, border: "none",
  background: c.accent, color: "#fff", cursor: "pointer",
};

/**
 * Bill this project's hours to its account: pick a period, see exactly what
 * the invoice would say, raise the draft. Everything that would make the
 * invoice wrong (no account, no rate, a period already billed) is shown as
 * the reason rather than as a failed request.
 */
export default function ProjectBilling({
  projectId, projectName, accountId, isAdmin,
}: {
  projectId: string; projectName: string; accountId: string | null; isAdmin: boolean;
}) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [open, setOpen] = useState(false);
  const [{ from, to }, setPeriod] = useState(() => monthRange(-1));
  const [granularity, setGranularity] = useState<"project" | "sub_project">("project");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [billed, setBilled] = useState<Billed[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadBilled = useCallback(async () => {
    const r = await fetch(`/api/wfm/projects/${projectId}/billing`).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    setBilled(j?.billed ?? []);
  }, [projectId]);

  useEffect(() => { loadBilled(); }, [loadBilled]);

  async function runPreview() {
    setLoading(true); setError(""); setPreview(null);
    const r = await fetch(`/api/wfm/projects/${projectId}/billing?from=${from}&to=${to}&granularity=${granularity}`).catch(() => null);
    setLoading(false);
    if (!r) { setError("Network error"); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Could not build the preview"); return; }
    setPreview(j);
  }

  async function create(topUp: boolean) {
    if (!preview) return;
    const amount = topUp ? preview.top_up!.delta_amount : preview.total;
    const ok = await confirm({
      title: topUp ? `Bill the difference on ${projectName}?` : `Raise a draft invoice for ${projectName}?`,
      body: `${topUp ? hm(preview.top_up!.delta_minutes) : hm(preview.minutes)} for ${fmtDate(from)} – ${fmtDate(to)}, ${money(amount)}${preview.tax.inclusive || topUp ? "" : ` incl. ${preview.tax.label}`}. It lands as a draft you can still edit before sending.`,
      confirmLabel: "Create draft",
    });
    if (!ok) return;
    setCreating(true); setError("");
    const r = await fetch(`/api/wfm/projects/${projectId}/billing`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, granularity, top_up: topUp }),
    }).catch(() => null);
    setCreating(false);
    if (!r) { setError("Network error"); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Could not create the invoice"); return; }
    router.push(ROUTES.invoice(j.id));
  }

  const canRaise = !!preview && preview.blockers.length === 0 && preview.conflicts.length === 0 && isAdmin;
  const canTopUp = !!preview?.top_up && preview.blockers.length === 0 && isAdmin;
  const lastBilled = billed[0];

  return (
    <div style={{ ...cardStyle, padding: 18, marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>Bill hours</div>
          <div style={{ fontSize: 12, color: c.hint, marginTop: 2 }}>
            {billed.length === 0
              ? "Nothing invoiced from this project yet."
              : `${billed.length} invoice${billed.length === 1 ? "" : "s"} · last ${fmtDate(lastBilled.period_from)} – ${fmtDate(lastBilled.period_to)} on ${lastBilled.invoice_ref}`}
          </div>
        </div>
        {!open && (
          <button type="button" style={primary} onClick={() => setOpen(true)}>
            {accountId ? "Bill a period" : "Bill a period…"}
          </button>
        )}
      </div>

      {open && !accountId && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: statusInk.warn, lineHeight: 1.5 }}>
          An invoice needs a customer. Pick an account under <strong>For account</strong> in the form below and save, then come back here.
        </div>
      )}

      {open && accountId && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={chip(false)} onClick={() => setPeriod(monthRange(-1))}>Last month</button>
            <button type="button" style={chip(false)} onClick={() => setPeriod(monthRange(0))}>This month so far</button>
            <input type="date" style={field} value={from} onChange={(e) => setPeriod({ from: e.target.value, to })} />
            <span style={{ color: c.hint, fontSize: 12 }}>to</span>
            <input type="date" style={field} value={to} onChange={(e) => setPeriod({ from, to: e.target.value })} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
            <span style={{ fontSize: 12, color: c.hint }}>Lines:</span>
            <button type="button" style={chip(granularity === "project")} onClick={() => setGranularity("project")}>One line for the project</button>
            <button type="button" style={chip(granularity === "sub_project")} onClick={() => setGranularity("sub_project")}>One per sub-project</button>
            <button type="button" style={{ ...primary, marginLeft: "auto" }} disabled={loading} onClick={runPreview}>
              {loading ? "Working…" : "Preview"}
            </button>
          </div>

          {error && <div style={{ marginTop: 10, fontSize: 12.5, color: statusInk.bad }}>{error}</div>}

          {preview && (
            <div style={{ marginTop: 14 }}>
              {preview.blockers.map((b) => (
                <div key={b} style={{ fontSize: 12.5, color: statusInk.warn, padding: "8px 10px", background: c.panel2, borderRadius: 7, marginBottom: 6, lineHeight: 1.45 }}>{b}</div>
              ))}
              {preview.top_up && (
                <div style={{ fontSize: 12.5, color: c.ink, padding: "8px 10px", background: c.panel2, borderRadius: 7, marginBottom: 6, lineHeight: 1.45 }}>
                  This period was invoiced on <strong>{preview.top_up.invoice_ref}</strong> for {hm(preview.top_up.billed_minutes)}.{" "}
                  <strong>{hm(preview.top_up.delta_minutes)}</strong> has been added since (a correction approved afterwards, for example) — worth {money(preview.top_up.delta_amount)}.
                </div>
              )}
              {preview.unassigned_minutes > 0 && (
                <div style={{ fontSize: 12, color: c.hint, marginBottom: 8, lineHeight: 1.45 }}>
                  {hm(preview.unassigned_minutes)} in this period sits on no project at all. If any of it belongs here, set the project on the{" "}
                  <Link href={ROUTES.wfmRoster} style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}>roster</Link> — future punches follow it.
                </div>
              )}

              {preview.lines.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                    <thead>
                      <tr style={{ background: c.panel2 }}>
                        <th style={th}>Line</th>
                        <th style={{ ...th, ...num }}>People</th>
                        <th style={{ ...th, ...num }}>Hours</th>
                        <th style={{ ...th, ...num }}>Rate</th>
                        <th style={{ ...th, ...num }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((l, i) => (
                        <tr key={i}>
                          <td style={td}>
                            <div style={{ color: c.ink, fontWeight: 500 }}>{l.description}</div>
                            <div style={{ fontSize: 11, color: c.hint }}>{SOURCE_LABEL[l.source] ?? l.source}</div>
                          </td>
                          <td style={{ ...td, ...num, color: c.muted }}>{l.people}</td>
                          <td style={{ ...td, ...num }}>{hm(l.minutes)}</td>
                          <td style={{ ...td, ...num, color: l.rate > 0 ? c.muted : statusInk.bad }}>{l.rate > 0 ? money(l.rate) : "not set"}</td>
                          <td style={{ ...td, ...num, fontWeight: 600 }}>{money(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ ...td, color: c.muted }} colSpan={4}>Subtotal · {hm(preview.minutes)}</td>
                        <td style={{ ...td, ...num, fontWeight: 600 }}>{money(preview.subtotal)}</td>
                      </tr>
                      {!preview.tax.inclusive && preview.tax.rate > 0 && (
                        <tr>
                          <td style={{ ...td, color: c.muted }} colSpan={4}>{preview.tax.label} {preview.tax.rate}% (added on the invoice)</td>
                          <td style={{ ...td, ...num, color: c.muted }}>{money(preview.tax.amount)}</td>
                        </tr>
                      )}
                      <tr>
                        <td style={{ ...td, color: c.ink, fontWeight: 700 }} colSpan={4}>Total · due {fmtDate(preview.due_date)}</td>
                        <td style={{ ...td, ...num, fontWeight: 800, fontSize: 14 }}>{money(preview.total)}</td>
                      </tr>
                      {isAdmin && preview.cost != null && (
                        <tr>
                          <td style={{ ...td, color: c.hint, fontSize: 11.5 }} colSpan={4}>Cost {money(preview.cost)} · margin {preview.margin_pct}% — internal, never printed</td>
                          <td style={td}></td>
                        </tr>
                      )}
                    </tfoot>
                  </table>
                </div>
              )}

              {(canRaise || canTopUp) && (
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  {canRaise && (
                    <button type="button" style={primary} disabled={creating} onClick={() => create(false)}>
                      {creating ? "Creating…" : `Create draft invoice · ${money(preview.total)}`}
                    </button>
                  )}
                  {canTopUp && (
                    <button type="button" style={primary} disabled={creating} onClick={() => create(true)}>
                      {creating ? "Creating…" : `Bill the difference · ${money(preview.top_up!.delta_amount)}`}
                    </button>
                  )}
                </div>
              )}
              {!isAdmin && preview.blockers.length === 0 && (
                <div style={{ marginTop: 10, fontSize: 12, color: c.hint }}>Only an admin can raise the invoice.</div>
              )}
            </div>
          )}
        </div>
      )}

      {billed.length > 0 && (
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
            <thead>
              <tr style={{ background: c.panel2 }}>
                <th style={th}>Invoice</th>
                <th style={th}>Period</th>
                <th style={th}>On</th>
                <th style={{ ...th, ...num }}>Hours</th>
                <th style={{ ...th, ...num }}>Amount</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {billed.map((b) => (
                <tr key={b.id}>
                  <td style={td}>
                    <Link href={ROUTES.invoice(b.invoice_id)} style={{ color: c.accent, textDecoration: "none", fontWeight: 600, fontFamily: "monospace" }}>{b.invoice_ref}</Link>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDate(b.period_from)} – {fmtDate(b.period_to)}</td>
                  <td style={{ ...td, color: c.muted }}>{b.project_name}</td>
                  <td style={{ ...td, ...num }}>{hm(b.minutes)}</td>
                  <td style={{ ...td, ...num, fontWeight: 600 }}>{money(b.amount)}</td>
                  <td style={{ ...td, color: b.invoice_status === "cancelled" ? statusInk.bad : c.muted, textTransform: "capitalize" }}>{b.invoice_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
