"use client";

import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { CheckOpt } from "@/components/ui/Opt";
import { Input, Select, Textarea } from "@/components/ui/Input";
import type {
  ClauseItem, ClauseSectionData, ClosingData, FrontBlockData, FrontField, FrontRow, LineItemsData, ScopeMatrixData,
  StandardQuoteBlockData, StandardQuoteTemplateBlock,
} from "@/lib/types";
import { PDF_TIPS } from "@/lib/pdf/tips";

// The editors of the structured layout blocks (PDF design, slice 1): front block, clause section, scope matrix, bill of
// quantities options, closing. One editor per block type, each a few labelled fields; nothing here prints running text.

const FIELD_LABEL: Record<string, string> = {
  date: "Date", ref: "Quotation number", account: "Customer", account_phone: "Customer phone", account_email: "Customer email",
  contact: "Contact", contact_phone: "Contact phone", contact_email: "Contact email", project_title: "Project title", subject: "Subject",
  valid_until: "Valid until", inquiry_date: "Inquiry date",
};
const FIELDS = Object.keys(FIELD_LABEL) as FrontField[];

export const STRUCTURED_TYPES = new Set(["front_block", "clause_section", "scope_matrix", "closing"]);
export const hasEditor = (b: StandardQuoteTemplateBlock) => STRUCTURED_TYPES.has(b.type) || b.type === "line_items";

let seq = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newClauseSection(): StandardQuoteTemplateBlock {
  return { id: `sec-${newId("n")}`, type: "clause_section", visible: true, data: { title: "New section", numbered: false, items: [{ id: newId("i"), text: "" }] } as ClauseSectionData };
}
export function newScopeMatrix(): StandardQuoteTemplateBlock {
  return { id: `mx-${newId("n")}`, type: "scope_matrix", visible: true, data: { title: "New part", columns: ["Supplier", "Client", "N/A"], remark: true, rows: [] } as ScopeMatrixData };
}

export default function BlockEditor({ block, onData }: { block: StandardQuoteTemplateBlock; onData: (d: StandardQuoteBlockData) => void }) {
  switch (block.type) {
    case "front_block": return <FrontEditor data={(block.data as FrontBlockData) ?? { rows: [] }} onChange={onData} />;
    case "clause_section": return <ClauseEditor data={(block.data as ClauseSectionData) ?? { title: "", numbered: false, items: [] }} onChange={onData} />;
    case "scope_matrix": return <MatrixEditor data={(block.data as ScopeMatrixData) ?? { title: "", columns: ["Supplier", "Client", "N/A"], remark: true, rows: [] }} onChange={onData} />;
    case "closing": return <ClosingEditor data={(block.data as ClosingData) ?? { text: "", regards: "" }} onChange={onData} />;
    case "line_items": return <LinesEditor data={(block.data as LineItemsData) ?? {}} onChange={onData} />;
    default: return null;
  }
}

function FrontEditor({ data, onChange }: { data: FrontBlockData; onChange: (d: FrontBlockData) => void }) {
  const set = (p: Partial<FrontBlockData>) => onChange({ ...data, ...p });
  const setRow = (i: number, p: Partial<FrontRow>) => set({ rows: data.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        <Field label="Title in the header band" info={PDF_TIPS.layoutsFrame}><Input value={data.title ?? ""} maxLength={60} onChange={(e) => set({ title: e.target.value })} placeholder="QUOTATION" /></Field>
        <Field label="Reference label"><Input value={data.reference_label ?? ""} maxLength={30} onChange={(e) => set({ reference_label: e.target.value })} placeholder="RFQ #" /></Field>
      </div>
      {data.rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6, alignItems: "end" }}>
          <Field label={i === 0 ? "Row label" : ""}><Input value={r.label} maxLength={40} onChange={(e) => setRow(i, { label: e.target.value })} aria-label="Row label" /></Field>
          <Field label={i === 0 ? "Shows" : ""}>
            <Select value={r.field} onChange={(e) => setRow(i, { field: e.target.value as FrontField })} aria-label="Field shown">
              {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
            </Select>
          </Field>
          <Field label={i === 0 ? "Second label (optional)" : ""}><Input value={r.label2 ?? ""} maxLength={40} onChange={(e) => setRow(i, { label2: e.target.value, field2: r.field2 ?? "contact_email" })} aria-label="Second label" /></Field>
          <div style={{ display: "flex", gap: 6 }}>
            {r.label2 ? (
              <Select value={r.field2 ?? "contact_email"} onChange={(e) => setRow(i, { field2: e.target.value as FrontField })} aria-label="Second field shown">
                {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
              </Select>
            ) : null}
            <Button variant="quiet" onClick={() => set({ rows: data.rows.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        </div>
      ))}
      <div><Button onClick={() => set({ rows: [...data.rows, { label: "", field: "project_title" }] })}>+ Add row</Button></div>
      <Field label="Greeting"><Input value={data.greeting ?? ""} maxLength={200} onChange={(e) => set({ greeting: e.target.value })} placeholder="Dear Sir," /></Field>
      <Field label="Opening sentence"><Textarea value={data.opening ?? ""} maxLength={1000} onChange={(e) => set({ opening: e.target.value })} style={{ minHeight: 60 }} /></Field>
    </div>
  );
}

function ClauseEditor({ data, onChange }: { data: ClauseSectionData; onChange: (d: ClauseSectionData) => void }) {
  const set = (p: Partial<ClauseSectionData>) => onChange({ ...data, ...p });
  const setItem = (i: number, p: Partial<ClauseItem>) => set({ items: data.items.map((it, j) => (j === i ? { ...it, ...p } : it)) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label="Section title"><Input value={data.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} /></Field>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 16px" }}>
        <CheckOpt label="Number the items" checked={data.numbered} onChange={(v) => set({ numbered: v })} />
        <CheckOpt label="Can be left out per quotation" info="Sales can switch the whole section off on one quotation; the letters close up." checked={!!data.optional} onChange={(v) => set({ optional: v })} />
        <CheckOpt label="Start on a new page" checked={!!data.page_break} onChange={(v) => set({ page_break: v })} />
      </div>
      {data.items.map((it, i) => (
        <div key={it.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <Field label="Heading (optional)"><Input value={it.heading ?? ""} maxLength={120} onChange={(e) => setItem(i, { heading: e.target.value || undefined })} /></Field>
          <Field label="Text"><Textarea value={it.text} maxLength={4000} onChange={(e) => setItem(i, { text: e.target.value })} style={{ minHeight: 70 }} /></Field>
          <Field label="More paragraphs"><Textarea value={(it.sub ?? []).join("\n")} onChange={(e) => setItem(i, { sub: e.target.value.split("\n") })} style={{ minHeight: 56 }} /></Field>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0 16px" }}>
            <CheckOpt label="Edit per quotation" info="The text is written on each quotation, in its Document tab. Unticked text is fixed boilerplate." checked={!!it.edit} onChange={(v) => setItem(i, { edit: v || undefined })} />
            <CheckOpt label="Heading as colour band" checked={!!it.band} onChange={(v) => setItem(i, { band: v || undefined })} />
            <Button variant="quiet" onClick={() => set({ items: data.items.filter((_, j) => j !== i) })}>Remove item</Button>
          </div>
        </div>
      ))}
      <div><Button onClick={() => set({ items: [...data.items, { id: newId("i"), text: "" }] })}>+ Add item</Button></div>
    </div>
  );
}

function MatrixEditor({ data, onChange }: { data: ScopeMatrixData; onChange: (d: ScopeMatrixData) => void }) {
  const set = (p: Partial<ScopeMatrixData>) => onChange({ ...data, ...p });
  const setCol = (i: 0 | 1 | 2, v: string) => set({ columns: data.columns.map((c, j) => (j === i ? v : c)) as [string, string, string] });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label="Part title"><Input value={data.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        {([0, 1, 2] as const).map((i) => <Field key={i} label={`Column ${i + 1}`}><Input value={data.columns[i]} maxLength={30} onChange={(e) => setCol(i, e.target.value)} /></Field>)}
      </div>
      <CheckOpt label="Remark column" checked={data.remark} onChange={(v) => set({ remark: v })} />
      <Field label="Default rows" info="One row per line. Sales ticks the responsible column on each quotation."><Textarea value={data.rows.map((r) => r.text).join("\n")} style={{ minHeight: 90 }}
        onChange={(e) => {
          const lines = e.target.value.split("\n");
          set({ rows: lines.map((text, i) => ({ id: data.rows[i]?.id ?? newId("r"), text })) });
        }} /></Field>
    </div>
  );
}

function ClosingEditor({ data, onChange }: { data: ClosingData; onChange: (d: ClosingData) => void }) {
  const set = (p: Partial<ClosingData>) => onChange({ ...data, ...p });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label="Closing paragraph"><Textarea value={data.text} maxLength={1000} onChange={(e) => set({ text: e.target.value })} style={{ minHeight: 70 }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        <Field label="Regards"><Input value={data.regards} maxLength={60} onChange={(e) => set({ regards: e.target.value })} placeholder="Best regards," /></Field>
        <Field label="Signatory name"><Input value={data.signatory_name ?? ""} maxLength={80} onChange={(e) => set({ signatory_name: e.target.value })} /></Field>
        <Field label="Signatory title"><Input value={data.signatory_title ?? ""} maxLength={80} onChange={(e) => set({ signatory_title: e.target.value })} /></Field>
      </div>
    </div>
  );
}

function LinesEditor({ data, onChange }: { data: LineItemsData; onChange: (d: LineItemsData) => void }) {
  const set = (p: Partial<LineItemsData>) => onChange({ ...data, ...p });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="bpm-label-row">
        <CheckOpt label="Bill of quantities columns" checked={data.preset === "boq"} onChange={(v) => set({ preset: v ? "boq" : undefined })} />
        <InfoTip label="Bill of quantities columns">SL, description, unit, quantity, unit rate and total value, with a total row under the table. Used inside a page frame.</InfoTip>
      </div>
      {data.preset === "boq" && (
        <>
          <Field label="Total row label" info="{QTY} and {UOM} are replaced by the total quantity and the unit, for example TOTAL AMOUNT FOR 400 PCS."><Input value={data.total_label ?? ""} maxLength={80} onChange={(e) => set({ total_label: e.target.value })} placeholder="TOTAL AMOUNT FOR {QTY} {UOM}" /></Field>
          <Field label="Note under the table"><Textarea value={data.note ?? ""} maxLength={400} onChange={(e) => set({ note: e.target.value })} style={{ minHeight: 50 }} /></Field>
        </>
      )}
    </div>
  );
}
