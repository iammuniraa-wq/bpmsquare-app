"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * TENANT CREATION STUDIO — the operator's side.
 *
 * Describe the client, read the plan, say what to change, press Create. The
 * conversation is a list of what you asked for; the PLAN is the single
 * object that carries state, replaced whole on each turn, so there is never
 * a question of which version is about to be created.
 *
 * Three things this screen refuses to blur:
 *   - Warnings sit above the Create button, not in a log. They are the
 *     server saying "I dropped this" -- an operator who provisions a tenant
 *     without reading them gets a workspace that is quietly wrong.
 *   - The manual steps (Vercel, DNS, Supabase redirect URLs) are shown
 *     before AND after creating, because the tenant is unreachable until a
 *     human does them and nothing here can.
 *   - Initial passwords appear exactly once, in the result. They are not
 *     stored anywhere, by design.
 */

type Plan = {
  tenant: { name: string; slug: string; custom_domain: string; currency: string; plan: string; accent_color: string };
  package: string;
  features: Record<string, boolean>;
  nav_hidden_hrefs: string[];
  admin: { email: string; password?: string };
  roles: { name: string; description?: string; workcenters: { key: string; can_edit: boolean }[] }[];
  users: { email: string; role: string; business_role?: string; employee?: { first_name: string; last_name?: string; wfm_role?: string; designation?: string } }[];
  notes: string[];
};
type Step = { title: string; detail: string };
type Result = {
  tenant_id: string;
  created: string[];
  failed: string[];
  passwords: { email: string; password: string }[];
  manual_steps: Step[];
};

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 18,
};
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280",
};

export default function TenantStudioClient() {
  const [message, setMessage] = useState("");
  const [asked, setAsked] = useState<string[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState<"draft" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const draft = async () => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy("draft");
    setError("");
    try {
      const res = await fetch("/api/admin/tenant-studio/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, plan }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Couldn't draft that."); return; }
      setPlan(json.plan);
      setWarnings(json.warnings ?? []);
      setSteps(json.manual_steps ?? []);
      setAsked((a) => [...a, text]);
      setMessage("");
    } catch {
      setError("Couldn't reach the studio. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!plan || busy) return;
    setBusy("apply");
    setError("");
    try {
      const res = await fetch("/api/admin/tenant-studio/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Couldn't create the tenant."); return; }
      setResult(json);
    } catch {
      setError("Couldn't reach the studio. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); draft(); }
  };

  const modulesOn = plan ? Object.entries(plan.features).filter(([, v]) => v).map(([k]) => k) : [];

  if (result) {
    return (
      <div style={{ display: "grid", gap: 14, maxWidth: 820 }}>
        <div style={{ ...card, borderColor: result.failed.length > 0 ? "#f0a93b" : "#0d8150" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
            {result.failed.length > 0 ? "Tenant created, with some steps left" : "Tenant created"}
          </div>
          <ul style={{ margin: "10px 0 0", paddingLeft: 20, fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
            {result.created.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {result.failed.length > 0 && (
            <>
              <div style={{ ...label, marginTop: 14, color: "#b45309" }}>Didn&apos;t complete</div>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13, color: "#b45309", lineHeight: 1.7 }}>
                {result.failed.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 8, lineHeight: 1.6 }}>
                The tenant itself is live — finish these in{" "}
                <Link href={`/admin/tenants/${result.tenant_id}`} style={{ color: "#1f6feb" }}>its admin page</Link>{" "}
                or the tenant&apos;s own Settings → Team.
              </div>
            </>
          )}
        </div>

        {result.passwords.length > 0 && (
          <div style={{ ...card, background: "#fffbeb", borderColor: "#f0a93b" }}>
            <div style={{ ...label, color: "#92400e" }}>Initial passwords — shown once</div>
            <div style={{ fontSize: 12.5, color: "#92400e", margin: "6px 0 10px", lineHeight: 1.6 }}>
              Copy these now. They are not stored anywhere, and every login is forced to change its
              password on first sign-in. Accounts that already existed keep their own password and
              are not listed.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {result.passwords.map((p) => (
                  <tr key={p.email}>
                    <td style={{ padding: "5px 10px 5px 0", color: "#374151" }}>{p.email}</td>
                    <td style={{ padding: "5px 0", fontFamily: "ui-monospace, monospace", fontWeight: 600, color: "#111827" }}>{p.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ManualSteps steps={result.manual_steps} />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/admin/tenants/${result.tenant_id}`} style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "#1f6feb", borderRadius: 8, padding: "9px 16px", textDecoration: "none" }}>
            Open the tenant
          </Link>
          <button
            onClick={() => { setResult(null); setPlan(null); setAsked([]); setWarnings([]); setSteps([]); }}
            style={{ fontSize: 13, fontWeight: 600, color: "#374151", background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}
          >
            Onboard another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", gap: 16, alignItems: "start" }}>
      {/* ── say what you want ── */}
      <div style={{ display: "grid", gap: 14 }}>
        <div style={card}>
          <div style={label}>{plan ? "Change something" : "Describe the client"}</div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={onKey}
            rows={7}
            placeholder={plan
              ? "e.g. Make it workforce only, add a Site Supervisor role that can edit rosters, and hide Analytics."
              : "e.g. Gulf Fence Contracting in Doha, Qatar. They bought Workforce and Quotations for about 40 site staff. Two supervisors. Domain gulffence.bpmsquare.com, admin alias off sap.rashid@gmail.com. Add three sample users: one admin, one supervisor, one worker."}
            style={{
              width: "100%", marginTop: 8, padding: 10, fontSize: 13.5, lineHeight: 1.6,
              border: "1px solid #d1d5db", borderRadius: 8, resize: "vertical",
              fontFamily: "inherit", color: "#111827", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <button
              onClick={draft}
              disabled={!message.trim() || busy !== null}
              style={{
                fontSize: 13, fontWeight: 600, color: "#fff",
                background: !message.trim() || busy ? "#9ca3af" : "#1f6feb",
                border: "none", borderRadius: 8, padding: "9px 16px",
                cursor: !message.trim() || busy ? "not-allowed" : "pointer",
              }}
            >
              {busy === "draft" ? "Drafting…" : plan ? "Revise the plan" : "Draft the plan"}
            </button>
            <span style={{ fontSize: 11.5, color: "#9ca3af" }}>⌘/Ctrl + Enter</span>
          </div>
          {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#be123c" }}>{error}</div>}
        </div>

        {asked.length > 0 && (
          <div style={card}>
            <div style={label}>What you asked for</div>
            <ol style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 12.5, color: "#6b7280", lineHeight: 1.7 }}>
              {asked.map((a, i) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
            </ol>
          </div>
        )}

        {steps.length > 0 && <ManualSteps steps={steps} />}
      </div>

      {/* ── the plan ── */}
      <div style={{ display: "grid", gap: 14 }}>
        {!plan && (
          <div style={{ ...card, color: "#6b7280", fontSize: 13, lineHeight: 1.7 }}>
            The plan appears here: identity, the modules the tenant will and won&apos;t have, its
            Business Roles, which nav items are hidden, and any users you asked for. Nothing is
            created until you press <b>Create tenant</b>, and you can keep revising by typing.
          </div>
        )}

        {plan && (
          <>
            <div style={card}>
              <div style={label}>Tenant</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#111827", marginTop: 6 }}>{plan.tenant.name || "—"}</div>
              <div style={{ fontSize: 13, color: "#374151", marginTop: 4, lineHeight: 1.8 }}>
                <div><b>Slug</b> {plan.tenant.slug || "—"} <span style={{ color: "#9ca3af" }}>(permanent)</span></div>
                <div><b>Signs in at</b> {plan.tenant.custom_domain || "—"}</div>
                <div><b>Currency</b> {plan.tenant.currency} · <b>Plan</b> {plan.tenant.plan}</div>
              </div>
            </div>

            <div style={card}>
              <div style={label}>Modules on ({modulesOn.length})</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {modulesOn.length === 0
                  ? <span style={{ fontSize: 12.5, color: "#be123c" }}>None — the workspace would open to a bare dashboard.</span>
                  : modulesOn.map((m) => (
                    <span key={m} style={{ fontSize: 11.5, fontWeight: 600, background: "#eef2ff", color: "#3730a3", borderRadius: 20, padding: "3px 10px" }}>{m}</span>
                  ))}
              </div>
              <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 8, lineHeight: 1.6 }}>
                Everything not listed is off. That is what scoping is — a module the client didn&apos;t
                buy is absent from the nav, Settings, search and the API, not merely hidden.
              </div>
              {plan.nav_hidden_hrefs.length > 0 && (
                <>
                  <div style={{ ...label, marginTop: 12 }}>Nav hidden</div>
                  <div style={{ fontSize: 12.5, color: "#374151", marginTop: 4 }}>{plan.nav_hidden_hrefs.join(", ")}</div>
                </>
              )}
            </div>

            {plan.roles.length > 0 && (
              <div style={card}>
                <div style={label}>Business Roles ({plan.roles.length})</div>
                {plan.roles.map((r) => (
                  <div key={r.name} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#111827" }}>{r.name}</div>
                    {r.description && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{r.description}</div>}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                      {r.workcenters.map((w) => (
                        <span key={w.key} style={{ fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "2px 8px", background: w.can_edit ? "#e3f3eb" : "#f3f4f6", color: w.can_edit ? "#0d8150" : "#4b5563" }}>
                          {w.key}{w.can_edit ? " · edit" : " · view"}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={card}>
              <div style={label}>People</div>
              <div style={{ fontSize: 13, color: "#374151", marginTop: 6, lineHeight: 1.8 }}>
                <div><b>Provisioning admin</b> {plan.admin.email || <span style={{ color: "#be123c" }}>none — you would have no way in</span>}</div>
                {plan.users.map((u) => (
                  <div key={u.email}>
                    {u.email} · {u.role}
                    {u.business_role ? ` · ${u.business_role}` : ""}
                    {u.employee ? ` · employee (${u.employee.wfm_role ?? "employee"})` : ""}
                  </div>
                ))}
              </div>
            </div>

            {plan.notes.length > 0 && (
              <div style={card}>
                <div style={label}>Assumptions</div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 12.5, color: "#6b7280", lineHeight: 1.7 }}>
                  {plan.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}

            {warnings.length > 0 && (
              <div style={{ ...card, background: "#fffbeb", borderColor: "#f0a93b" }}>
                <div style={{ ...label, color: "#92400e" }}>Read before creating</div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 12.5, color: "#92400e", lineHeight: 1.7 }}>
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <button
              onClick={apply}
              disabled={busy !== null || !plan.tenant.name || !plan.tenant.slug || !plan.tenant.custom_domain}
              style={{
                fontSize: 14, fontWeight: 700, color: "#fff",
                background: busy || !plan.tenant.name || !plan.tenant.slug || !plan.tenant.custom_domain ? "#9ca3af" : "#0d8150",
                border: "none", borderRadius: 9, padding: "12px 18px",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy === "apply" ? "Creating…" : "Create tenant"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ManualSteps({ steps }: { steps: Step[] }) {
  return (
    <div style={{ ...card, background: "#f8fafc" }}>
      <div style={label}>Still yours to do</div>
      <div style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 10px", lineHeight: 1.6 }}>
        None of these can happen from inside the app, and the tenant is unreachable until the first
        three are done.
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: "#374151", lineHeight: 1.65 }}>
        {steps.map((s) => (
          <li key={s.title} style={{ marginBottom: 8 }}>
            <b>{s.title}.</b> {s.detail}
          </li>
        ))}
      </ol>
    </div>
  );
}
