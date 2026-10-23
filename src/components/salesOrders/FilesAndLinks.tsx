"use client";

import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import { addFile, addLink, attachmentUrl, removeAttachment, type Attachment } from "@/lib/salesOrders/client";
import type { OrderAttachment } from "@/lib/salesOrders/types";
import { fmtDate, fmtSize, KIND_LABEL, linkProblem } from "./logic";
import { ORDER_TIPS } from "./tips";
import s from "./salesOrders.module.css";

type Panel = null | "file" | "link";

/**
 * The Files and links area under the document flow: upload a file or add a link, each typed (Customer PO, Drawing,
 * Other) with who and when. Stays open on a confirmed order made here (`canAdd`), closed on cancelled and ERP orders.
 * `items === null` means the list could not be loaded: it says so and offers nothing that would fail.
 */
export default function FilesAndLinks({ orderId, items, canAdd, onChanged }: {
  orderId: string;
  items: Attachment[] | null;
  canAdd: boolean;
  onChanged: () => void;
}) {
  const { confirm, toast } = useFeel();
  const [panel, setPanel] = useState<Panel>(null);
  const [kind, setKind] = useState<OrderAttachment["kind"]>("customer_po");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const open = (p: Exclude<Panel, null>) => { setPanel(p); setError(""); setFile(null); setUrl(""); setName(""); setKind("customer_po"); };

  async function save() {
    setError("");
    if (panel === "file" && !file) { setError("Choose a file first"); return; }
    if (panel === "link") { const p = linkProblem(url); if (p) { setError(p); return; } }
    setBusy(true);
    const res = panel === "file" && file ? await addFile(orderId, file, kind, name.trim() || undefined) : await addLink(orderId, { url: url.trim(), name: name.trim() || undefined, kind });
    setBusy(false);
    if (!res.ok) { setError(res.missing && res.status !== 404 ? "Could not reach the server" : res.error); return; }
    setPanel(null);
    toast({ text: panel === "file" ? "File added" : "Link added", tone: "success" });
    onChanged();
  }

  async function remove(a: Attachment) {
    if (!(await confirm({ title: `Remove "${a.name}"?`, body: "It is removed from this order for everyone.", tone: "danger" }))) return;
    const res = await removeAttachment(orderId, a.id);
    if (!res.ok) { toast({ text: res.error, tone: "error" }); return; }
    onChanged();
  }

  const href = (a: Attachment) => a.href ?? (a.type === "link" ? (/^https:\/\//i.test(a.ref) ? a.ref : null) : attachmentUrl(orderId, a.id));

  return (
    <Card title="Files and links" info={ORDER_TIPS.files} padding={16}>
      <div data-guide="sales_order.files">
        {items === null ? (
          <EmptyState title="Files are not available" text="They could not be loaded. Try again in a moment." action={<Button onClick={onChanged}>Try again</Button>} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No files or links yet"
            text={canAdd ? "Add the customer's PO or a drawing so it stays with the order." : "Nothing was attached to this order."}
          />
        ) : (
          <ul className={s.fileList} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((a) => {
              const link = href(a);
              return (
                <li key={a.id} className={s.fileRow}>
                  <span aria-hidden="true">{a.type === "link" ? "↗" : "▤"}</span>
                  <div className={s.fileMain}>
                    {link ? (
                      <a className={s.fileName} href={link} target="_blank" rel="noopener noreferrer">{a.name}</a>
                    ) : (
                      <span className={s.fileName} style={{ color: "var(--ink)" }}>{a.name}</span>
                    )}
                    <div className={s.fileMeta}>
                      {a.created_by_name ?? "Someone"} · {fmtDate(a.created_at)}{a.size_bytes !== null ? ` · ${fmtSize(a.size_bytes)}` : ""}
                    </div>
                  </div>
                  <span className={s.chip}>{KIND_LABEL[a.kind]}</span>
                  {canAdd && (
                    <Button variant="quiet" size="sm" iconOnly aria-label={`Remove ${a.name}`} data-guide="sales_order.file_remove" onClick={() => void remove(a)}>×</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canAdd && items !== null && (
          <div className={s.fileBar}>
            <Button variant="secondary" data-guide="sales_order.file_upload" onClick={() => open("file")}>Upload file</Button>
            <Button variant="secondary" data-guide="sales_order.link_add" onClick={() => open("link")}>Add link</Button>
          </div>
        )}
      </div>

      {panel && (
        <SidePanel
          title={panel === "file" ? "Upload file" : "Add link"}
          onClose={() => setPanel(null)}
          footer={<><Button onClick={() => setPanel(null)} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()} data-guide="sales_order.file_save">{panel === "file" ? "Upload" : "Add link"}</Button></>}
        >
          {panel === "file" ? (
            <Field label="File" hint="PDF, image, spreadsheet or document" htmlFor="so-file">
              <input id="so-file" data-guide="sales_order.file_input" ref={fileRef} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13, minHeight: 44 }} />
            </Field>
          ) : (
            <Field label="Link" hint="Starts with https://" htmlFor="so-link">
              <Input id="so-link" data-guide="sales_order.link_input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoFocus />
            </Field>
          )}
          <Field label="Kind" info={ORDER_TIPS.fileKind} htmlFor="so-kind">
            <Select id="so-kind" data-guide="sales_order.file_kind" value={kind} onChange={(e) => setKind(e.target.value as OrderAttachment["kind"])}>
              {(Object.keys(KIND_LABEL) as OrderAttachment["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Name" htmlFor="so-fname">
            <Input id="so-fname" data-guide="sales_order.file_name" value={name} onChange={(e) => setName(e.target.value)} placeholder={panel === "file" ? "Defaults to the file name" : "Defaults to the address"} />
          </Field>
          {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
        </SidePanel>
      )}
    </Card>
  );
}
