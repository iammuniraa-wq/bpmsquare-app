"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import {
  createGroup, deleteGroup, listGroups, loadMembers, readCreatedId, readGroups, setMembers, updateGroup,
  type GroupSupplier, type SupplierGroup,
} from "./groupsApi";
import { GROUP_TIPS } from "./tips";

// Supplier groups: one place for them (bpmsquare 6c). A group is a client's approved suppliers; a tender deal or contract project of that client
// can ask only the group's members. One table, a row opens the side panel (a bottom sheet on a phone): name, the client, the members to tick.
// After every change the list is read again. The server decides again on every call (a client has one group; ids are checked for the tenant).

const PAGE = 10;
const MEMBER_PAGE = 12;
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "9px 12px", background: c.panel2, fontWeight: 600 };

export type AccountOption = { id: string; name: string };

export default function GroupsClient({ suppliers, accounts, canEdit, initialGroups, initialPanel }: {
  suppliers: GroupSupplier[];
  accounts: AccountOption[];
  canEdit: boolean;
  /** Let a server render (and its test) show the loaded view or a panel. The page never passes them. */
  initialGroups?: SupplierGroup[];
  initialPanel?: { id?: string; members?: string[] };
}) {
  const [groups, setGroups] = useState<SupplierGroup[] | null>(initialGroups ?? null);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [panel, setPanel] = useState<{ id?: string; members?: string[] } | null>(initialPanel ?? null);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    const r = await listGroups();
    if (r.ok) { setGroups(readGroups(r.json)); setLoadError(""); setPending(false); return; }
    if (r.status === 404 || r.status === 501 || r.status === 503) { setPending(true); setGroups((g) => g ?? []); return; }
    setLoadError(r.json.error ?? "Could not load the groups");
    setGroups((g) => g ?? []);
  }, []);
  useEffect(() => { if (!initialGroups) void reload(); }, [initialGroups, reload]);

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const clientOf = (g: SupplierGroup) => g.account_name ?? (g.account_id ? accountName.get(g.account_id) ?? "—" : "—");
  const countOf = (g: SupplierGroup) => (typeof g.member_count === "number" ? String(g.member_count) : "—");

  if (pending) {
    return <div role="alert" data-guide="supplier.groups.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Supplier groups need a database update. Ask your administrator to apply it.</div>;
  }

  const list = groups ?? [];
  const shown = showAll ? list : list.slice(0, PAGE);
  const open = panel?.id ? list.find((g) => g.id === panel.id) : undefined;
  const changed = (message?: string) => { setPanel(null); setNotice(message ?? ""); void reload(); };

  return (
    <div className="bpm-tap" data-guide="supplier.groups" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {loadError && <div role="alert" style={{ fontSize: 13, color: "var(--redink)" }}>{loadError}</div>}
      {notice && <div role="alert" data-guide="supplier.groups.notice" style={{ fontSize: 13, color: "var(--amberink)" }}>{notice}</div>}
      <Card
        title="Groups" info={GROUP_TIPS.groups} padding={0}
        action={canEdit ? <Button variant="primary" size="sm" data-guide="supplier.group.new" style={{ minHeight: 44 }} onClick={() => setPanel({})}>+ New group</Button> : undefined}
      >
        {groups === null ? (
          <div role="status" style={{ padding: 16, fontSize: 13, color: c.hint }}>Loading the groups…</div>
        ) : list.length === 0 ? (
          <EmptyState
            title="No groups yet"
            text={canEdit ? "Make one group per client, for example its approved vendors, and tick the suppliers on it." : undefined}
            action={canEdit ? <Button variant="primary" style={{ minHeight: 44 }} data-guide="supplier.group.empty_new" onClick={() => setPanel({})}>+ New group</Button> : undefined}
          />
        ) : (
          <>
            <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
              <table data-guide="supplier.groups.table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Group</th><th style={th}>Client</th><th style={{ ...th, textAlign: "right" }}>Members</th></tr></thead>
                <tbody>
                  {shown.map((g) => (
                    <tr key={g.id} data-guide="supplier.group.row" style={{ borderTop: `1px solid ${c.line}` }}>
                      <td style={{ padding: 0 }}>
                        <button type="button" data-guide="supplier.group.open" aria-label={`Open group ${g.name}`} onClick={() => setPanel({ id: g.id })}
                          style={{ all: "unset", boxSizing: "border-box", display: "block", width: "100%", minHeight: 52, padding: "8px 12px", cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{g.name}</button>
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: c.muted }}>{clientOf(g)}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{countOf(g)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bpm-rows-cards" style={{ gap: 10, padding: 12 }}>
              {shown.map((g) => (
                <button key={g.id} type="button" data-guide="supplier.group.card" aria-label={`Open group ${g.name}`} onClick={() => setPanel({ id: g.id })}
                  style={{ all: "unset", boxSizing: "border-box", display: "block", width: "100%", minHeight: 44, padding: 12, cursor: "pointer", border: `1px solid ${c.line}`, borderRadius: 12, background: "var(--card-bg)" }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{g.name}</span>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6, fontSize: 13, color: c.muted }}><span>{clientOf(g)}</span><span>{countOf(g)} members</span></span>
                </button>
              ))}
            </div>
          </>
        )}
        {list.length > PAGE && (
          <div style={{ padding: "8px 12px", borderTop: `1px solid ${c.line}` }}>
            <Button variant="quiet" size="sm" data-guide="supplier.groups.show_all" style={{ minHeight: 44 }} onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${list.length}`}</Button>
          </div>
        )}
      </Card>

      {panel && (
        <GroupPanel
          key={panel.id ?? "new"} group={open} suppliers={suppliers} accounts={accounts} usedAccounts={list.filter((g) => g.id !== panel.id && g.account_id).map((g) => g.account_id as string)}
          canEdit={canEdit} initialMembers={panel.members} onClose={() => setPanel(null)} onChanged={changed}
        />
      )}
    </div>
  );
}

function GroupPanel({ group, suppliers, accounts, usedAccounts, canEdit, initialMembers, onClose, onChanged }: {
  group?: SupplierGroup;
  suppliers: GroupSupplier[];
  accounts: AccountOption[];
  /** Clients that already have another group (a client has one). */
  usedAccounts: string[];
  canEdit: boolean;
  initialMembers?: string[];
  onClose: () => void;
  /** After a change (or a half change, with its sentence): the view closes the panel and reads the list again. */
  onChanged: (notice?: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [accountId, setAccountId] = useState(group?.account_id ?? "");
  const [chosen, setChosen] = useState<string[] | null>(initialMembers ?? (group ? null : []));
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!group || initialMembers) return;
    let live = true;
    void loadMembers(group.id).then((r) => {
      if (!live) return;
      const rows = Array.isArray(r.json) ? (r.json as { id: string }[]) : [];
      setChosen(r.ok ? rows.map((x) => x.id) : []);
      if (!r.ok) setError(r.json.error ?? "Could not load the members");
    });
    return () => { live = false; };
  }, [group, initialMembers]);

  const active = suppliers.filter((s) => s.status !== "inactive");
  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return t ? active.filter((s) => `${s.name} ${s.city ?? ""}`.toLowerCase().includes(t)) : active;
  }, [active, filter]);
  const visible = showAll || filter ? shown : shown.slice(0, MEMBER_PAGE);
  const ids = chosen ?? [];
  const toggle = (id: string) => setChosen((cs) => ((cs ?? []).includes(id) ? (cs ?? []).filter((x) => x !== id) : [...(cs ?? []), id]));
  const ready = canEdit && !busy && name.trim().length > 0 && chosen !== null;

  async function save() {
    setError(""); setBusy("save");
    try {
      const body = { name: name.trim(), account_id: accountId || null };
      let id = group?.id ?? null;
      if (group) {
        const r = await updateGroup(group.id, body);
        if (!r.ok) { setError(r.json.error ?? "Could not save the group"); return; }
      } else {
        const r = await createGroup(body);
        if (!r.ok) { setError(r.json.error ?? "Could not create the group"); return; }
        id = readCreatedId(r.json);
      }
      if (id) {
        const m = await setMembers(id, ids);
        if (!m.ok) { onChanged(`The group was saved, but its members were not: ${m.json.error ?? "try again"}.`); return; }
      }
      onChanged();
    } finally { setBusy(""); }
  }

  async function remove() {
    if (!group) return;
    setError(""); setBusy("delete");
    try {
      const r = await deleteGroup(group.id);
      if (!r.ok) { setError(r.json.error ?? "Could not delete the group"); return; }
      onChanged();
    } finally { setBusy(""); }
  }

  const footer = canEdit ? (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%", alignItems: "center" }}>
      {group && !confirmDelete && <Button variant="quiet" disabled={!!busy} style={{ minHeight: 44, marginRight: "auto" }} data-guide="supplier.group.delete" onClick={() => setConfirmDelete(true)}>Delete</Button>}
      {group && confirmDelete && (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", marginRight: "auto", flexWrap: "wrap" }} data-guide="supplier.group.delete_confirm">
          <span style={{ fontSize: 13, color: c.ink }}>Delete this group?</span>
          <Button variant="danger" size="sm" loading={busy === "delete"} disabled={!!busy} style={{ minHeight: 44 }} data-guide="supplier.group.delete_yes" onClick={() => void remove()}>Delete group</Button>
          <Button variant="secondary" size="sm" disabled={!!busy} style={{ minHeight: 44 }} onClick={() => setConfirmDelete(false)}>Keep</Button>
        </span>
      )}
      <Button variant="primary" loading={busy === "save"} disabled={!ready} style={{ minHeight: 44 }} data-guide="supplier.group.save" onClick={() => void save()}>Save</Button>
    </div>
  ) : undefined;

  return (
    <SidePanel title={group ? group.name : "New group"} subtitle={ids.length > 0 ? `${ids.length} member${ids.length === 1 ? "" : "s"}` : undefined} label={group ? `Group ${group.name}` : "New group"} onClose={onClose} footer={footer}>
      <div className="bpm-tap" data-guide="supplier.group.panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <Field label="Name" required guide="supplier.group.field.name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Aramco approved vendors" disabled={!canEdit} autoFocus={canEdit} /></Field>
        <Field label="Client" info={GROUP_TIPS.client} guide="supplier.group.field.client">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!canEdit}>
            <option value="">— No client —</option>
            {accounts.map((a) => <option key={a.id} value={a.id} disabled={usedAccounts.includes(a.id)}>{a.name}{usedAccounts.includes(a.id) ? " (has a group)" : ""}</option>)}
          </Select>
        </Field>

        <div data-guide="supplier.group.members">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <span className="bpm-label-row"><span className="bpm-t-label">Members</span><InfoTip label="Members">{GROUP_TIPS.members}</InfoTip></span>
            {canEdit && shown.length > 0 && (
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="supplier.group.members_all" onClick={() => setChosen(Array.from(new Set([...ids, ...shown.map((s) => s.id)])))}>All</Button>
                <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="supplier.group.members_none" onClick={() => setChosen([])}>None</Button>
              </span>
            )}
          </div>
          {chosen === null ? (
            <div role="status" style={{ fontSize: 13, color: c.hint }}>Loading the members…</div>
          ) : active.length === 0 ? (
            <div role="status" style={{ fontSize: 13, color: c.muted }}>No suppliers yet. Add them under Suppliers first.</div>
          ) : (
            <>
              {active.length > MEMBER_PAGE && <Input aria-label="Search suppliers" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search suppliers…" style={{ marginBottom: 6 }} />}
              <div style={{ border: `1px solid ${c.line}`, borderRadius: 8 }}>
                {visible.map((s) => (
                  <label key={s.id} data-guide="supplier.group.member" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", minHeight: 44, borderBottom: `1px solid ${c.line}`, cursor: canEdit ? "pointer" : "default", fontSize: 13, color: c.ink }}>
                    <input type="checkbox" checked={ids.includes(s.id)} disabled={!canEdit} onChange={() => toggle(s.id)} style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{s.name}</span>
                      <span style={{ display: "block", fontSize: 12, color: c.hint }}>{[s.type, s.city].filter(Boolean).join(" · ")}</span>
                    </span>
                  </label>
                ))}
                {visible.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: c.hint }}>No suppliers match.</div>}
              </div>
              {!filter && shown.length > MEMBER_PAGE && (
                <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="supplier.group.show_all_members" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${shown.length}`}</Button>
              )}
            </>
          )}
        </div>
      </div>
    </SidePanel>
  );
}
