"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import { CheckOpt } from "@/components/ui/Opt";
import SidePanel from "@/components/ui/SidePanel";
import RowTable from "@/components/settings/RowTable";
import EmptyState from "@/components/ui/EmptyState";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES } from "@/lib/constants";
import { CREATE_LABEL, DEFAULT_ACTIONS, type DefaultAction, type MailboxConnector } from "@/lib/inbox/types";
import { INBOX_TIPS } from "@/lib/inbox/tips";
import { whenWord } from "@/components/inbox/bits";

type Channel = {
  id: string; name: string; address_alias: string; address: string | null; connector_id: MailboxConnector | null;
  role_ids: string[]; default_action: DefaultAction; default_template_id: string | null; reply_from: string | null; reply_name: string | null;
  active: boolean; filter_senders?: string[]; filter_subjects?: string[]; last_received_at: string | null; mailbox_connected: boolean | null; last_polled_at: string | null; last_error: string | null;
};
type Data = {
  channels: Channel[]; roles: { id: string; name: string }[]; connectors: { gmail: boolean; mail_server: boolean };
  templates: { id: string; name: string }[]; estimator: boolean; tender?: boolean; inbound_domain: string | null; sending_configured: boolean;
  pending_migration?: boolean; message?: string;
};
type Draft = {
  name: string; role_ids: string[]; default_action: DefaultAction; default_template_id: string; connector_id: "" | MailboxConnector;
  reply_from: string; reply_name: string; active: boolean; filter_senders: string; filter_subjects: string;
};

const ACTION_WORD: Record<DefaultAction, string> = { ...CREATE_LABEL, none: "Nothing in particular" };
const emptyDraft: Draft = { name: "", role_ids: [], default_action: "none", default_template_id: "", connector_id: "", reply_from: "", reply_name: "", active: true, filter_senders: "", filter_subjects: "" };
const draftOf = (c: Channel): Draft => ({
  name: c.name, role_ids: c.role_ids, default_action: c.default_action, default_template_id: c.default_template_id ?? "",
  connector_id: c.connector_id ?? "", reply_from: c.reply_from ?? "", reply_name: c.reply_name ?? "", active: c.active,
  filter_senders: (c.filter_senders ?? []).join(", "), filter_subjects: (c.filter_subjects ?? []).join(", "),
});

const MORE = 6;

/**
 * Settings, Inbox channels: one table, a row opens its panel (a bottom sheet on a phone). Labels, values and actions
 * only; every explanation sits behind the "i" (bpmsquarecore 6b, 6c).
 */
export default function ChannelsClient() {
  const { toast, confirm } = useFeel();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<{ id: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/channels");
      const json = (await res.json()) as Data & { error?: string };
      if (!res.ok) { setError(json.error ?? "Could not load the channels."); return; }
      setData(json);
      setError("");
    } catch { setError("Could not reach the server. Try again."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error && !data) return <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>;
  if (!data) return <div className="bpm-t-help" role="status">Loading…</div>;

  const open = sel?.id ? data.channels.find((c) => c.id === sel.id) ?? null : null;
  const roleNames = new Map(data.roles.map((r) => [r.id, r.name]));
  const team = (c: Channel) => (c.role_ids.length === 0 ? "Everyone" : c.role_ids.map((r) => roleNames.get(r) ?? "Role").join(", "));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data.pending_migration && <div className="bpm-t-help" role="status" style={{ color: "var(--err-ink)" }}>{data.message}</div>}
      {!data.inbound_domain && !data.pending_migration && (
        <div className="bpm-t-help" role="status">Receiving by address is not switched on for this platform yet (INBOUND_EMAIL_DOMAIN). A connected mailbox still works.</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span className="bpm-t-help" aria-live="polite">{data.channels.length === 0 ? "" : `${data.channels.length} channel${data.channels.length === 1 ? "" : "s"}`}</span>
        {!data.pending_migration && <Button variant="primary" data-guide="inbox.channels.new" onClick={() => setSel({ id: null })}>+ New channel</Button>}
      </div>

      <RowTable
        label="Inbox channels"
        columns={["Channel", "Address", "Team", "Create offers", "Last mail"]}
        empty={<EmptyState title="No channels yet" text="A channel is an address customers write to. Add one, then forward your company mail to it." action={!data.pending_migration ? <Button variant="primary" onClick={() => setSel({ id: null })}>+ New channel</Button> : undefined} />}
        rows={data.channels.map((c) => ({
          id: c.id, openLabel: `${c.name}: edit`, onOpen: () => setSel({ id: c.id }), dim: !c.active,
          cells: [
            <span key="n" data-guide="inbox.channels.row">{c.name}{c.active ? "" : " (paused)"}</span>,
            c.address ?? (c.connector_id ? (c.connector_id === "gmail" ? "Gmail" : "Mail server") : "–"),
            team(c),
            ACTION_WORD[c.default_action],
            c.last_received_at ? whenWord(c.last_received_at) : "–",
          ],
        }))}
      />

      {sel && (sel.id === null || open) && (
        <ChannelPanel
          key={sel.id ?? "new"} data={data} channel={open}
          onClose={() => setSel(null)}
          onSaved={async (verb) => { toast({ text: verb, tone: "success" }); await load(); setSel(null); }}
          onRead={load}
          onRotated={async () => { toast({ text: "New address made. Update anything that forwards to the old one.", tone: "success" }); await load(); }}
          confirm={confirm}
        />
      )}
    </div>
  );
}

function ChannelPanel({ data, channel, onClose, onSaved, onRotated, onRead, confirm }: {
  data: Data; channel: Channel | null; onClose: () => void; onSaved: (verb: string) => Promise<void>; onRotated: () => Promise<void>; onRead: () => Promise<void>;
  confirm: ReturnType<typeof useFeel>["confirm"];
}) {
  const { toast } = useFeel();
  const [d, setD] = useState<Draft>(channel ? draftOf(channel) : emptyDraft);
  const [busy, setBusy] = useState<"" | "save" | "delete" | "rotate" | "read">("");
  const [error, setError] = useState("");
  const [allRoles, setAllRoles] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const roles = allRoles ? data.roles : data.roles.slice(0, MORE);
  const mailboxOk = d.connector_id === "" ? null : d.connector_id === "gmail" ? data.connectors.gmail : data.connectors.mail_server;

  async function readNow() {
    if (!channel) return;
    setBusy("read");
    setError("");
    try {
      const res = await fetch(`/api/inbox/channels/${channel.id}/poll`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not read the mailbox."); return; }
      if (j.error) toast({ text: `The mailbox answered with an error: ${j.error}`, tone: "error" });
      else toast({ text: j.stored ? `${j.stored} new ${j.stored === 1 ? "email" : "emails"} taken in.` : "No new mail.", tone: "success" });
      await onRead();
    } finally {
      setBusy("");
    }
  }

  async function save() {
    setError("");
    if (!d.name.trim()) { setError("Give the channel a name."); return; }
    setBusy("save");
    try {
      const body = {
        name: d.name.trim(), role_ids: d.role_ids, default_action: d.default_action,
        default_template_id: d.default_action === "estimate" && d.default_template_id ? d.default_template_id : null,
        connector_id: d.connector_id || null, reply_from: d.reply_from.trim() || null, reply_name: d.reply_name.trim() || null, active: d.active,
        // Sent only when set or changed, so a workspace that has not run the filter migration (0236) can still save a channel.
        ...(d.filter_senders.trim() || d.filter_senders.trim() !== (channel ? draftOf(channel).filter_senders : "") ? { filter_senders: d.filter_senders } : {}),
        ...(d.filter_subjects.trim() || d.filter_subjects.trim() !== (channel ? draftOf(channel).filter_subjects : "") ? { filter_subjects: d.filter_subjects } : {}),
      };
      const res = await fetch(channel ? `/api/inbox/channels/${channel.id}` : "/api/inbox/channels", {
        method: channel ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(json.error ?? "Could not save."); return; }
      await onSaved(channel ? "Channel saved." : "Channel added.");
    } catch { setError("Could not reach the server. Try again."); } finally { setBusy(""); }
  }

  async function remove() {
    if (!channel) return;
    if (!(await confirm({ title: `Delete ${channel.name}?`, body: "Only a channel with no mail can be deleted. Pause it instead to keep its mail.", tone: "danger" }))) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/inbox/channels/${channel.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(json.error ?? "Could not delete."); return; }
      await onSaved("Channel deleted.");
    } catch { setError("Could not reach the server. Try again."); } finally { setBusy(""); }
  }

  async function rotate() {
    if (!channel) return;
    if (!(await confirm({ title: "Make a new address?", body: "The old address stops working at once. Anything still forwarding to it will be lost until you update it.", tone: "danger" }))) return;
    setBusy("rotate");
    try {
      const res = await fetch(`/api/inbox/channels/${channel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rotate_alias: true }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(json.error ?? "Could not make a new address."); return; }
      await onRotated();
      onClose();
    } catch { setError("Could not reach the server. Try again."); } finally { setBusy(""); }
  }

  async function copy() {
    if (!channel?.address) return;
    try { await navigator.clipboard.writeText(channel.address); toast({ text: "Address copied.", tone: "success" }); }
    catch { toast({ text: "Could not copy. Select the address and copy it.", tone: "error" }); }
  }

  return (
    <SidePanel
      title={channel ? channel.name : "New channel"}
      subtitle={channel ? undefined : "Customers write to its address"}
      onClose={onClose}
      footer={
        <>
          {channel && <Button variant="danger" disabled={!!busy} loading={busy === "delete"} onClick={remove}>Delete</Button>}
          <Button variant="primary" loading={busy === "save"} disabled={!!busy} data-guide="inbox.channels.save" onClick={save}>{channel ? "Save" : "Create"}</Button>
        </>
      }
    >
      {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}

      <Field label="Name"><Input value={d.name} maxLength={80} placeholder="Fence enquiries" onChange={(e) => set("name", e.target.value)} /></Field>

      {channel && (
        <Field label="Address" info={INBOX_TIPS.address}>
          {channel.address ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ overflowWrap: "anywhere", fontSize: 12.5 }}>{channel.address}</code>
              <Button size="sm" data-guide="inbox.channels.copy" onClick={copy}>Copy</Button>
              <Button size="sm" variant="quiet" loading={busy === "rotate"} disabled={!!busy} onClick={rotate}>New address</Button>
              <InfoTip label="New address">{INBOX_TIPS.rotate}</InfoTip>
            </div>
          ) : (
            <span className="bpm-t-help">Not available until the platform has an inbound domain.</span>
          )}
        </Field>
      )}

      <div data-guide="inbox.channels.team">
        <Field label="Team" info={INBOX_TIPS.team} style={{ marginBottom: 0 }}>
          <div role="group" aria-label="Team" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {data.roles.length === 0 && <span className="bpm-t-help">No Business Roles yet, so everyone with the Inbox sees it.</span>}
            {roles.map((r) => (
              <CheckOpt key={r.id} label={r.name} checked={d.role_ids.includes(r.id)} onChange={(v) => set("role_ids", v ? [...d.role_ids, r.id] : d.role_ids.filter((x) => x !== r.id))} />
            ))}
            {data.roles.length > MORE && <Button size="sm" variant="quiet" onClick={() => setAllRoles((v) => !v)}>{allRoles ? "Show fewer" : `Show all ${data.roles.length}`}</Button>}
            {d.role_ids.length === 0 && data.roles.length > 0 && <span className="bpm-t-help">Nobody picked: everyone with the Inbox.</span>}
          </div>
        </Field>
      </div>

      <Field label="Create offers first" info={INBOX_TIPS.defaultAction}>
        <Select value={d.default_action} onChange={(e) => set("default_action", e.target.value as DefaultAction)}>
          {DEFAULT_ACTIONS.filter((a) => a !== "deal" || data.tender).map((a) => <option key={a} value={a}>{ACTION_WORD[a]}</option>)}
        </Select>
      </Field>
      {d.default_action === "estimate" && data.estimator && data.templates.length > 0 && (
        <Field label="Template" info={INBOX_TIPS.defaultTemplate}>
          <Select value={d.default_template_id} onChange={(e) => set("default_template_id", e.target.value)}>
            <option value="">Let the system suggest one</option>
            {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      )}

      <div data-guide="inbox.channels.mailbox">
        <Field label="Mailbox" info={INBOX_TIPS.mailbox} style={{ marginBottom: 0 }}>
          <Select value={d.connector_id} onChange={(e) => set("connector_id", e.target.value as Draft["connector_id"])}>
            <option value="">None: forwarding address only</option>
            <option value="gmail">Gmail</option>
            <option value="mail_server">Mail server (IMAP)</option>
          </Select>
          {d.connector_id && mailboxOk === false && (
            <div className="bpm-t-help" style={{ marginTop: 6 }}>Not connected yet. Connect it under <Link href={ROUTES.settingsConnectors}>Settings → Connectors</Link>, then save here.</div>
          )}
          {d.connector_id && mailboxOk && channel?.last_polled_at && (
            <div className="bpm-t-help" style={{ marginTop: 6 }}>Last read {whenWord(channel.last_polled_at)}{channel.last_error ? `, with an error: ${channel.last_error}` : ""}.</div>
          )}
          {channel && d.connector_id && mailboxOk && channel.active && (
            <div style={{ marginTop: 8 }}>
              <Button variant="secondary" size="sm" disabled={!!busy} loading={busy === "read"} onClick={readNow} data-guide="inbox.channels.read_now">Read mail now</Button>
            </div>
          )}
        </Field>
      </div>

      {d.connector_id && (
        <>
          <Field label="Only from these senders" info={INBOX_TIPS.filterSenders}>
            <Input value={d.filter_senders} maxLength={600} placeholder="@ministry.gov.sa, buyer@client.com" data-guide="inbox.channels.filter_senders" onChange={(e) => set("filter_senders", e.target.value)} />
          </Field>
          <Field label="Subject contains" info={INBOX_TIPS.filterSubjects}>
            <Input value={d.filter_subjects} maxLength={600} placeholder="tender, RFQ, BOQ" data-guide="inbox.channels.filter_subjects" onChange={(e) => set("filter_subjects", e.target.value)} />
          </Field>
        </>
      )}

      <Field label="Reply name" info={INBOX_TIPS.replyFrom}>
        <Input value={d.reply_name} maxLength={120} placeholder="Gulf Fence Sales" onChange={(e) => set("reply_name", e.target.value)} />
      </Field>
      {!d.connector_id && (
        <Field label="Reply from">
          <Input type="email" value={d.reply_from} placeholder="enquiries@yourcompany.com" onChange={(e) => set("reply_from", e.target.value)} />
        </Field>
      )}

      {channel && <CheckOpt label="Take in new mail" info={INBOX_TIPS.paused} checked={d.active} onChange={(v) => set("active", v)} />}
    </SidePanel>
  );
}
