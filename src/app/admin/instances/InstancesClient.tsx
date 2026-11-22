"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import Pill from "@/components/Pill";
import type { PillarKey } from "@/lib/theme";
import type { InstanceCard, InstanceState, TenantLine } from "@/lib/controlPlane/view";
import { INSTANCE_TIPS } from "./tips";

const CHIP: Record<InstanceState, { label: string; tone: PillarKey }> = {
  healthy: { label: "Healthy", tone: "green" },
  unreachable: { label: "Unreachable", tone: "red" },
  planned: { label: "Planned", tone: "blue" },
  unchecked: { label: "Not checked", tone: "amber" },
  retired: { label: "Retired", tone: "purple" },
};

const ROWS_SHOWN = 10;
const TAP = { minHeight: 44 } as const;
const when = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "never");

// Page chrome follows the admin layout beside it (a fixed light surface); the controls are the shared components.
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, minWidth: 0 };

type Draft = { name: string; slug: string; base_url: string; region: string; db_host: string; branch: string; status: string };
const EMPTY: Draft = { name: "", slug: "", base_url: "https://", region: "", db_host: "", branch: "", status: "planned" };

export default function InstancesClient({ cards, tenants, registryPending, signingConfigured }: {
  cards: InstanceCard[];
  tenants: TenantLine[];
  registryPending: boolean;
  signingConfigured: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const remote = cards.filter((c) => c.id !== null);
  const shown = showAll ? tenants : tenants.slice(0, ROWS_SHOWN);

  async function refresh(id: string): Promise<void> {
    setBusy(`refresh:${id}`);
    setMessage(null);
    const res = await fetch(`/api/admin/instances/${id}/refresh`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setMessage(typeof body.error === "string" ? body.error : "Refresh failed");
    setBusy(null);
    router.refresh();
  }

  async function refreshAll(): Promise<void> {
    for (const c of remote) if (c.id && c.state !== "planned" && c.state !== "retired") await refresh(c.id);
  }

  async function openAdmin(instanceId: string, next?: string): Promise<void> {
    setBusy(`open:${instanceId}`);
    setMessage(null);
    // The tab opens inside the click so a pop-up blocker allows it; it is pointed at the signed address once that exists.
    const tab = window.open("", "_blank");
    const res = await fetch(`/api/admin/instances/${instanceId}/handoff`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ next }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || typeof body.url !== "string") {
      tab?.close();
      setMessage(typeof body.error === "string" ? body.error : "Could not open the admin");
      return;
    }
    if (tab) { tab.opener = null; tab.location.href = body.url; } else window.location.assign(body.url);
  }

  async function setStatus(id: string, status: string): Promise<void> {
    setBusy(`status:${id}`);
    setMessage(null);
    const res = await fetch(`/api/admin/instances/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setMessage(typeof body.error === "string" ? body.error : "Could not change the status");
    setBusy(null);
    router.refresh();
  }

  async function register(): Promise<void> {
    setBusy("register");
    setFormError(null);
    const res = await fetch("/api/admin/instances", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setFormError(typeof body.error === "string" ? body.error : "Could not register the instance"); return; }
    setPanel(false);
    setDraft(EMPTY);
    router.refresh();
  }

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div>
      <style>{`
        .cp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
        .cp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .cp-table th { text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
        .cp-table td { padding: 10px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        @media (max-width: 700px) {
          .cp-table thead { display: none; }
          .cp-table, .cp-table tbody, .cp-table tr, .cp-table td { display: block; width: 100%; box-sizing: border-box; }
          .cp-table tr { padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
          .cp-table td { border: 0; padding: 3px 0; }
          .cp-table td[data-label]::before { content: attr(data-label) " "; color: #6b7280; font-size: 11px; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>
            Instances <InfoTip label="Instances">{INSTANCE_TIPS.page}</InfoTip>
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: "#6b7280" }}>
            {cards.length} instance{cards.length !== 1 ? "s" : ""} · {tenants.length} tenant{tenants.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {remote.length > 0 && (
            <Button style={TAP} onClick={refreshAll} loading={busy?.startsWith("refresh:")} disabled={!signingConfigured || registryPending}>Refresh all</Button>
          )}
          <Button variant="primary" style={TAP} onClick={() => { setFormError(null); setPanel(true); }} disabled={registryPending}>Register instance</Button>
        </div>
      </div>

      {registryPending && (
        <div role="status" style={{ ...card, marginBottom: 12, color: "#854d0e", background: "#fef9c3", borderColor: "#fde68a" }}>
          The instance registry needs a database update (migration 0247). Until it runs, only this app is listed.
        </div>
      )}
      {!signingConfigured && !registryPending && remote.length > 0 && (
        <div role="status" style={{ ...card, marginBottom: 12, color: "#854d0e", background: "#fef9c3", borderColor: "#fde68a" }}>
          CONTROL_PLANE_PRIVATE_KEY is not set here, so Refresh and Open admin are off.
        </div>
      )}
      {message && (
        <div role="alert" style={{ ...card, marginBottom: 12, color: "#991b1b", background: "#fee2e2", borderColor: "#fecaca" }}>{message}</div>
      )}

      <div className="cp-grid" style={{ marginBottom: 24 }}>
        {cards.map((c) => {
          const chip = CHIP[c.state];
          const live = c.state === "healthy" || c.state === "unreachable" || c.state === "unchecked";
          return (
            <div key={c.id ?? "local"} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#111827", overflowWrap: "anywhere" }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", overflowWrap: "anywhere" }}>{c.url ?? "This deployment"}</div>
                </div>
                <Pill label={chip.label} tone={chip.tone} />
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "12px 0", fontSize: 12, color: "#374151" }}>
                <span>{c.tenants ?? "-"} tenants</span>
                <span>{c.users ?? "-"} users</span>
                {c.region && <span>{c.region}</span>}
                {c.build && <span>build {c.build}</span>}
              </div>
              {c.problem && <div style={{ fontSize: 12, color: "#991b1b", marginBottom: 8 }}>{c.problem}</div>}
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>Checked {when(c.lastSeen)}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {c.id === null ? (
                  <Button variant="primary" style={TAP} href="/admin/tenants">Open admin</Button>
                ) : (
                  <>
                    <Button
                      variant="primary" style={TAP} loading={busy === `open:${c.id}`}
                      disabled={!signingConfigured || !live} onClick={() => openAdmin(c.id!)}
                    >
                      Open admin
                    </Button>
                    <Button style={TAP} loading={busy === `refresh:${c.id}`} disabled={!signingConfigured || !live} onClick={() => refresh(c.id!)}>
                      Refresh
                    </Button>
                    {c.state === "planned" && (
                      <Button variant="quiet" style={TAP} loading={busy === `status:${c.id}`} onClick={() => setStatus(c.id!, "active")}>Mark active</Button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={card}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "#111827" }}>
          All tenants <InfoTip label="All tenants">{INSTANCE_TIPS.tenants}</InfoTip>
        </h2>
        {tenants.length === 0 ? (
          <div style={{ padding: "24px 0", fontSize: 13, color: "#6b7280" }}>No tenants yet. Register an instance and refresh it to list its tenants here.</div>
        ) : (
          <table className="cp-table">
            <thead>
              <tr><th>Tenant</th><th>Instance</th><th>Plan</th><th>Users</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.key}>
                  <td>
                    <div style={{ fontWeight: 600, color: "#111827", overflowWrap: "anywhere" }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>/{t.slug}{t.isDemo ? " · demo" : ""}</div>
                  </td>
                  <td data-label="Instance">{t.instanceName}</td>
                  <td data-label="Plan">{t.plan}</td>
                  <td data-label="Users">{t.users}</td>
                  <td>
                    {t.instanceId === null ? (
                      <Button size="sm" style={TAP} href={`/admin/tenants/${t.tenantId}`}>Open admin</Button>
                    ) : (
                      <Button
                        size="sm" style={TAP} loading={busy === `open:${t.instanceId}`} disabled={!signingConfigured}
                        onClick={() => openAdmin(t.instanceId!, `/admin/tenants/${t.tenantId}`)}
                      >
                        Open admin
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tenants.length > ROWS_SHOWN && (
          <div style={{ paddingTop: 10 }}>
            <Button variant="quiet" style={TAP} onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${tenants.length}`}
            </Button>
          </div>
        )}
      </div>

      {panel && (
        <SidePanel
          title="Register instance"
          onClose={() => setPanel(false)}
          footer={
            <>
              <Button style={TAP} onClick={() => setPanel(false)}>Cancel</Button>
              <Button variant="primary" style={TAP} loading={busy === "register"} onClick={register} disabled={!draft.name || !draft.slug || draft.base_url.length < 9}>Register</Button>
            </>
          }
        >
          {formError && <div role="alert" style={{ color: "#991b1b", fontSize: 13 }}>{formError}</div>}
          <Field label="Name" htmlFor="cp-name" required><Input id="cp-name" value={draft.name} onChange={set("name")} /></Field>
          <Field label="Slug" htmlFor="cp-slug" required info={INSTANCE_TIPS.slug}>
            <Input id="cp-slug" value={draft.slug} onChange={set("slug")} autoCapitalize="none" autoCorrect="off" />
          </Field>
          <Field label="Base URL" htmlFor="cp-url" required info={INSTANCE_TIPS.baseUrl}>
            <Input id="cp-url" type="url" inputMode="url" value={draft.base_url} onChange={set("base_url")} autoCapitalize="none" />
          </Field>
          <Field label="Region" htmlFor="cp-region"><Input id="cp-region" value={draft.region} onChange={set("region")} /></Field>
          <Field label="DB host" htmlFor="cp-db" info={INSTANCE_TIPS.dbHost}><Input id="cp-db" value={draft.db_host} onChange={set("db_host")} /></Field>
          <Field label="Branch" htmlFor="cp-branch"><Input id="cp-branch" value={draft.branch} onChange={set("branch")} /></Field>
          <Field label="Status" htmlFor="cp-status" info={INSTANCE_TIPS.status}>
            <Select id="cp-status" value={draft.status} onChange={set("status")}>
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </Select>
          </Field>
        </SidePanel>
      )}
    </div>
  );
}
