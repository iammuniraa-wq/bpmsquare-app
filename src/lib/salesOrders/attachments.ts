// Files and links on a sales order: what is accepted and how a row is shaped for the screen. Pure, so the rules
// are testable without storage. Files live in a PRIVATE bucket and are only ever handed out as short-lived signed
// links by the [aid] route; a link is a plain https address that is stored and shown, never fetched by the server.

export const ORDER_ATTACHMENT_BUCKET = "order-attachments";
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const ATTACHMENT_KINDS = ["customer_po", "drawing", "other"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

// Customer documents and drawings. No SVG, no executables, no archives.
export const ALLOWED_ATTACHMENT_EXT = ["pdf", "png", "jpg", "jpeg", "webp", "heic", "xlsx", "xlsm", "xls", "csv", "tsv", "txt", "doc", "docx", "eml", "msg", "ppt", "pptx", "dwg", "dxf"] as const;

export const cleanKind = (v: unknown): AttachmentKind => ((ATTACHMENT_KINDS as readonly string[]).includes(v as string) ? (v as AttachmentKind) : "other");

export function fileExtension(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function fileProblem(file: { name: string; size: number }): string | null {
  if (file.size <= 0) return "That file is empty";
  if (file.size > MAX_ATTACHMENT_BYTES) return "File too large (max 15 MB)";
  if (!(ALLOWED_ATTACHMENT_EXT as readonly string[]).includes(fileExtension(file.name))) {
    return `That file type isn't accepted. Allowed: ${ALLOWED_ATTACHMENT_EXT.join(", ")}`;
  }
  return null;
}

export type LinkCheck = { ok: true; url: string; host: string } | { ok: false; error: string };

/** A link is an https address without credentials in it. Anything else (javascript:, data:, http:, user:pass@host) is refused. */
export function validateAttachmentLink(raw: unknown): LinkCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "A link is required" };
  const text = raw.trim();
  if (text.length > 2000) return { ok: false, error: "That link is too long" };
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, error: "That doesn't look like a web address" }; }
  if (u.protocol !== "https:") return { ok: false, error: "Only https links are accepted" };
  if (u.username || u.password) return { ok: false, error: "Remove the user name and password from the link" };
  if (!u.hostname.includes(".")) return { ok: false, error: "That doesn't look like a web address" };
  return { ok: true, url: u.toString(), host: u.hostname };
}

type Row = { id: string; order_id: string; kind: string; type: string; name: string; ref: string; mime_type?: string | null; size_bytes: number | null; created_by: string | null; created_at: string };

/** A listed attachment: the stored row (never the storage path) plus where to open it. */
export function attachmentForScreen(orderId: string, r: Row) {
  return {
    id: r.id,
    order_id: r.order_id,
    kind: r.kind as AttachmentKind,
    type: r.type as "file" | "link",
    name: r.name,
    // A link is its own address; a file opens through the route that signs a short-lived download.
    ref: r.type === "link" ? r.ref : "",
    href: r.type === "link" ? r.ref : `/api/sales-orders/${orderId}/attachments/${r.id}`,
    size_bytes: r.size_bytes,
    created_by: r.created_by,
    created_at: r.created_at,
  };
}
