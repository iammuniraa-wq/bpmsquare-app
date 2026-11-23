"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { ACCEPT_ATTR } from "@/lib/drawings/files";
import { DRAWING_TIPS } from "@/lib/drawings/tips";
import { attachFile, call } from "./api";

type Options = { types: { id: string; name: string; numbering_pattern: string | null }[]; tenders: { id: string; label: string }[]; projects: { id: string; label: string }[]; buildings: { id: string; label: string }[] };

// A drawing needs a number, a title, a type and (soon) a file; everything else defaults. The file goes up straight after the drawing is made,
// the same way it does for every later revision, so a failed upload never loses the drawing.

export default function NewDrawingForm() {
  const router = useRouter();
  const [opts, setOpts] = useState<Options | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ drawing_no: "", title: "", type_id: "", external_no: "", opportunity_id: "", project_id: "", wbs_item_id: "", notes: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    let live = true;
    call<Options>(`/api/drawings/options${form.opportunity_id ? `?opportunity_id=${form.opportunity_id}` : ""}`, "GET").then((r) => {
      if (!live) return;
      if (!r.ok) { setError(r.error); return; }
      setOpts(r.data);
      // Show the type the server would pick (the one called Drawing, else the first), so what the person sees is what is saved.
      const def = r.data.types.find((t) => t.name.trim().toLowerCase() === "drawing") ?? r.data.types[0];
      if (def) setForm((f) => (f.type_id ? f : { ...f, type_id: def.id }));
    });
    return () => { live = false; };
  }, [form.opportunity_id]);

  const pattern = opts?.types.find((t) => t.id === (form.type_id || opts.types[0]?.id))?.numbering_pattern ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.drawing_no.trim()) { setError("A drawing number is needed"); return; }
    if (!form.title.trim()) { setError("A title is needed"); return; }
    setSaving(true); setError("");
    const made = await call<{ id: string; revision: { id: string } }>("/api/drawings", "POST", {
      ...form, type_id: form.type_id || undefined, opportunity_id: form.opportunity_id || undefined, project_id: form.project_id || undefined, wbs_item_id: form.wbs_item_id || undefined,
    });
    if (!made.ok) { setSaving(false); setError(made.error); return; }
    const file = fileRef.current?.files?.[0];
    if (file) {
      const up = await attachFile(made.data.id, made.data.revision.id, file);
      if (!up.ok) { setSaving(false); router.push(`${ROUTES.drawing(made.data.id)}?note=file`); return; }
    }
    router.push(ROUTES.drawing(made.data.id));
  }

  return (
    <ObjectFormPage backHref={ROUTES.drawings} backLabel="All drawings" title="New drawing" subtitle="A number, a title and the file" onSubmit={submit} saving={saving} saveLabel="Save" error={error}>
      <Card title="Drawing" padding={18}>
        <div className="fg2">
          <Field label="Drawing number" required info={pattern ? `${DRAWING_TIPS.drawingNo} Pattern: ${pattern}` : DRAWING_TIPS.drawingNo} guide="drawings.field.drawing_no">
            <Input value={form.drawing_no} onChange={set("drawing_no")} required placeholder={pattern ?? "e.g. PRJ1-ARC-001"} />
          </Field>
          <Field label="Type" info={DRAWING_TIPS.type} guide="drawings.field.type">
            <Select value={form.type_id} onChange={set("type_id")}>
              {opts?.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Title" required guide="drawings.field.title">
          <Input value={form.title} onChange={set("title")} required placeholder="e.g. Ground floor slab layout" />
        </Field>
        <Field label="File" info={DRAWING_TIPS.file} guide="drawings.field.file">
          <input ref={fileRef} type="file" accept={ACCEPT_ATTR} style={{ minHeight: 44 }} />
        </Field>
      </Card>
      <details style={{ marginTop: 12 }}>
        <summary style={{ minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer", fontWeight: 600 }}>More: where it is filed</summary>
        <Card padding={18}>
          <div className="fg2">
            <Field label="Tender" info={DRAWING_TIPS.filedUnder}>
              <Select value={form.opportunity_id} onChange={(e) => setForm((f) => ({ ...f, opportunity_id: e.target.value, wbs_item_id: "" }))}>
                <option value="">None</option>
                {opts?.tenders.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Building">
              <Select value={form.wbs_item_id} onChange={set("wbs_item_id")} disabled={!form.opportunity_id}>
                <option value="">None</option>
                {opts?.buildings.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </Select>
            </Field>
          </div>
          <div className="fg2">
            <Field label="Project">
              <Select value={form.project_id} onChange={set("project_id")}>
                <option value="">None</option>
                {opts?.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="External number" info={DRAWING_TIPS.externalNo}>
              <Input value={form.external_no} onChange={set("external_no")} />
            </Field>
          </div>
          <Field label="Note on the first revision" style={{ marginBottom: 0 }}>
            <Textarea value={form.notes} onChange={set("notes")} rows={3} />
          </Field>
        </Card>
      </details>
    </ObjectFormPage>
  );
}
