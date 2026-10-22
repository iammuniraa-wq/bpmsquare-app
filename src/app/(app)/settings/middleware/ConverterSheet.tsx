"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import { CheckOpt } from "@/components/ui/Opt";
import { DATE_FORMATS, type Converter, type SourceField, type ValueList } from "@/lib/middleware/mapping/types";
import { MAX_CONCAT_PARTS } from "@/lib/middleware/mapping/convert";
import s from "./middleware.module.css";
import { CONVERT_CHOICES, checkConverter, converterExample, outboundOnly, startConverter } from "./mappingLogic";
import Panel from "./Panel";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice } from "./ui";

type Scalar = string | number | boolean;
const scalarKind = (v: Scalar): "text" | "number" | "yes" | "no" => (typeof v === "boolean" ? (v ? "yes" : "no") : typeof v === "number" ? "number" : "text");
const fromKind = (k: "text" | "number" | "yes" | "no", raw: string): Scalar => (k === "yes" ? true : k === "no" ? false : k === "number" ? (Number(raw) || 0) : raw);

/** The small panel behind a row's "Convert with": one converter from the closed set, its one or two settings, and an example. */
export default function ConverterSheet({ targetLabel, sourceLabel, source, sourceFields, current, ifEmpty, direction, lists, listKinds, onApply, onClose }: {
  targetLabel: string;
  sourceLabel: string;
  source: SourceField | null;
  sourceFields: readonly SourceField[];
  current: Converter | null;
  ifEmpty: string | null;
  direction: "out" | "in";
  /** The connection's lists, for the example. */
  lists: Record<string, ValueList>;
  /** Every list kind a "Value list" converter may point at. */
  listKinds: { kind: string; label: string }[];
  onApply: (convert: Converter | null, ifEmpty: string | null) => void;
  onClose: () => void;
}) {
  const [conv, setConv] = useState<Converter | null>(current);
  const [empty, setEmpty] = useState(ifEmpty ?? "");
  const choices = CONVERT_CHOICES.filter((c) => direction === "out" || !outboundOnly(c.kind));
  const problem = conv ? checkConverter(conv, direction) : null;
  const example = useMemo(() => {
    if (!conv || problem) return null;
    return converterExample(conv, source, conv.kind === "value_list" ? lists[conv.list] : undefined);
  }, [conv, problem, source, lists]);
  const joinsFields = conv?.kind === "concat";

  return (
    <Panel
      title="Convert with" subtitle={`${sourceLabel} → ${targetLabel}`} onClose={onClose}
      footer={
        <>
          {current && <Button variant="quiet" onClick={() => onApply(null, empty || null)}>Remove converter</Button>}
          <Button variant="primary" disabled={!!problem} onClick={() => onApply(conv, empty || null)}>Use this</Button>
        </>
      }
    >
      <Field label="Convert" info={MIDDLEWARE_TIPS.convert} htmlFor="cv-kind" style={{ marginBottom: 0 }}>
        <Select id="cv-kind" value={conv?.kind ?? ""} onChange={(e) => setConv(e.target.value ? startConverter(e.target.value as Converter["kind"], listKinds[0]?.kind ?? "unit") : null)}>
          <option value="">None, send as it is</option>
          {choices.map((c) => <option key={c.kind} value={c.kind}>{c.label}</option>)}
        </Select>
      </Field>

      {conv?.kind === "value_list" && (
        <Field label="List" htmlFor="cv-list" style={{ marginBottom: 0 }}>
          <Select id="cv-list" value={conv.list} onChange={(e) => setConv({ kind: "value_list", list: e.target.value })}>
            {listKinds.map((l) => <option key={l.kind} value={l.kind}>{l.label}</option>)}
          </Select>
        </Field>
      )}

      {conv?.kind === "constant" && (
        <div className={s.row}>
          <Select aria-label="Kind of value" value={scalarKind(conv.value)} style={{ width: "auto" }} onChange={(e) => setConv({ kind: "constant", value: fromKind(e.target.value as "text", String(conv.value)) })}>
            <option value="text">Text</option><option value="number">Number</option><option value="yes">Yes</option><option value="no">No</option>
          </Select>
          {(scalarKind(conv.value) === "text" || scalarKind(conv.value) === "number") && (
            <Input aria-label="Fixed value" value={String(conv.value)} onChange={(e) => setConv({ kind: "constant", value: fromKind(scalarKind(conv.value) as "text", e.target.value) })} />
          )}
        </div>
      )}

      {conv?.kind === "concat" && (
        <div className={s.stack} style={{ gap: 8 }}>
          {conv.parts.map((p, i) => (
            <div key={i} className={s.row}>
              {"field" in p ? (
                <Select aria-label={`Part ${i + 1} field`} value={p.field} onChange={(e) => setConv({ ...conv, parts: conv.parts.map((x, j) => (j === i ? { field: e.target.value } : x)) })}>
                  {sourceFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  {!sourceFields.some((f) => f.key === p.field) && <option value={p.field}>{p.field}</option>}
                </Select>
              ) : (
                <Input aria-label={`Part ${i + 1} text`} placeholder="Text, such as ·" value={p.text} onChange={(e) => setConv({ ...conv, parts: conv.parts.map((x, j) => (j === i ? { text: e.target.value } : x)) })} />
              )}
              <Button size="sm" variant="quiet" aria-label={`Remove part ${i + 1}`} onClick={() => setConv({ ...conv, parts: conv.parts.filter((_, j) => j !== i) })}>Remove</Button>
            </div>
          ))}
          <div className={s.row}>
            <Button size="sm" disabled={conv.parts.length >= MAX_CONCAT_PARTS} onClick={() => setConv({ ...conv, parts: [...conv.parts, { field: sourceFields[0]?.key ?? "ref" }] })}>Add a field</Button>
            <Button size="sm" disabled={conv.parts.length >= MAX_CONCAT_PARTS} onClick={() => setConv({ ...conv, parts: [...conv.parts, { text: " " }] })}>Add text</Button>
          </div>
          <CheckOpt label="Skip empty fields" checked={conv.skipEmpty === true} onChange={(v) => setConv({ kind: "concat", parts: conv.parts, ...(v ? { skipEmpty: true } : conv.requireAll ? { requireAll: true } : {}) })} />
          <CheckOpt label="Leave out when any field is empty" checked={conv.requireAll === true} onChange={(v) => setConv({ kind: "concat", parts: conv.parts, ...(v ? { requireAll: true } : conv.skipEmpty ? { skipEmpty: true } : {}) })} />
        </div>
      )}

      {conv?.kind === "split" && (
        <div className={s.fields}>
          <Field label="Split at" htmlFor="cv-sep" style={{ marginBottom: 0 }}>
            <Input id="cv-sep" value={conv.sep} onChange={(e) => setConv({ ...conv, sep: e.target.value })} />
          </Field>
          <Field label="Part number (0 is the first, -1 the last)" htmlFor="cv-idx" style={{ marginBottom: 0 }}>
            <Input id="cv-idx" type="number" inputMode="numeric" value={conv.index} onChange={(e) => setConv({ ...conv, index: Number(e.target.value) })} />
          </Field>
        </div>
      )}

      {conv?.kind === "date" && (
        <Field label="Format" htmlFor="cv-date" style={{ marginBottom: 0 }}>
          <Select id="cv-date" value={conv.format} onChange={(e) => setConv({ kind: "date", format: e.target.value as (typeof DATE_FORMATS)[number] })}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </Field>
      )}

      {conv?.kind === "number" && (
        <div className={s.stack} style={{ gap: 8 }}>
          <div className={s.fields}>
            <Field label="Multiply by" htmlFor="cv-scale" style={{ marginBottom: 0 }}>
              <Input id="cv-scale" type="number" inputMode="decimal" value={conv.scale ?? ""} placeholder="1" onChange={(e) => setConv({ ...conv, scale: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
            <Field label="Decimals" htmlFor="cv-dec" style={{ marginBottom: 0 }}>
              <Input id="cv-dec" type="number" inputMode="numeric" min={0} max={6} value={conv.decimals ?? ""} onChange={(e) => setConv({ ...conv, decimals: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
          </div>
          <CheckOpt label="Send as text" checked={conv.asText === true} onChange={(v) => setConv({ ...conv, asText: v || undefined })} />
        </div>
      )}

      {conv?.kind === "text" && (
        <div className={s.fields}>
          <Field label="Change" htmlFor="cv-op" style={{ marginBottom: 0 }}>
            <Select id="cv-op" value={conv.op} onChange={(e) => setConv({ kind: "text", op: e.target.value as "trim", ...(e.target.value === "truncate" ? { max: conv.max ?? 20 } : {}) })}>
              <option value="trim">Trim spaces</option><option value="upper">Upper case</option><option value="lower">Lower case</option><option value="truncate">Shorten</option>
            </Select>
          </Field>
          {conv.op === "truncate" && (
            <Field label="Longest length" htmlFor="cv-max" style={{ marginBottom: 0 }}>
              <Input id="cv-max" type="number" inputMode="numeric" min={1} value={conv.max ?? ""} onChange={(e) => setConv({ ...conv, max: Number(e.target.value) })} />
            </Field>
          )}
        </div>
      )}

      {conv?.kind === "boolean" && (
        <div className={s.fields}>
          <Field label="Yes is sent as" htmlFor="cv-yes" style={{ marginBottom: 0 }}>
            <Input id="cv-yes" value={String(conv.trueValue)} onChange={(e) => setConv({ ...conv, trueValue: e.target.value })} />
          </Field>
          <Field label="No is sent as" htmlFor="cv-no" style={{ marginBottom: 0 }}>
            <Input id="cv-no" value={String(conv.falseValue)} onChange={(e) => setConv({ ...conv, falseValue: e.target.value })} />
          </Field>
        </div>
      )}

      {!joinsFields && conv?.kind !== "constant" && (
        <Field label="If the field is empty, send" info={MIDDLEWARE_TIPS.ifEmpty} htmlFor="cv-empty" style={{ marginBottom: 0 }}>
          <Input id="cv-empty" value={empty} maxLength={500} onChange={(e) => setEmpty(e.target.value)} />
        </Field>
      )}
      {problem && <Notice tone="warn">{problem}</Notice>}
      {example && !problem && <div className={`${s.example} ${s.mono}`} aria-label="Example">{example}</div>}
    </Panel>
  );
}
