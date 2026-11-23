"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import InfoTip from "@/components/ui/InfoTip";
import SettingsList, { ListBar } from "@/components/settings/SettingsList";
import type { EntityExtraId, TenantEntity } from "@/lib/constants";
import { Select } from "@/components/ui/Input";
import { blankEntity } from "./companyLogic";
import EinvoiceSellerFields from "./EinvoiceSellerFields";
import { COMPANY_TIPS } from "./tips";
import s from "./company.module.css";

/** Legal entities: one row each, the name opens the panel. The default is picked on new quotations. */
export default function EntitiesTab({ entities, onChange, einvoicing = false }: { entities: TenantEntity[]; onChange: (next: TenantEntity[]) => void; einvoicing?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = entities.find((e) => e.id === openId) ?? null;

  const patch = (id: string, p: Partial<TenantEntity>) => onChange(entities.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const add = () => {
    const e = { ...blankEntity(), is_default: entities.length === 0 };
    onChange([...entities, e]);
    setOpenId(e.id);
  };
  // An entity with no name is what an abandoned "+ Add entity" leaves behind.
  const close = () => {
    if (open && open.name.trim() === "") onChange(entities.filter((e) => e.id !== open.id));
    setOpenId(null);
  };
  const remove = (id: string) => {
    const rest = entities.filter((e) => e.id !== id);
    onChange(rest.length > 0 && !rest.some((e) => e.is_default) ? rest.map((e, i) => (i === 0 ? { ...e, is_default: true } : e)) : rest);
    setOpenId(null);
  };

  return (
    <div className={s.shell}>
      <ListBar>
        <span className="bpm-label-row" style={{ marginInlineEnd: "auto" }}><span className="bpm-t-label">Legal entities</span><InfoTip label="Legal entities">{COMPANY_TIPS.entities}</InfoTip></span>
        <Button variant="primary" onClick={add}>+ Add entity</Button>
      </ListBar>
      <SettingsList
        label="Legal entities"
        headers={["Short name", "Tax ID"]}
        rows={entities.map((e) => ({
          key: e.id,
          title: <>{e.name || "Untitled entity"}{e.is_default && <span className={s.pill}>Default</span>}</>,
          label: e.name || "entity",
          cells: [e.short_name, e.gstin ?? ""],
        }))}
        onOpen={setOpenId}
        empty={COMPANY_TIPS.entityBlank}
      />
      {open && (
        <SidePanel
          title={open.name || "New entity"}
          onClose={close}
          footer={
            <>
              {!open.is_default && <Button onClick={() => onChange(entities.map((e) => ({ ...e, is_default: e.id === open.id })))}>Make default</Button>}
              <Button variant="danger" onClick={() => remove(open.id)}>Remove</Button>
              <Button variant="primary" onClick={close}>Done</Button>
            </>
          }
        >
          <Field label="Legal name"><Input value={open.name} onChange={(e) => patch(open.id, { name: e.target.value })} placeholder="Acme Electrical Works" autoFocus /></Field>
          <Field label="Short name"><Input value={open.short_name} onChange={(e) => patch(open.id, { short_name: e.target.value })} placeholder="AEW" /></Field>
          <Field label="Address"><Input value={open.address} onChange={(e) => patch(open.id, { address: e.target.value })} placeholder="Street, City, State, PIN" /></Field>
          <Field label="Phone"><Input value={open.phone ?? ""} onChange={(e) => patch(open.id, { phone: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={open.email ?? ""} onChange={(e) => patch(open.id, { email: e.target.value })} /></Field>
          <Field label="Tax ID" info={COMPANY_TIPS.taxId}><Input className={s.mono} value={open.gstin ?? ""} onChange={(e) => patch(open.id, { gstin: e.target.value })} /></Field>
          {einvoicing && <EinvoiceSellerFields entity={open} onPatch={(p) => patch(open.id, p)} />}
          <details className={s.more}>
            <summary>More</summary>
            <div className={s.moreBody}>
              <Field label="Tagline" info={COMPANY_TIPS.tagline}><Input value={open.tagline ?? ""} onChange={(e) => patch(open.id, { tagline: e.target.value })} /></Field>
              <div className="bpm-label-row" style={{ marginTop: 6 }}><span className="bpm-t-label">Extra ids</span><InfoTip label="Extra ids">{COMPANY_TIPS.extraIds}</InfoTip></div>
              {(open.extra_ids ?? []).map((x) => {
                const upd = (p2: Partial<EntityExtraId>) => patch(open.id, { extra_ids: (open.extra_ids ?? []).map((y) => (y.id === x.id ? { ...y, ...p2 } : y)) });
                return (
                  <div key={x.id} className={s.itemRow} style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
                    <Input value={x.label} onChange={(e) => upd({ label: e.target.value })} placeholder="Label, for example Vendor no." aria-label="Id label" maxLength={60} />
                    <Input className={s.mono} value={x.value} onChange={(e) => upd({ value: e.target.value })} placeholder="Value" aria-label="Id value" maxLength={60} />
                    <Select value={x.print} onChange={(e) => upd({ print: e.target.value as EntityExtraId["print"] })} aria-label="Print">
                      <option value="always">Print on every document</option>
                      <option value="selected_customers">Print for selected customers</option>
                    </Select>
                    <Button variant="quiet" onClick={() => patch(open.id, { extra_ids: (open.extra_ids ?? []).filter((y) => y.id !== x.id) })}>Remove</Button>
                  </div>
                );
              })}
              <Button onClick={() => patch(open.id, { extra_ids: [...(open.extra_ids ?? []), { id: crypto.randomUUID(), label: "", value: "", print: "selected_customers" }] })}>+ Add id</Button>
            </div>
          </details>
        </SidePanel>
      )}
    </div>
  );
}
