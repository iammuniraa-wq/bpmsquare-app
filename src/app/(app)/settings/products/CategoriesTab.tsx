"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import SettingsList, { ListBar } from "@/components/settings/SettingsList";
import { deriveCode, type ProductCategoryNode } from "@/lib/picklists";
import { addCategory, addSub, removeCategory, removeSub, renameCategory, renameSub } from "./productsLogic";
import { PRODUCT_TIPS } from "./tips";
import s from "./products.module.css";

/** Name and, behind "Code", the stable code that records store. The code follows the name until it is touched. */
function NameAndCode({ name, code, onName, onCode, nameLabel, autoFocus }: {
  name: string; code: string; onName: (v: string) => void; onCode: (v: string) => void; nameLabel: string; autoFocus?: boolean;
}) {
  return (
    <>
      <Field label={nameLabel}><Input value={name} onChange={(e) => onName(e.target.value)} autoFocus={autoFocus} /></Field>
      <details className={s.more}>
        <summary>Code</summary>
        <div className={s.moreBody}>
          <Field label="Code" info={PRODUCT_TIPS.code}><Input className={s.mono} value={code} onChange={(e) => onCode(e.target.value)} /></Field>
        </div>
      </details>
    </>
  );
}

function SubAdder({ onAdd }: { onAdd: (name: string, code?: string) => string | null }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const add = () => {
    const err = onAdd(name, touched ? code : undefined);
    if (err) { setError(err); return; }
    setName(""); setCode(""); setTouched(false); setError("");
  };
  return (
    <div>
      <div className={s.addRow}>
        <NameAndCode
          name={name} code={code} nameLabel="New sub-category"
          onName={(v) => { setName(v); if (!touched) setCode(deriveCode(v)); }}
          onCode={(v) => { setTouched(true); setCode(v); }}
        />
        <Button onClick={add}>+ Add sub-category</Button>
      </div>
      {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
    </div>
  );
}

export default function CategoriesTab({ tree, onChange }: { tree: ProductCategoryNode[]; onChange: (next: ProductCategoryNode[]) => void }) {
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [draftTouched, setDraftTouched] = useState(false);
  const [error, setError] = useState("");
  const open = tree.find((x) => x.code === openCode) ?? null;

  const startAdd = () => { setAdding(true); setOpenCode(null); setDraftName(""); setDraftCode(""); setDraftTouched(false); setError(""); };
  const confirmAdd = () => {
    const res = addCategory(tree, draftName, draftTouched ? draftCode : undefined);
    if ("error" in res) { setError(res.error); return; }
    onChange(res.tree);
    setAdding(false);
    setOpenCode(res.code);
  };

  return (
    <div className={s.shell}>
      <ListBar>
        <span className="bpm-label-row" style={{ marginInlineEnd: "auto" }}><span className="bpm-t-label">Product categories</span><InfoTip label="Product categories">{PRODUCT_TIPS.categories}</InfoTip></span>
        <Button variant="primary" onClick={startAdd}>+ New category</Button>
      </ListBar>
      <SettingsList
        label="Product categories"
        headers={["Code", "Sub-categories"]}
        rows={tree.map((x) => ({ key: x.code, title: x.name, cells: [<span key="c" className={s.mono}>{x.code}</span>, x.subs.length > 0 ? x.subs.map((y) => y.name).join(", ") : ""] }))}
        onOpen={(code) => { setOpenCode(code); setAdding(false); }}
        empty="No categories yet. Add one to file products under it."
      />

      {adding && (
        <SidePanel
          title="New category"
          onClose={() => setAdding(false)}
          footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" onClick={confirmAdd}>Add category</Button></>}
        >
          <NameAndCode
            name={draftName} code={draftCode} nameLabel="Name" autoFocus
            onName={(v) => { setDraftName(v); if (!draftTouched) setDraftCode(deriveCode(v)); }}
            onCode={(v) => { setDraftTouched(true); setDraftCode(v); }}
          />
          {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
        </SidePanel>
      )}

      {open && (
        <SidePanel
          title={open.name}
          subtitle={<span className={s.mono}>{open.code}</span>}
          onClose={() => setOpenCode(null)}
          footer={<><Button variant="danger" onClick={() => { onChange(removeCategory(tree, open.code)); setOpenCode(null); }}>Remove</Button><Button variant="primary" onClick={() => setOpenCode(null)}>Done</Button></>}
        >
          <Field label="Name"><Input value={open.name} onChange={(e) => onChange(renameCategory(tree, open.code, e.target.value))} /></Field>
          <div>
            <div className="bpm-t-label" style={{ marginBottom: 8 }}>Sub-categories</div>
            {open.subs.map((sub) => (
              <div key={sub.code} className={s.subRow}>
                <Input aria-label={`Name of ${sub.name}`} value={sub.name} onChange={(e) => onChange(renameSub(tree, open.code, sub.code, e.target.value))} />
                <Button size="sm" variant="quiet" onClick={() => onChange(removeSub(tree, open.code, sub.code))} aria-label={`Remove ${sub.name}`}>Remove</Button>
              </div>
            ))}
            <SubAdder onAdd={(name, code) => {
              const res = addSub(tree, open.code, name, code);
              if ("error" in res) return res.error;
              onChange(res.tree);
              return null;
            }} />
          </div>
        </SidePanel>
      )}
    </div>
  );
}
