"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import SidePanel from "@/components/ui/SidePanel";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import EmptyState from "@/components/ui/EmptyState";
import { Input, Select } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { call } from "@/components/drawings/api";
import { DRAWING_TIPS } from "@/lib/drawings/tips";
import { FEEDS, FEED_LABEL, REQUIRED_FIELD_KEYS, REQUIRED_FIELD_LABEL, type DrawingTypeRow } from "@/lib/drawings/types";
import s from "@/components/drawings/Drawings.module.css";

// Settings > Drawing types: one table, a row opens a side panel (a bottom sheet on a phone), Save in the one standard place.
// A type is data this workspace edits (numbering, revision labels, who releases, what it feeds), never a code branch.

type Member = { user_id: string; name: string };
type Draft = { id: string | null; name: string; numbering_pattern: string; rev_scheme: "letters" | "numbers"; approver_ids: string[]; second_person: boolean; required_fields: string[]; feeds: string[]; active: boolean };
const blank = (): Draft => ({ id: null, name: "", numbering_pattern: "", rev_scheme: "letters", approver_ids: [], second_person: true, required_fields: [], feeds: ["estimate", "boq", "handover"], active: true });
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function DrawingTypesClient() {
  const feel = useFeel();
  const [types, setTypes] = useState<DrawingTypeRow[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await call<{ types: DrawingTypeRow[]; members: Member[] }>("/api/settings/drawing-types", "GET");
    if (!r.ok) { setPending(!!r.extra?.needsDatabaseUpdate); setError(r.error); setTypes([]); return; }
    setTypes(r.data.types); setMembers(r.data.members);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!draft) return;
    setSaving(true); setError("");
    const body = { name: draft.name, numbering_pattern: draft.numbering_pattern, rev_scheme: draft.rev_scheme, approver_ids: draft.approver_ids, second_person: draft.second_person, required_fields: draft.required_fields, feeds: draft.feeds, active: draft.active };
    const r = draft.id ? await call(`/api/settings/drawing-types/${draft.id}`, "PATCH", body) : await call("/api/settings/drawing-types", "POST", body);
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    setDraft(null);
    feel.toast({ text: "Saved", tone: "success" });
    await load();
  }

  async function remove(t: DrawingTypeRow) {
    const ok = await feel.confirm({ title: `Delete the type ${t.name}?`, body: "A type that drawings use cannot be deleted; switch it off instead.", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    const r = await call(`/api/settings/drawing-types/${t.id}`, "DELETE");
    if (!r.ok) { feel.toast({ text: r.error, tone: "error" }); return; }
    setDraft(null);
    await load();
  }

  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name ?? "Member";

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {pending && <div role="alert" className={s.alert}>The drawing register needs a database update (migrations 0255 and 0256). Ask your administrator to apply it.</div>}
      {error && !pending && !draft && <div role="alert" className={s.alert}>{error}</div>}
      <div className={s.toolbar}>
        <Button variant="primary" size="sm" onClick={() => { setError(""); setDraft(blank()); }} data-guide="drawing_types.add">Add a type</Button>
        <InfoTip label="Drawing types">{DRAWING_TIPS.types}</InfoTip>
      </div>
      {types === null ? <p className={s.quiet}>Loading</p> : types.length === 0 ? (
        <EmptyState title="No drawing types yet" text="The register creates a default type called Drawing the first time it is used. Add your own here." />
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Name</th><th>Numbering</th><th>Revisions</th><th>Who releases</th><th>Feeds</th><th /></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong> {!t.active && <StatusPill label="Off" tone="red" />}</td>
                  <td className={s.mono}>{t.numbering_pattern ?? "any"}</td>
                  <td>{t.rev_scheme === "letters" ? "A, B, C" : "0, 1, 2"}</td>
                  <td>{t.approver_ids.length ? t.approver_ids.map(nameOf).join(", ") : "Workspace admins"}{t.second_person ? "" : " (may release own)"}</td>
                  <td>{t.feeds.length ? t.feeds.map((f) => FEED_LABEL[f as keyof typeof FEED_LABEL] ?? f).join(", ") : "Record only"}</td>
                  <td><Button size="sm" onClick={() => { setError(""); setDraft({ id: t.id, name: t.name, numbering_pattern: t.numbering_pattern ?? "", rev_scheme: t.rev_scheme, approver_ids: t.approver_ids, second_person: t.second_person, required_fields: t.required_fields, feeds: t.feeds, active: t.active }); }}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <SidePanel title={draft.id ? "Edit drawing type" : "New drawing type"} onClose={() => setDraft(null)}
          footer={(
            <div className={s.actions}>
              <Button variant="primary" loading={saving} disabled={!draft.name.trim()} onClick={save}>Save</Button>
              {draft.id && <Button variant="danger" onClick={() => remove(types!.find((t) => t.id === draft.id)!)}>Delete</Button>}
            </div>
          )}>
          <div style={{ display: "grid", gap: 12 }}>
            {error && <div role="alert" className={s.alert}>{error}</div>}
            <Field label="Name" required><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Shop drawing" /></Field>
            <Field label="Numbering pattern" info={DRAWING_TIPS.numbering}><Input value={draft.numbering_pattern} onChange={(e) => setDraft({ ...draft, numbering_pattern: e.target.value })} placeholder="{project}-{discipline}-{seq3}" /></Field>
            <Field label="Revision labels">
              <Select value={draft.rev_scheme} onChange={(e) => setDraft({ ...draft, rev_scheme: e.target.value === "numbers" ? "numbers" : "letters" })}>
                <option value="letters">Letters: A, B, C</option><option value="numbers">Numbers: 0, 1, 2</option>
              </Select>
            </Field>
            <Field label="Who may release" info={DRAWING_TIPS.approvers}>
              <div style={{ display: "grid", gap: 2 }}>
                {members.map((m) => (
                  <label key={m.user_id} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                    <input type="checkbox" checked={draft.approver_ids.includes(m.user_id)} onChange={() => setDraft({ ...draft, approver_ids: toggle(draft.approver_ids, m.user_id) })} />{m.name}
                  </label>
                ))}
                {members.length === 0 && <span className={s.quiet}>Workspace admins</span>}
              </div>
            </Field>
            <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
              <input type="checkbox" checked={draft.second_person} onChange={(e) => setDraft({ ...draft, second_person: e.target.checked })} />
              <span>The person who submitted cannot release</span> <InfoTip label="Second person">{DRAWING_TIPS.secondPerson}</InfoTip>
            </label>
            <Field label="Must be filled before submitting" info={DRAWING_TIPS.requiredFields}>
              <div style={{ display: "grid", gap: 2 }}>
                {REQUIRED_FIELD_KEYS.map((k) => (
                  <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                    <input type="checkbox" checked={draft.required_fields.includes(k)} onChange={() => setDraft({ ...draft, required_fields: toggle(draft.required_fields, k) })} />{REQUIRED_FIELD_LABEL[k]}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Feeds" info={DRAWING_TIPS.feeds}>
              <div style={{ display: "grid", gap: 2 }}>
                {FEEDS.map((f) => (
                  <label key={f} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                    <input type="checkbox" checked={draft.feeds.includes(f)} onChange={() => setDraft({ ...draft, feeds: toggle(draft.feeds, f) })} />{FEED_LABEL[f]}
                  </label>
                ))}
              </div>
            </Field>
            <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /><span>In use</span>
            </label>
          </div>
        </SidePanel>
      )}
    </div>
  );
}
