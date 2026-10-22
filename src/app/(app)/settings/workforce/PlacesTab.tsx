"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { CheckOpt } from "@/components/ui/Opt";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import SettingsList from "@/components/settings/SettingsList";
import type { WfmConfig } from "@/lib/constants";
import type { WfmSite } from "@/lib/wfm/types";
import { Notice } from "../middleware/ui";
import { call, messageOf } from "./api";
import { blankSite, sitePayload, siteProblem, type SiteDraft } from "./logic";
import { SwitchRow } from "./parts";
import { WORKFORCE_TIPS as T } from "./tips";
import s from "./workforce.module.css";

const SiteMapPicker = dynamic(() => import("@/components/wfm/SiteMapPicker"), { ssr: false });

type Person = { id: string; first_name: string; last_name: string; employee_code: string | null; wfm_role: string; status: string };
type Device = { id: string; name: string; site_id: string; active: boolean; last_seen_at: string | null };

const personName = (p: { first_name: string; last_name: string }) => [p.first_name, p.last_name].filter(Boolean).join(" ");
const seen = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

/**
 * Where people punch: one row per site, the name opens the panel (location, radius, who approves, and the site's door
 * tablets). The geofence rule sits above the list because it applies to every site. Replaces the Sites and Kiosks pages.
 */
export default function PlacesTab({ cfg, onChange }: { cfg: WfmConfig; onChange: (patch: Partial<WfmConfig>) => void }) {
  const [sites, setSites] = useState<WfmSite[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | "new" | null>(null);

  const load = useCallback(async () => {
    const [sitesRes, empRes, devRes] = await Promise.all([fetch("/api/wfm/sites"), fetch("/api/wfm/employees"), fetch("/api/wfm/kiosk/devices")]);
    if (sitesRes.ok) setSites(await sitesRes.json());
    else setError((await sitesRes.json().catch(() => ({}))).error ?? "Could not load the sites.");
    // A silent failure here is what makes the supervisor list look empty when the employee list never loaded.
    if (empRes.ok) {
      const rows = await empRes.json();
      setPeople(Array.isArray(rows) ? rows : (rows.employees ?? []));
    } else {
      setError((await empRes.json().catch(() => ({}))).error ?? "Could not load the employees, so the supervisor list will be empty.");
    }
    if (devRes.ok) setDevices(await devRes.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  const active = useMemo(() => people.filter((p) => p.status === "active"), [people]);
  // A site nobody approves for sends its overtime, leave and corrections nowhere, and nothing escalates to an admin
  // behind the scenes. Extra approvers count: a site run by named approvers alone is covered.
  const unsupervised = sites.filter((x) => x.active && !x.supervisor_id && (x.approver_ids ?? []).length === 0);
  const open = openId && openId !== "new" ? sites.find((x) => x.id === openId) ?? null : null;
  const geofence = cfg.geofence_mode;

  return (
    <div className={s.shell}>
      {error && <Notice tone="err">{error}</Notice>}
      {unsupervised.length > 0 && (
        <Notice tone="warn">
          {unsupervised.length === 1 ? "1 site has" : `${unsupervised.length} sites have`} no supervisor, so overtime, leave and corrections from {unsupervised.map((x) => x.name).join(", ")} have nobody to approve them.
        </Notice>
      )}

      <div className={s.bar}>
        <div className={s.barStart}>
          <Field label="Outside every site" info={T.geofence} style={{ marginBottom: 0, minWidth: 190 }}>
            <Select value={geofence} onChange={(e) => onChange({ geofence_mode: e.target.value as WfmConfig["geofence_mode"] })}>
              <option value="flag">Keep the punch, mark it</option>
              <option value="block">Reject the punch</option>
              <option value="off">No location check</option>
            </Select>
          </Field>
          {geofence !== "block" && (
            <CheckOpt label="Require location to check in and out" info={T.requireLocation} checked={cfg.require_location} onChange={(require_location) => onChange({ require_location })} />
          )}
        </div>
        <Button variant="primary" onClick={() => setOpenId("new")}>+ New site</Button>
      </div>

      <SettingsList
        label="Sites"
        headers={["Supervisor", "Radius", "Tablets"]}
        rows={sites.map((x) => ({
          key: x.id,
          title: x.name,
          dim: !x.active,
          cells: [
            x.supervisor ? personName(x.supervisor) : (x.approver_ids ?? []).length > 0 ? "Named approvers" : <span className={s.warn}>None</span>,
            `${x.radius_m} m`,
            String(devices.filter((d) => d.site_id === x.id && d.active).length),
          ],
        }))}
        onOpen={setOpenId}
        empty="No sites yet. Until one exists, punches are recorded without a location check."
      />

      {(openId === "new" || open) && (
        <SitePanel
          key={openId}
          site={open}
          people={active}
          devices={open ? devices.filter((d) => d.site_id === open.id) : []}
          tabletsOn={cfg.face_punch === "kiosk"}
          onClose={() => setOpenId(null)}
          onSaved={async () => { setOpenId(null); await load(); }}
          onTablets={load}
        />
      )}
    </div>
  );
}

function SitePanel({ site, people, devices, tabletsOn, onClose, onSaved, onTablets }: {
  site: WfmSite | null;
  people: Person[];
  devices: Device[];
  tabletsOn: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onTablets: () => Promise<void>;
}) {
  const [d, setD] = useState<SiteDraft>(() => (site ? {
    name: site.name, lat: String(site.lat), lng: String(site.lng), radius: String(site.radius_m),
    supervisorId: site.supervisor_id ?? "", approverIds: site.approver_ids ?? [], active: site.active,
  } : blankSite()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<SiteDraft>) => setD((x) => ({ ...x, ...p }));

  async function save() {
    const problem = siteProblem(d);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    try {
      await (site ? call(`/api/wfm/sites/${site.id}`, "PATCH", sitePayload(d, false)) : call("/api/wfm/sites", "POST", sitePayload(d, true)));
      await onSaved();
    } catch (e) {
      setError(messageOf(e)); setSaving(false);
    }
  }

  const lat = d.lat ? parseFloat(d.lat) : null;
  const lng = d.lng ? parseFloat(d.lng) : null;

  return (
    <SidePanel
      title={site ? site.name : "New site"}
      onClose={onClose}
      footer={
        <>
          {error && <span role="alert" className={`${s.issue} ${s.footIssue}`}>{error}</span>}
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <div className={s.stack}>
        <Field label="Name"><Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Workshop, Hosapete" autoFocus /></Field>
        <Field label="Location" htmlFor="site-map">
          <div id="site-map">
            <SiteMapPicker lat={Number.isFinite(lat) ? lat : null} lng={Number.isFinite(lng) ? lng : null} onChange={(la, lo) => set({ lat: la.toFixed(6), lng: lo.toFixed(6) })} />
          </div>
        </Field>
        <div className={s.fields}>
          <Field label="Supervisor" info={T.siteSupervisor}>
            <Select value={d.supervisorId} onChange={(e) => set({ supervisorId: e.target.value })} disabled={people.length === 0}>
              <option value="">{people.length === 0 ? "No employees yet" : "No supervisor"}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{personName(p)}{p.employee_code ? ` (${p.employee_code})` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Radius (m)"><Input type="number" min={1} value={d.radius} onChange={(e) => set({ radius: e.target.value })} /></Field>
        </div>
        {site && <SwitchRow label="Active" checked={d.active} onChange={(active) => set({ active })} />}

        <details className={s.panelMore}>
          <summary>More</summary>
          <div className={s.panelMoreBody}>
            <div className={s.fields}>
              <Field label="Latitude"><Input value={d.lat} onChange={(e) => set({ lat: e.target.value })} placeholder="15.2695" /></Field>
              <Field label="Longitude"><Input value={d.lng} onChange={(e) => set({ lng: e.target.value })} placeholder="76.3871" /></Field>
            </div>
            <Field label="Also approve here" info={T.siteApprovers}>
              {people.length === 0 ? <span className={`${s.small} ${s.muted}`}>No active employees yet.</span> : (
                <div className={s.approvers} role="group" aria-label="Also approve here">
                  {people.filter((p) => p.id !== d.supervisorId).map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox" checked={d.approverIds.includes(p.id)}
                        onChange={(e) => set({ approverIds: e.target.checked ? [...d.approverIds, p.id] : d.approverIds.filter((x) => x !== p.id) })}
                      />
                      <span>{personName(p)}{p.employee_code ? ` (${p.employee_code})` : ""}</span>
                    </label>
                  ))}
                </div>
              )}
            </Field>
          </div>
        </details>

        {site && (tabletsOn || devices.length > 0) && <Tablets siteId={site.id} devices={devices} onChanged={onTablets} />}
      </div>
    </SidePanel>
  );
}

/** A site's door tablets. The code is stored hashed, so it is shown once, here, and can only be replaced. */
function Tablets({ siteId, devices, onChanged }: { siteId: string; devices: Device[]; onChanged: () => Promise<void> }) {
  const { confirm } = useFeel();
  const [name, setName] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true); setError(null); setCode(null);
    try {
      setCode(await fn());
      await onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const add = () => {
    if (!name.trim()) { setError("Give the tablet a name."); return; }
    void run(async () => {
      const r = await call<{ token: string }>("/api/wfm/kiosk/devices", "POST", { name: name.trim(), site_id: siteId });
      setName("");
      return r.token;
    });
  };
  const reissue = async (dv: Device) => {
    const ok = await confirm({
      title: `Issue a new code for "${dv.name}"?`,
      body: "The current code stops working immediately, so the tablet will ask to be registered again. Recorded punches are not affected.",
      confirmLabel: "Issue new code",
      tone: "danger",
    });
    if (ok) void run(async () => (await call<{ token: string }>("/api/wfm/kiosk/devices", "PATCH", { id: dv.id })).token);
  };
  const deactivate = async (dv: Device) => {
    if (!(await confirm({ title: `Deactivate "${dv.name}"?`, body: "The tablet stops working immediately.", confirmLabel: "Deactivate", tone: "danger" }))) return;
    void run(async () => { await call(`/api/wfm/kiosk/devices?id=${dv.id}`, "DELETE"); return null; });
  };

  return (
    <details className={s.panelMore} open={devices.length > 0 || code !== null}>
      <summary>Door tablets{devices.length ? ` (${devices.filter((x) => x.active).length})` : ""}</summary>
      <div className={s.panelMoreBody}>
        <span className="bpm-label-row"><span className="bpm-t-label">Register a tablet</span><InfoTip label="Door tablets">{T.tablets}</InfoTip></span>
        {devices.map((dv) => (
          <div key={dv.id} className={s.tablet} style={dv.active ? undefined : { opacity: 0.55 }}>
            <span>{dv.name}<span className={`${s.small} ${s.muted}`}> · {dv.active ? `seen ${seen(dv.last_seen_at)}` : "deactivated"}</span></span>
            {dv.active && (
              <span className={s.tabletActs}>
                <Button size="sm" disabled={busy} onClick={() => void reissue(dv)}>New code</Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void deactivate(dv)}>Deactivate</Button>
              </span>
            )}
          </div>
        ))}
        <div className={s.typeRow}>
          <Input aria-label="Tablet name" placeholder="Main door" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" loading={busy} onClick={add}>Get code</Button>
        </div>
        {error && <span role="alert" className={s.issue}>{error}</span>}
        {code && (
          <Notice tone="ok">
            Code, shown once. Paste it on the tablet now.
            <code className={s.code}>{code}</code>
            <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(code); }}>Copy</Button>
          </Notice>
        )}
      </div>
    </details>
  );
}
